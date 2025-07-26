# mako/codegen.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""provides functionality for rendering a parsetree constructing into module
source code."""

import json
import re
import time

from mako import ast
from mako import exceptions
from mako import filters
from mako import parsetree
from mako import util
from mako.pygen import PythonPrinter


MAGIC_NUMBER = 10

# names which are hardwired into the
# template and are not accessed via the
# context itself
TOPLEVEL_DECLARED = {"UNDEFINED", "STOP_RENDERING"}
RESERVED_NAMES = {"context", "loop"}.union(TOPLEVEL_DECLARED)


def compile(  # noqa
    node,
    uri,
    filename=None,
    default_filters=None,
    buffer_filters=None,
    imports=None,
    future_imports=None,
    source_encoding=None,
    generate_magic_comment=True,
    strict_undefined=False,
    enable_loop=True,
    reserved_names=frozenset(),
):
    """Generate module source code given a parsetree node,
    uri, and optional source filename"""

    buf = util.FastEncodingBuffer()

    printer = PythonPrinter(buf)
    _GenerateRenderMethod(
        printer,
        _CompileContext(
            uri,
            filename,
            default_filters,
            buffer_filters,
            imports,
            future_imports,
            source_encoding,
            generate_magic_comment,
            strict_undefined,
            enable_loop,
            reserved_names,
        ),
        node,
    )
    return buf.getvalue()


class _CompileContext:
    def __init__(
        self,
        uri,
        filename,
        default_filters,
        buffer_filters,
        imports,
        future_imports,
        source_encoding,
        generate_magic_comment,
        strict_undefined,
        enable_loop,
        reserved_names,
    ):
        self.uri = uri
        self.filename = filename
        self.default_filters = default_filters
        self.buffer_filters = buffer_filters
        self.imports = imports
        self.future_imports = future_imports
        self.source_encoding = source_encoding
        self.generate_magic_comment = generate_magic_comment
        self.strict_undefined = strict_undefined
        self.enable_loop = enable_loop
        self.reserved_names = reserved_names


class _GenerateRenderMethod:

    """A template visitor object which generates the
    full module source for a template.

    """

    def __init__(self, printer, compiler, node):
        self.printer = printer
        self.compiler = compiler
        self.node = node
        self.identifier_stack = [None]
        self.in_def = isinstance(node, (parsetree.DefTag, parsetree.BlockTag))

        if self.in_def:
            name = "render_%s" % node.funcname
            args = node.get_argument_expressions()
            filtered = len(node.filter_args.args) > 0
            buffered = eval(node.attributes.get("buffered", "False"))
            cached = eval(node.attributes.get("cached", "False"))
            defs = None
            pagetag = None
            if node.is_block and not node.is_anonymous:
                args += ["**pageargs"]
        else:
            defs = self.write_toplevel()
            pagetag = self.compiler.pagetag
            name = "render_body"
            if pagetag is not None:
                args = pagetag.body_decl.get_argument_expressions()
                if not pagetag.body_decl.kwargs:
                    args += ["**pageargs"]
                cached = eval(pagetag.attributes.get("cached", "False"))
                self.compiler.enable_loop = self.compiler.enable_loop or eval(
                    pagetag.attributes.get("enable_loop", "False")
                )
            else:
                args = ["**pageargs"]
                cached = False
            buffered = filtered = False
        if args is None:
            args = ["context"]
        else:
            args = [a for a in ["context"] + args]

        self.write_render_callable(
            pagetag or node, name, args, buffered, filtered, cached
        )

        if defs is not None:
            for node in defs:
                _GenerateRenderMethod(printer, compiler, node)

        if not self.in_def:
            self.write_metadata_struct()

    def write_metadata_struct(self):
        self.printer.source_map[self.printer.lineno] = max(
            self.printer.source_map
        )
        struct = {
            "filename": self.compiler.filename,
            "uri": self.compiler.uri,
            "source_encoding": self.compiler.source_encoding,
            "line_map": self.printer.source_map,
        }
        self.printer.writelines(
            '"""',
            "__M_BEGIN_METADATA",
            json.dumps(struct),
            "__M_END_METADATA\n" '"""',
        )

    @property
    def identifiers(self):
        return self.identifier_stack[-1]

    def write_toplevel(self):
        """Traverse a template structure for module-level directives and
        generate the start of module-level code.

        """
        inherit = []
        namespaces = {}
        module_code = []

        self.compiler.pagetag = None

        class FindTopLevel:
            def visitInheritTag(s, node):
                inherit.append(node)

            def visitNamespaceTag(s, node):
                namespaces[node.name] = node

            def visitPageTag(s, node):
                self.compiler.pagetag = node

            def visitCode(s, node):
                if node.ismodule:
                    module_code.append(node)

        f = FindTopLevel()
        for n in self.node.nodes:
            n.accept_visitor(f)

        self.compiler.namespaces = namespaces

        module_ident = set()
        for n in module_code:
            module_ident = module_ident.union(n.declared_identifiers())

        module_identifiers = _Identifiers(self.compiler)
        module_identifiers.declared = module_ident

        # module-level names, python code
        if (
            self.compiler.generate_magic_comment
            and self.compiler.source_encoding
        ):
            self.printer.writeline(
                "# -*- coding:%s -*-" % self.compiler.source_encoding
            )

        if self.compiler.future_imports:
            self.printer.writeline(
                "from __future__ import %s"
                % (", ".join(self.compiler.future_imports),)
            )
        self.printer.writeline("from mako import runtime, filters, cache")
        self.printer.writeline("UNDEFINED = runtime.UNDEFINED")
        self.printer.writeline("STOP_RENDERING = runtime.STOP_RENDERING")
        self.printer.writeline("__M_dict_builtin = dict")
        self.printer.writeline("__M_locals_builtin = locals")
        self.printer.writeline("_magic_number = %r" % MAGIC_NUMBER)
        self.printer.writeline("_modified_time = %r" % time.time())
        self.printer.writeline("_enable_loop = %r" % self.compiler.enable_loop)
        self.printer.writeline(
            "_template_filename = %r" % self.compiler.filename
        )
        self.printer.writeline("_template_uri = %r" % self.compiler.uri)
        self.printer.writeline(
            "_source_encoding = %r" % self.compiler.source_encoding
        )
        if self.compiler.imports:
            buf = ""
            for imp in self.compiler.imports:
                buf += imp + "\n"
                self.printer.writeline(imp)
            impcode = ast.PythonCode(
                buf,
                source="",
                lineno=0,
                pos=0,
                filename="template defined imports",
            )
        else:
            impcode = None

        main_identifiers = module_identifiers.branch(self.node)
        mit = module_identifiers.topleveldefs
        module_identifiers.topleveldefs = mit.union(
            main_identifiers.topleveldefs
        )
        module_identifiers.declared.update(TOPLEVEL_DECLARED)
        if impcode:
            module_identifiers.declared.update(impcode.declared_identifiers)

        self.compiler.identifiers = module_identifiers
        self.printer.writeline(
            "_exports = %r"
            % [n.name for n in main_identifiers.topleveldefs.values()]
        )
        self.printer.write_blanks(2)

        if len(module_code):
            self.write_module_code(module_code)

        if len(inherit):
            self.write_namespaces(namespaces)
            self.write_inherit(inherit[-1])
        elif len(namespaces):
            self.write_namespaces(namespaces)

        return list(main_identifiers.topleveldefs.values())

    def write_render_callable(
        self, node, name, args, buffered, filtered, cached
    ):
        """write a top-level render callable.

        this could be the main render() method or that of a top-level def."""

        if self.in_def:
            decorator = node.decorator
            if decorator:
                self.printer.writeline(
                    "@runtime._decorate_toplevel(%s)" % decorator
                )

        self.printer.start_source(node.lineno)
        self.printer.writelines(
            "def %s(%s):" % (name, ",".join(args)),
            # push new frame, assign current frame to __M_caller
            "__M_caller = context.caller_stack._push_frame()",
            "try:",
        )
        if buffered or filtered or cached:
            self.printer.writeline("context._push_buffer()")

        self.identifier_stack.append(
            self.compiler.identifiers.branch(self.node)
        )
        if (not self.in_def or self.node.is_block) and "**pageargs" in args:
            self.identifier_stack[-1].argument_declared.add("pageargs")

        if not self.in_def and (
            len(self.identifiers.locally_assigned) > 0
            or len(self.identifiers.argument_declared) > 0
        ):
            self.printer.writeline(
                "__M_locals = __M_dict_builtin(%s)"
                % ",".join(
                    [
                        "%s=%s" % (x, x)
                        for x in self.identifiers.argument_declared
                    ]
                )
            )

        self.write_variable_declares(self.identifiers, toplevel=True)

        for n in self.node.nodes:
            n.accept_visitor(self)

        self.write_def_finish(self.node, buffered, filtered, cached)
        self.printer.writeline(None)
        self.printer.write_blanks(2)
        if cached:
            self.write_cache_decorator(
                node, name, args, buffered, self.identifiers, toplevel=True
            )

    def write_module_code(self, module_code):
        """write module-level template code, i.e. that which
        is enclosed in <%! %> tags in the template."""
        for n in module_code:
            self.printer.write_indented_block(n.text, starting_lineno=n.lineno)

    def write_inherit(self, node):
        """write the module-level inheritance-determination callable."""

        self.printer.writelines(
            "def _mako_inherit(template, context):",
            "_mako_generate_namespaces(context)",
            "return runtime._inherit_from(context, %s, _template_uri)"
            % (node.parsed_attributes["file"]),
            None,
        )

    def write_namespaces(self, namespaces):
        """write the module-level namespace-generating callable."""
        self.printer.writelines(
            "def _mako_get_namespace(context, name):",
            "try:",
            "return context.namespaces[(__name__, name)]",
            "except KeyError:",
            "_mako_generate_namespaces(context)",
            "return context.namespaces[(__name__, name)]",
            None,
            None,
        )
        self.printer.writeline("def _mako_generate_namespaces(context):")

        for node in namespaces.values():
            if "import" in node.attributes:
                self.compiler.has_ns_imports = True
            self.printer.start_source(node.lineno)
            if len(node.nodes):
                self.printer.writeline("def make_namespace():")
                export = []
                identifiers = self.compiler.identifiers.branch(node)
                self.in_def = True

                class NSDefVisitor:
                    def visitDefTag(s, node):
                        s.visitDefOrBase(node)

                    def visitBlockTag(s, node):
                        s.visitDefOrBase(node)

                    def visitDefOrBase(s, node):
                        if node.is_anonymous:
                            raise exceptions.CompileException(
                                "Can't put anonymous blocks inside "
                                "<%namespace>",
                                **node.exception_kwargs,
                            )
                        self.write_inline_def(node, identifiers, nested=False)
                        export.append(node.funcname)

                vis = NSDefVisitor()
                for n in node.nodes:
                    n.accept_visitor(vis)
                self.printer.writeline("return [%s]" % (",".join(export)))
                self.printer.writeline(None)
                self.in_def = False
                callable_name = "make_namespace()"
            else:
                callable_name = "None"

            if "file" in node.parsed_attributes:
                self.printer.writeline(
                    "ns = runtime.TemplateNamespace(%r,"
                    " context._clean_inheritance_tokens(),"
                    " templateuri=%s, callables=%s, "
                    " calling_uri=_template_uri)"
                    % (
                        node.name,
                        node.parsed_attributes.get("file", "None"),
                        callable_name,
                    )
                )
            elif "module" in node.parsed_attributes:
                self.printer.writeline(
                    "ns = runtime.ModuleNamespace(%r,"
                    " context._clean_inheritance_tokens(),"
                    " callables=%s, calling_uri=_template_uri,"
                    " module=%s)"
                    % (
                        node.name,
                        callable_name,
                        node.parsed_attributes.get("module", "None"),
                    )
                )
            else:
                self.printer.writeline(
                    "ns = runtime.Namespace(%r,"
                    " context._clean_inheritance_tokens(),"
                    " callables=%s, calling_uri=_template_uri)"
                    % (node.name, callable_name)
                )
            if eval(node.attributes.get("inheritable", "False")):
                self.printer.writeline("context['self'].%s = ns" % (node.name))

            self.printer.writeline(
                "context.namespaces[(__name__, %s)] = ns" % repr(node.name)
            )
            self.printer.write_blanks(1)
        if not len(namespaces):
            self.printer.writeline("pass")
        self.printer.writeline(None)

    def write_variable_declares(self, identifiers, toplevel=False, limit=None):
        """write variable declarations at the top of a function.

        the variable declarations are in the form of callable
        definitions for defs and/or name lookup within the
        function's context argument. the names declared are based
        on the names that are referenced in the function body,
        which don't otherwise have any explicit assignment
        operation. names that are assigned within the body are
        assumed to be locally-scoped variables and are not
        separately declared.

        for def callable definitions, if the def is a top-level
        callable then a 'stub' callable is generated which wraps
        the current Context into a closure. if the def is not
        top-level, it is fully rendered as a local closure.

        """

        # collection of all defs available to us in this scope
        comp_idents = {c.funcname: c for c in identifiers.defs}
        to_write = set()

        # write "context.get()" for all variables we are going to
        # need that arent in the namespace yet
        to_write = to_write.union(identifiers.undeclared)

        # write closure functions for closures that we define
        # right here
        to_write = to_write.union(
            [c.funcname for c in identifiers.closuredefs.values()]
        )

        # remove identifiers that are declared in the argument
        # signature of the callable
        to_write = to_write.difference(identifiers.argument_declared)

        # remove identifiers that we are going to assign to.
        # in this way we mimic Python's behavior,
        # i.e. assignment to a variable within a block
        # means that variable is now a "locally declared" var,
        # which cannot be referenced beforehand.
        to_write = to_write.difference(identifiers.locally_declared)

        if self.compiler.enable_loop:
            has_loop = "loop" in to_write
            to_write.discard("loop")
        else:
            has_loop = False

        # if a limiting set was sent, constraint to those items in that list
        # (this is used for the caching decorator)
        if limit is not None:
            to_write = to_write.intersection(limit)

        if toplevel and getattr(self.compiler, "has_ns_imports", False):
            self.printer.writeline("_import_ns = {}")
            self.compiler.has_imports = True
            for ident, ns in self.compiler.namespaces.items():
                if "import" in ns.attributes:
                    self.printer.writeline(
                        "_mako_get_namespace(context, %r)."
                        "_populate(_import_ns, %r)"
                        % (
                            ident,
                            re.split(r"\s*,\s*", ns.attributes["import"]),
                        )
                    )

        if has_loop:
            self.printer.writeline("loop = __M_loop = runtime.LoopStack()")

        for ident in to_write:
            if ident in comp_idents:
                comp = comp_idents[ident]
                if comp.is_block:
                    if not comp.is_anonymous:
                        self.write_def_decl(comp, identifiers)
                    else:
                        self.write_inline_def(comp, identifiers, nested=True)
                else:
                    if comp.is_root():
                        self.write_def_decl(comp, identifiers)
                    else:
                        self.write_inline_def(comp, identifiers, nested=True)

            elif ident in self.compiler.namespaces:
                self.printer.writeline(
                    "%s = _mako_get_namespace(context, %r)" % (ident, ident)
                )
            else:
                if getattr(self.compiler, "has_ns_imports", False):
                    if self.compiler.strict_undefined:
                        self.printer.writelines(
                            "%s = _import_ns.get(%r, UNDEFINED)"
                            % (ident, ident),
                            "if %s is UNDEFINED:" % ident,
                            "try:",
                            "%s = context[%r]" % (ident, ident),
                            "except KeyError:",
                            "raise NameError(\"'%s' is not defined\")" % ident,
                            None,
                            None,
                        )
                    else:
                        self.printer.writeline(
                            "%s = _import_ns.get"
                            "(%r, context.get(%r, UNDEFINED))"
                            % (ident, ident, ident)
                        )
                else:
                    if self.compiler.strict_undefined:
                        self.printer.writelines(
                            "try:",
                            "%s = context[%r]" % (ident, ident),
                            "except KeyError:",
                            "raise NameError(\"'%s' is not defined\")" % ident,
                            None,
                        )
                    else:
                        self.printer.writeline(
                            "%s = context.get(%r, UNDEFINED)" % (ident, ident)
                        )

        self.printer.writeline("__M_writer = context.writer()")

    def write_def_decl(self, node, identifiers):
        """write a locally-available callable referencing a top-level def"""
        funcname = node.funcname
        namedecls = node.get_argument_expressions()
        nameargs = node.get_argument_expressions(as_call=True)

        if not self.in_def and (
            len(self.identifiers.locally_assigned) > 0
            or len(self.identifiers.argument_declared) > 0
        ):
            nameargs.insert(0, "context._locals(__M_locals)")
        else:
            nameargs.insert(0, "context")
        self.printer.writeline("def %s(%s):" % (funcname, ",".join(namedecls)))
        self.printer.writeline(
            "return render_%s(%s)" % (funcname, ",".join(nameargs))
        )
        self.printer.writeline(None)

    def write_inline_def(self, node, identifiers, nested):
        """write a locally-available def callable inside an enclosing def."""

        namedecls = node.get_argument_expressions()

        decorator = node.decorator
        if decorator:
            self.printer.writeline(
                "@runtime._decorate_inline(context, %s)" % decorator
            )
        self.printer.writeline(
            "def %s(%s):" % (node.funcname, ",".join(namedecls))
        )
        filtered = len(node.filter_args.args) > 0
        buffered = eval(node.attributes.get("buffered", "False"))
        cached = eval(node.attributes.get("cached", "False"))
        self.printer.writelines(
            # push new frame, assign current frame to __M_caller
            "__M_caller = context.caller_stack._push_frame()",
            "try:",
        )
        if buffered or filtered or cached:
            self.printer.writelines("context._push_buffer()")

        identifiers = identifiers.branch(node, nested=nested)

        self.write_variable_declares(identifiers)

        self.identifier_stack.append(identifiers)
        for n in node.nodes:
            n.accept_visitor(self)
        self.identifier_stack.pop()

        self.write_def_finish(node, buffered, filtered, cached)
        self.printer.writeline(None)
        if cached:
            self.write_cache_decorator(
                node,
                node.funcname,
                namedecls,
                False,
                identifiers,
                inline=True,
                toplevel=False,
            )

    def write_def_finish(
        self, node, buffered, filtered, cached, callstack=True
    ):
        """write the end section of a rendering function, either outermost or
        inline.

        this takes into account if the rendering function was filtered,
        buffered, etc.  and closes the corresponding try: block if any, and
        writes code to retrieve captured content, apply filters, send proper
        return value."""

        if not buffered and not cached and not filtered:
            self.printer.writeline("return ''")
            if callstack:
                self.printer.writelines(
                    "finally:", "context.caller_stack._pop_frame()", None
                )

        if buffered or filtered or cached:
            if buffered or cached:
                # in a caching scenario, don't try to get a writer
                # from the context after popping; assume the caching
                # implemenation might be using a context with no
                # extra buffers
                self.printer.writelines(
                    "finally:", "__M_buf = context._pop_buffer()"
                )
            else:
                self.printer.writelines(
                    "finally:",
                    "__M_buf, __M_writer = context._pop_buffer_and_writer()",
                )

            if callstack:
                self.printer.writeline("context.caller_stack._pop_frame()")

            s = "__M_buf.getvalue()"
            if filtered:
                s = self.create_filter_callable(
                    node.filter_args.args, s, False
                )
            self.printer.writeline(None)
            if buffered and not cached:
                s = self.create_filter_callable(
                    self.compiler.buffer_filters, s, False
                )
            if buffered or cached:
                self.printer.writeline("return %s" % s)
            else:
                self.printer.writelines("__M_writer(%s)" % s, "return ''")

    def write_cache_decorator(
        self,
        node_or_pagetag,
        name,
        args,
        buffered,
        identifiers,
        inline=False,
        toplevel=False,
    ):
        """write a post-function decorator to replace a rendering
        callable with a cached version of itself."""

        self.printer.writeline("__M_%s = %s" % (name, name))
        cachekey = node_or_pagetag.parsed_attributes.get(
            "cache_key", repr(name)
        )

        cache_args = {}
        if self.compiler.pagetag is not None:
            cache_args.update(
                (pa[6:], self.compiler.pagetag.parsed_attributes[pa])
                for pa in self.compiler.pagetag.parsed_attributes
                if pa.startswith("cache_") and pa != "cache_key"
            )
        cache_args.update(
            (pa[6:], node_or_pagetag.parsed_attributes[pa])
            for pa in node_or_pagetag.parsed_attributes
            if pa.startswith("cache_") and pa != "cache_key"
        )
        if "timeout" in cache_args:
            cache_args["timeout"] = int(eval(cache_args["timeout"]))

        self.printer.writeline("def %s(%s):" % (name, ",".join(args)))

        # form "arg1, arg2, arg3=arg3, arg4=arg4", etc.
        pass_args = [
            "%s=%s" % ((a.split("=")[0],) * 2) if "=" in a else a for a in args
        ]

        self.write_variable_declares(
            identifiers,
            toplevel=toplevel,
            limit=node_or_pagetag.undeclared_identifiers(),
        )
        if buffered:
            s = (
                "context.get('local')."
                "cache._ctx_get_or_create("
                "%s, lambda:__M_%s(%s),  context, %s__M_defname=%r)"
                % (
                    cachekey,
                    name,
                    ",".join(pass_args),
                    "".join(
                        ["%s=%s, " % (k, v) for k, v in cache_args.items()]
                    ),
                    name,
                )
            )
            # apply buffer_filters
            s = self.create_filter_callable(
                self.compiler.buffer_filters, s, False
            )
            self.printer.writelines("return " + s, None)
        else:
            self.printer.writelines(
                "__M_writer(context.get('local')."
                "cache._ctx_get_or_create("
                "%s, lambda:__M_%s(%s), context, %s__M_defname=%r))"
                % (
                    cachekey,
                    name,
                    ",".join(pass_args),
                    "".join(
                        ["%s=%s, " % (k, v) for k, v in cache_args.items()]
                    ),
                    name,
                ),
                "return ''",
                None,
            )

    def create_filter_callable(self, args, target, is_expression):
        """write a filter-applying expression based on the filters
        present in the given filter names, adjusting for the global
        'default' filter aliases as needed."""

        def locate_encode(name):
            if re.match(r"decode\..+", name):
                return "filters." + name
            else:
                return filters.DEFAULT_ESCAPES.get(name, name)

        if "n" not in args:
            if is_expression:
                if self.compiler.pagetag:
                    args = self.compiler.pagetag.filter_args.args + args
                if self.compiler.default_filters and "n" not in args:
                    args = self.compiler.default_filters + args
        for e in args:
            # if filter given as a function, get just the identifier portion
            if e == "n":
                continue
            m = re.match(r"(.+?)(\(.*\))", e)
            if m:
                ident, fargs = m.group(1, 2)
                f = locate_encode(ident)
                e = f + fargs
            else:
                e = locate_encode(e)
                assert e is not None
            target = "%s(%s)" % (e, target)
        return target

    def visitExpression(self, node):
        self.printer.start_source(node.lineno)
        if (
            len(node.escapes)
            or (
                self.compiler.pagetag is not None
                and len(self.compiler.pagetag.filter_args.args)
            )
            or len(self.compiler.default_filters)
        ):
            s = self.create_filter_callable(
                node.escapes_code.args, "%s" % node.text, True
            )
            self.printer.writeline("__M_writer(%s)" % s)
        else:
            self.printer.writeline("__M_writer(%s)" % node.text)

    def visitControlLine(self, node):
        if node.isend:
            self.printer.writeline(None)
            if node.has_loop_context:
                self.printer.writeline("finally:")
                self.printer.writeline("loop = __M_loop._exit()")
                self.printer.writeline(None)
        else:
            self.printer.start_source(node.lineno)
            if self.compiler.enable_loop and node.keyword == "for":
                text = mangle_mako_loop(node, self.printer)
            else:
                text = node.text
            self.printer.writeline(text)
            children = node.get_children()

            # this covers the four situations where we want to insert a pass:
            # 1) a ternary control line with no children,
            # 2) a primary control line with nothing but its own ternary
            #       and end control lines, and
            # 3) any control line with no content other than comments
            # 4) the first control block with no content other than comments
            def _search_for_control_line():
                for c in children:
                    if isinstance(c, parsetree.Comment):
                        continue
                    elif isinstance(c, parsetree.ControlLine):
                        return True
                    return False

            if (
                not children
                or all(
                    isinstance(c, (parsetree.Comment, parsetree.ControlLine))
                    for c in children
                )
                and all(
                    (node.is_ternary(c.keyword) or c.isend)
                    for c in children
                    if isinstance(c, parsetree.ControlLine)
                )
                or _search_for_control_line()
            ):
                self.printer.writeline("pass")

    def visitText(self, node):
        self.printer.start_source(node.lineno)
        self.printer.writeline("__M_writer(%s)" % repr(node.content))

    def visitTextTag(self, node):
        filtered = len(node.filter_args.args) > 0
        if filtered:
            self.printer.writelines(
                "__M_writer = context._push_writer()", "try:"
            )
        for n in node.nodes:
            n.accept_visitor(self)
        if filtered:
            self.printer.writelines(
                "finally:",
                "__M_buf, __M_writer = context._pop_buffer_and_writer()",
                "__M_writer(%s)"
                % self.create_filter_callable(
                    node.filter_args.args, "__M_buf.getvalue()", False
                ),
                None,
            )

    def visitCode(self, node):
        if not node.ismodule:
            self.printer.write_indented_block(
                node.text, starting_lineno=node.lineno
            )

            if not self.in_def and len(self.identifiers.locally_assigned) > 0:
                # if we are the "template" def, fudge locally
                # declared/modified variables into the "__M_locals" dictionary,
                # which is used for def calls within the same template,
                # to simulate "enclosing scope"
                self.printer.writeline(
                    "__M_locals_builtin_stored = __M_locals_builtin()"
                )
                self.printer.writeline(
                    "__M_locals.update(__M_dict_builtin([(__M_key,"
                    " __M_locals_builtin_stored[__M_key]) for __M_key in"
                    " [%s] if __M_key in __M_locals_builtin_stored]))"
                    % ",".join([repr(x) for x in node.declared_identifiers()])
                )

    def visitIncludeTag(self, node):
        self.printer.start_source(node.lineno)
        args = node.attributes.get("args")
        if args:
            self.printer.writeline(
                "runtime._include_file(context, %s, _template_uri, %s)"
                % (node.parsed_attributes["file"], args)
            )
        else:
            self.printer.writeline(
                "runtime._include_file(context, %s, _template_uri)"
                % (node.parsed_attributes["file"])
            )

    def visitNamespaceTag(self, node):
        pass

    def visitDefTag(self, node):
        pass

    def visitBlockTag(self, node):
        if node.is_anonymous:
            self.printer.writeline("%s()" % node.funcname)
        else:
            nameargs = node.get_argument_expressions(as_call=True)
            nameargs += ["**pageargs"]
            self.printer.writeline(
                "if 'parent' not in context._data or "
                "not hasattr(context._data['parent'], '%s'):" % node.funcname
            )
            self.printer.writeline(
                "context['self'].%s(%s)" % (node.funcname, ",".join(nameargs))
            )
            self.printer.writeline("\n")

    def visitCallNamespaceTag(self, node):
        # TODO: we can put namespace-specific checks here, such
        # as ensure the given namespace will be imported,
        # pre-import the namespace, etc.
        self.visitCallTag(node)

    def visitCallTag(self, node):
        self.printer.writeline("def ccall(caller):")
        export = ["body"]
        callable_identifiers = self.identifiers.branch(node, nested=True)
        body_identifiers = callable_identifiers.branch(node, nested=False)
        # we want the 'caller' passed to ccall to be used
        # for the body() function, but for other non-body()
        # <%def>s within <%call> we want the current caller
        # off the call stack (if any)
        body_identifiers.add_declared("caller")

        self.identifier_stack.append(body_identifiers)

        class DefVisitor:
            def visitDefTag(s, node):
                s.visitDefOrBase(node)

            def visitBlockTag(s, node):
                s.visitDefOrBase(node)

            def visitDefOrBase(s, node):
                self.write_inline_def(node, callable_identifiers, nested=False)
                if not node.is_anonymous:
                    export.append(node.funcname)
                # remove defs that are within the <%call> from the
                # "closuredefs" defined in the body, so they dont render twice
                if node.funcname in body_identifiers.closuredefs:
                    del body_identifiers.closuredefs[node.funcname]

        vis = DefVisitor()
        for n in node.nodes:
            n.accept_visitor(vis)
        self.identifier_stack.pop()

        bodyargs = node.body_decl.get_argument_expressions()
        self.printer.writeline("def body(%s):" % ",".join(bodyargs))

        # TODO: figure out best way to specify
        # buffering/nonbuffering (at call time would be better)
        buffered = False
        if buffered:
            self.printer.writelines("context._push_buffer()", "try:")
        self.write_variable_declares(body_identifiers)
        self.identifier_stack.append(body_identifiers)

        for n in node.nodes:
            n.accept_visitor(self)
        self.identifier_stack.pop()

        self.write_def_finish(node, buffered, False, False, callstack=False)
        self.printer.writelines(None, "return [%s]" % (",".join(export)), None)

        self.printer.writelines(
            # push on caller for nested call
            "context.caller_stack.nextcaller = "
            "runtime.Namespace('caller', context, "
            "callables=ccall(__M_caller))",
            "try:",
        )
        self.printer.start_source(node.lineno)
        self.printer.writelines(
            "__M_writer(%s)"
            % self.create_filter_callable([], node.expression, True),
            "finally:",
            "context.caller_stack.nextcaller = None",
            None,
        )


class _Identifiers:

    """tracks the status of identifier names as template code is rendered."""

    def __init__(self, compiler, node=None, parent=None, nested=False):
        if parent is not None:
            # if we are the branch created in write_namespaces(),
            # we don't share any context from the main body().
            if isinstance(node, parsetree.NamespaceTag):
                self.declared = set()
                self.topleveldefs = util.SetLikeDict()
            else:
                # things that have already been declared
                # in an enclosing namespace (i.e. names we can just use)
                self.declared = (
                    set(parent.declared)
                    .union([c.name for c in parent.closuredefs.values()])
                    .union(parent.locally_declared)
                    .union(parent.argument_declared)
                )

                # if these identifiers correspond to a "nested"
                # scope, it means whatever the parent identifiers
                # had as undeclared will have been declared by that parent,
                # and therefore we have them in our scope.
                if nested:
                    self.declared = self.declared.union(parent.undeclared)

                # top level defs that are available
                self.topleveldefs = util.SetLikeDict(**parent.topleveldefs)
        else:
            self.declared = set()
            self.topleveldefs = util.SetLikeDict()

        self.compiler = compiler

        # things within this level that are referenced before they
        # are declared (e.g. assigned to)
        self.undeclared = set()

        # things that are declared locally.  some of these things
        # could be in the "undeclared" list as well if they are
        # referenced before declared
        self.locally_declared = set()

        # assignments made in explicit python blocks.
        # these will be propagated to
        # the context of local def calls.
        self.locally_assigned = set()

        # things that are declared in the argument
        # signature of the def callable
        self.argument_declared = set()

        # closure defs that are defined in this level
        self.closuredefs = util.SetLikeDict()

        self.node = node

        if node is not None:
            node.accept_visitor(self)

        illegal_names = self.compiler.reserved_names.intersection(
            self.locally_declared
        )
        if illegal_names:
            raise exceptions.NameConflictError(
                "Reserved words declared in template: %s"
                % ", ".join(illegal_names)
            )

    def branch(self, node, **kwargs):
        """create a new Identifiers for a new Node, with
        this Identifiers as the parent."""

        return _Identifiers(self.compiler, node, self, **kwargs)

    @property
    def defs(self):
        return set(self.topleveldefs.union(self.closuredefs).values())

    def __repr__(self):
        return (
            "Identifiers(declared=%r, locally_declared=%r, "
            "undeclared=%r, topleveldefs=%r, closuredefs=%r, "
            "argumentdeclared=%r)"
            % (
                list(self.declared),
                list(self.locally_declared),
                list(self.undeclared),
                [c.name for c in self.topleveldefs.values()],
                [c.name for c in self.closuredefs.values()],
                self.argument_declared,
            )
        )

    def check_declared(self, node):
        """update the state of this Identifiers with the undeclared
        and declared identifiers of the given node."""

        for ident in node.undeclared_identifiers():
            if ident != "context" and ident not in self.declared.union(
                self.locally_declared
            ):
                self.undeclared.add(ident)
        for ident in node.declared_identifiers():
            self.locally_declared.add(ident)

    def add_declared(self, ident):
        self.declared.add(ident)
        if ident in self.undeclared:
            self.undeclared.remove(ident)

    def visitExpression(self, node):
        self.check_declared(node)

    def visitControlLine(self, node):
        self.check_declared(node)

    def visitCode(self, node):
        if not node.ismodule:
            self.check_declared(node)
            self.locally_assigned = self.locally_assigned.union(
                node.declared_identifiers()
            )

    def visitNamespaceTag(self, node):
        # only traverse into the sub-elements of a
        # <%namespace> tag if we are the branch created in
        # write_namespaces()
        if self.node is node:
            for n in node.nodes:
                n.accept_visitor(self)

    def _check_name_exists(self, collection, node):
        existing = collection.get(node.funcname)
        collection[node.funcname] = node
        if (
            existing is not None
            and existing is not node
            and (node.is_block or existing.is_block)
        ):
            raise exceptions.CompileException(
                "%%def or %%block named '%s' already "
                "exists in this template." % node.funcname,
                **node.exception_kwargs,
            )

    def visitDefTag(self, node):
        if node.is_root() and not node.is_anonymous:
            self._check_name_exists(self.topleveldefs, node)
        elif node is not self.node:
            self._check_name_exists(self.closuredefs, node)

        for ident in node.undeclared_identifiers():
            if ident != "context" and ident not in self.declared.union(
                self.locally_declared
            ):
                self.undeclared.add(ident)

        # visit defs only one level deep
        if node is self.node:
            for ident in node.declared_identifiers():
                self.argument_declared.add(ident)

            for n in node.nodes:
                n.accept_visitor(self)

    def visitBlockTag(self, node):
        if node is not self.node and not node.is_anonymous:
            if isinstance(self.node, parsetree.DefTag):
                raise exceptions.CompileException(
                    "Named block '%s' not allowed inside of def '%s'"
                    % (node.name, self.node.name),
                    **node.exception_kwargs,
                )
            elif isinstance(
                self.node, (parsetree.CallTag, parsetree.CallNamespaceTag)
            ):
                raise exceptions.CompileException(
                    "Named block '%s' not allowed inside of <%%call> tag"
                    % (node.name,),
                    **node.exception_kwargs,
                )

        for ident in node.undeclared_identifiers():
            if ident != "context" and ident not in self.declared.union(
                self.locally_declared
            ):
                self.undeclared.add(ident)

        if not node.is_anonymous:
            self._check_name_exists(self.topleveldefs, node)
            self.undeclared.add(node.funcname)
        elif node is not self.node:
            self._check_name_exists(self.closuredefs, node)
        for ident in node.declared_identifiers():
            self.argument_declared.add(ident)
        for n in node.nodes:
            n.accept_visitor(self)

    def visitTextTag(self, node):
        for ident in node.undeclared_identifiers():
            if ident != "context" and ident not in self.declared.union(
                self.locally_declared
            ):
                self.undeclared.add(ident)

    def visitIncludeTag(self, node):
        self.check_declared(node)

    def visitPageTag(self, node):
        for ident in node.declared_identifiers():
            self.argument_declared.add(ident)
        self.check_declared(node)

    def visitCallNamespaceTag(self, node):
        self.visitCallTag(node)

    def visitCallTag(self, node):
        if node is self.node:
            for ident in node.undeclared_identifiers():
                if ident != "context" and ident not in self.declared.union(
                    self.locally_declared
                ):
                    self.undeclared.add(ident)
            for ident in node.declared_identifiers():
                self.argument_declared.add(ident)
            for n in node.nodes:
                n.accept_visitor(self)
        else:
            for ident in node.undeclared_identifiers():
                if ident != "context" and ident not in self.declared.union(
                    self.locally_declared
                ):
                    self.undeclared.add(ident)


_FOR_LOOP = re.compile(
    r"^for\s+((?:\(?)\s*"
    r"(?:\(?)\s*[A-Za-z_][A-Za-z_0-9]*"
    r"(?:\s*,\s*(?:[A-Za-z_][A-Za-z_0-9]*),??)*\s*(?:\)?)"
    r"(?:\s*,\s*(?:"
    r"(?:\(?)\s*[A-Za-z_][A-Za-z_0-9]*"
    r"(?:\s*,\s*(?:[A-Za-z_][A-Za-z_0-9]*),??)*\s*(?:\)?)"
    r"),??)*\s*(?:\)?))\s+in\s+(.*):"
)


def mangle_mako_loop(node, printer):
    """converts a for loop into a context manager wrapped around a for loop
    when access to the `loop` variable has been detected in the for loop body
    """
    loop_variable = LoopVariable()
    node.accept_visitor(loop_variable)
    if loop_variable.detected:
        node.nodes[-1].has_loop_context = True
        match = _FOR_LOOP.match(node.text)
        if match:
            printer.writelines(
                "loop = __M_loop._enter(%s)" % match.group(2),
                "try:"
                # 'with __M_loop(%s) as loop:' % match.group(2)
            )
            text = "for %s in loop:" % match.group(1)
        else:
            raise SyntaxError("Couldn't apply loop context: %s" % node.text)
    else:
        text = node.text
    return text


class LoopVariable:

    """A node visitor which looks for the name 'loop' within undeclared
    identifiers."""

    def __init__(self):
        self.detected = False

    def _loop_reference_detected(self, node):
        if "loop" in node.undeclared_identifiers():
            self.detected = True
        else:
            for n in node.get_children():
                n.accept_visitor(self)

    def visitControlLine(self, node):
        self._loop_reference_detected(node)

    def visitCode(self, node):
        self._loop_reference_detected(node)

    def visitExpression(self, node):
        self._loop_reference_detected(node)

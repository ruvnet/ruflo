# mako/template.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""Provides the Template class, a facade for parsing, generating and executing
template strings, as well as template runtime operations."""

import json
import os
import re
import shutil
import stat
import tempfile
import types
import weakref

from mako import cache
from mako import codegen
from mako import compat
from mako import exceptions
from mako import runtime
from mako import util
from mako.lexer import Lexer


class Template:
    r"""Represents a compiled template.

    :class:`.Template` includes a reference to the original
    template source (via the :attr:`.source` attribute)
    as well as the source code of the
    generated Python module (i.e. the :attr:`.code` attribute),
    as well as a reference to an actual Python module.

    :class:`.Template` is constructed using either a literal string
    representing the template text, or a filename representing a filesystem
    path to a source file.

    :param text: textual template source.  This argument is mutually
     exclusive versus the ``filename`` parameter.

    :param filename: filename of the source template.  This argument is
     mutually exclusive versus the ``text`` parameter.

    :param buffer_filters: string list of filters to be applied
     to the output of ``%def``\ s which are buffered, cached, or otherwise
     filtered, after all filters
     defined with the ``%def`` itself have been applied. Allows the
     creation of default expression filters that let the output
     of return-valued ``%def``\ s "opt out" of that filtering via
     passing special attributes or objects.

    :param cache_args: Dictionary of cache configuration arguments that
     will be passed to the :class:`.CacheImpl`.   See :ref:`caching_toplevel`.

    :param cache_dir:

     .. deprecated:: 0.6
        Use the ``'dir'`` argument in the ``cache_args`` dictionary.
        See :ref:`caching_toplevel`.

    :param cache_enabled: Boolean flag which enables caching of this
     template.  See :ref:`caching_toplevel`.

    :param cache_impl: String name of a :class:`.CacheImpl` caching
     implementation to use.   Defaults to ``'beaker'``.

    :param cache_type:

     .. deprecated:: 0.6
        Use the ``'type'`` argument in the ``cache_args`` dictionary.
        See :ref:`caching_toplevel`.

    :param cache_url:

     .. deprecated:: 0.6
        Use the ``'url'`` argument in the ``cache_args`` dictionary.
        See :ref:`caching_toplevel`.

    :param default_filters: List of string filter names that will
     be applied to all expressions.  See :ref:`filtering_default_filters`.

    :param enable_loop: When ``True``, enable the ``loop`` context variable.
     This can be set to ``False`` to support templates that may
     be making usage of the name "``loop``".   Individual templates can
     re-enable the "loop" context by placing the directive
     ``enable_loop="True"`` inside the ``<%page>`` tag -- see
     :ref:`migrating_loop`.

    :param encoding_errors: Error parameter passed to ``encode()`` when
     string encoding is performed. See :ref:`usage_unicode`.

    :param error_handler: Python callable which is called whenever
     compile or runtime exceptions occur. The callable is passed
     the current context as well as the exception. If the
     callable returns ``True``, the exception is considered to
     be handled, else it is re-raised after the function
     completes. Is used to provide custom error-rendering
     functions.

     .. seealso::

        :paramref:`.Template.include_error_handler` - include-specific
        error handler function

    :param format_exceptions: if ``True``, exceptions which occur during
     the render phase of this template will be caught and
     formatted into an HTML error page, which then becomes the
     rendered result of the :meth:`.render` call. Otherwise,
     runtime exceptions are propagated outwards.

    :param imports: String list of Python statements, typically individual
     "import" lines, which will be placed into the module level
     preamble of all generated Python modules. See the example
     in :ref:`filtering_default_filters`.

    :param future_imports: String list of names to import from `__future__`.
     These will be concatenated into a comma-separated string and inserted
     into the beginning of the template, e.g. ``futures_imports=['FOO',
     'BAR']`` results in ``from __future__ import FOO, BAR``.

    :param include_error_handler: An error handler that runs when this template
     is included within another one via the ``<%include>`` tag, and raises an
     error.  Compare to the :paramref:`.Template.error_handler` option.

     .. versionadded:: 1.0.6

     .. seealso::

        :paramref:`.Template.error_handler` - top-level error handler function

    :param input_encoding: Encoding of the template's source code.  Can
     be used in lieu of the coding comment. See
     :ref:`usage_unicode` as well as :ref:`unicode_toplevel` for
     details on source encoding.

    :param lookup: a :class:`.TemplateLookup` instance that will be used
     for all file lookups via the ``<%namespace>``,
     ``<%include>``, and ``<%inherit>`` tags. See
     :ref:`usage_templatelookup`.

    :param module_directory: Filesystem location where generated
     Python module files will be placed.

    :param module_filename: Overrides the filename of the generated
     Python module file. For advanced usage only.

    :param module_writer: A callable which overrides how the Python
     module is written entirely.  The callable is passed the
     encoded source content of the module and the destination
     path to be written to.   The default behavior of module writing
     uses a tempfile in conjunction with a file move in order
     to make the operation atomic.   So a user-defined module
     writing function that mimics the default behavior would be:

     .. sourcecode:: python

         import tempfile
         import os
         import shutil

         def module_writer(source, outputpath):
             (dest, name) = \\
                 tempfile.mkstemp(
                     dir=os.path.dirname(outputpath)
                 )

             os.write(dest, source)
             os.close(dest)
             shutil.move(name, outputpath)

         from mako.template import Template
         mytemplate = Template(
                         filename="index.html",
                         module_directory="/path/to/modules",
                         module_writer=module_writer
                     )

     The function is provided for unusual configurations where
     certain platform-specific permissions or other special
     steps are needed.

    :param output_encoding: The encoding to use when :meth:`.render`
     is called.
     See :ref:`usage_unicode` as well as :ref:`unicode_toplevel`.

    :param preprocessor: Python callable which will be passed
     the full template source before it is parsed. The return
     result of the callable will be used as the template source
     code.

    :param lexer_cls: A :class:`.Lexer` class used to parse
     the template.   The :class:`.Lexer` class is used by
     default.

     .. versionadded:: 0.7.4

    :param strict_undefined: Replaces the automatic usage of
     ``UNDEFINED`` for any undeclared variables not located in
     the :class:`.Context` with an immediate raise of
     ``NameError``. The advantage is immediate reporting of
     missing variables which include the name.

     .. versionadded:: 0.3.6

    :param uri: string URI or other identifier for this template.
     If not provided, the ``uri`` is generated from the filesystem
     path, or from the in-memory identity of a non-file-based
     template. The primary usage of the ``uri`` is to provide a key
     within :class:`.TemplateLookup`, as well as to generate the
     file path of the generated Python module file, if
     ``module_directory`` is specified.

    """

    lexer_cls = Lexer

    def __init__(
        self,
        text=None,
        filename=None,
        uri=None,
        format_exceptions=False,
        error_handler=None,
        lookup=None,
        output_encoding=None,
        encoding_errors="strict",
        module_directory=None,
        cache_args=None,
        cache_impl="beaker",
        cache_enabled=True,
        cache_type=None,
        cache_dir=None,
        cache_url=None,
        module_filename=None,
        input_encoding=None,
        module_writer=None,
        default_filters=None,
        buffer_filters=(),
        strict_undefined=False,
        imports=None,
        future_imports=None,
        enable_loop=True,
        preprocessor=None,
        lexer_cls=None,
        include_error_handler=None,
    ):
        if uri:
            self.module_id = re.sub(r"\W", "_", uri)
            self.uri = uri
        elif filename:
            self.module_id = re.sub(r"\W", "_", filename)
            drive, path = os.path.splitdrive(filename)
            path = os.path.normpath(path).replace(os.path.sep, "/")
            self.uri = path
        else:
            self.module_id = "memory:" + hex(id(self))
            self.uri = self.module_id

        u_norm = self.uri
        if u_norm.startswith("/"):
            u_norm = u_norm[1:]
        u_norm = os.path.normpath(u_norm)
        if u_norm.startswith(".."):
            raise exceptions.TemplateLookupException(
                'Template uri "%s" is invalid - '
                "it cannot be relative outside "
                "of the root path." % self.uri
            )

        self.input_encoding = input_encoding
        self.output_encoding = output_encoding
        self.encoding_errors = encoding_errors
        self.enable_loop = enable_loop
        self.strict_undefined = strict_undefined
        self.module_writer = module_writer

        if default_filters is None:
            self.default_filters = ["str"]
        else:
            self.default_filters = default_filters
        self.buffer_filters = buffer_filters

        self.imports = imports
        self.future_imports = future_imports
        self.preprocessor = preprocessor

        if lexer_cls is not None:
            self.lexer_cls = lexer_cls

        # if plain text, compile code in memory only
        if text is not None:
            (code, module) = _compile_text(self, text, filename)
            self._code = code
            self._source = text
            ModuleInfo(module, None, self, filename, code, text, uri)
        elif filename is not None:
            # if template filename and a module directory, load
            # a filesystem-based module file, generating if needed
            if module_filename is not None:
                path = module_filename
            elif module_directory is not None:
                path = os.path.abspath(
                    os.path.join(
                        os.path.normpath(module_directory), u_norm + ".py"
                    )
                )
            else:
                path = None
            module = self._compile_from_file(path, filename)
        else:
            raise exceptions.RuntimeException(
                "Template requires text or filename"
            )

        self.module = module
        self.filename = filename
        self.callable_ = self.module.render_body
        self.format_exceptions = format_exceptions
        self.error_handler = error_handler
        self.include_error_handler = include_error_handler
        self.lookup = lookup

        self.module_directory = module_directory

        self._setup_cache_args(
            cache_impl,
            cache_enabled,
            cache_args,
            cache_type,
            cache_dir,
            cache_url,
        )

    @util.memoized_property
    def reserved_names(self):
        if self.enable_loop:
            return codegen.RESERVED_NAMES
        else:
            return codegen.RESERVED_NAMES.difference(["loop"])

    def _setup_cache_args(
        self,
        cache_impl,
        cache_enabled,
        cache_args,
        cache_type,
        cache_dir,
        cache_url,
    ):
        self.cache_impl = cache_impl
        self.cache_enabled = cache_enabled
        self.cache_args = cache_args or {}
        # transfer deprecated cache_* args
        if cache_type:
            self.cache_args["type"] = cache_type
        if cache_dir:
            self.cache_args["dir"] = cache_dir
        if cache_url:
            self.cache_args["url"] = cache_url

    def _compile_from_file(self, path, filename):
        if path is not None:
            util.verify_directory(os.path.dirname(path))
            filemtime = os.stat(filename)[stat.ST_MTIME]
            if (
                not os.path.exists(path)
                or os.stat(path)[stat.ST_MTIME] < filemtime
            ):
                data = util.read_file(filename)
                _compile_module_file(
                    self, data, filename, path, self.module_writer
                )
            module = compat.load_module(self.module_id, path)
            if module._magic_number != codegen.MAGIC_NUMBER:
                data = util.read_file(filename)
                _compile_module_file(
                    self, data, filename, path, self.module_writer
                )
                module = compat.load_module(self.module_id, path)
            ModuleInfo(module, path, self, filename, None, None, None)
        else:
            # template filename and no module directory, compile code
            # in memory
            data = util.read_file(filename)
            code, module = _compile_text(self, data, filename)
            self._source = None
            self._code = code
            ModuleInfo(module, None, self, filename, code, None, None)
        return module

    @property
    def source(self):
        """Return the template source code for this :class:`.Template`."""

        return _get_module_info_from_callable(self.callable_).source

    @property
    def code(self):
        """Return the module source code for this :class:`.Template`."""

        return _get_module_info_from_callable(self.callable_).code

    @util.memoized_property
    def cache(self):
        return cache.Cache(self)

    @property
    def cache_dir(self):
        return self.cache_args["dir"]

    @property
    def cache_url(self):
        return self.cache_args["url"]

    @property
    def cache_type(self):
        return self.cache_args["type"]

    def render(self, *args, **data):
        """Render the output of this template as a string.

        If the template specifies an output encoding, the string
        will be encoded accordingly, else the output is raw (raw
        output uses `StringIO` and can't handle multibyte
        characters). A :class:`.Context` object is created corresponding
        to the given data. Arguments that are explicitly declared
        by this template's internal rendering method are also
        pulled from the given ``*args``, ``**data`` members.

        """
        return runtime._render(self, self.callable_, args, data)

    def render_unicode(self, *args, **data):
        """Render the output of this template as a unicode object."""

        return runtime._render(
            self, self.callable_, args, data, as_unicode=True
        )

    def render_context(self, context, *args, **kwargs):
        """Render this :class:`.Template` with the given context.

        The data is written to the context's buffer.

        """
        if getattr(context, "_with_template", None) is None:
            context._set_with_template(self)
        runtime._render_context(self, self.callable_, context, *args, **kwargs)

    def has_def(self, name):
        return hasattr(self.module, "render_%s" % name)

    def get_def(self, name):
        """Return a def of this template as a :class:`.DefTemplate`."""

        return DefTemplate(self, getattr(self.module, "render_%s" % name))

    def list_defs(self):
        """return a list of defs in the template.

        .. versionadded:: 1.0.4

        """
        return [i[7:] for i in dir(self.module) if i[:7] == "render_"]

    def _get_def_callable(self, name):
        return getattr(self.module, "render_%s" % name)

    @property
    def last_modified(self):
        return self.module._modified_time


class ModuleTemplate(Template):

    """A Template which is constructed given an existing Python module.

    e.g.::

         t = Template("this is a template")
         f = file("mymodule.py", "w")
         f.write(t.code)
         f.close()

         import mymodule

         t = ModuleTemplate(mymodule)
         print(t.render())

    """

    def __init__(
        self,
        module,
        module_filename=None,
        template=None,
        template_filename=None,
        module_source=None,
        template_source=None,
        output_encoding=None,
        encoding_errors="strict",
        format_exceptions=False,
        error_handler=None,
        lookup=None,
        cache_args=None,
        cache_impl="beaker",
        cache_enabled=True,
        cache_type=None,
        cache_dir=None,
        cache_url=None,
        include_error_handler=None,
    ):
        self.module_id = re.sub(r"\W", "_", module._template_uri)
        self.uri = module._template_uri
        self.input_encoding = module._source_encoding
        self.output_encoding = output_encoding
        self.encoding_errors = encoding_errors
        self.enable_loop = module._enable_loop

        self.module = module
        self.filename = template_filename
        ModuleInfo(
            module,
            module_filename,
            self,
            template_filename,
            module_source,
            template_source,
            module._template_uri,
        )

        self.callable_ = self.module.render_body
        self.format_exceptions = format_exceptions
        self.error_handler = error_handler
        self.include_error_handler = include_error_handler
        self.lookup = lookup
        self._setup_cache_args(
            cache_impl,
            cache_enabled,
            cache_args,
            cache_type,
            cache_dir,
            cache_url,
        )


class DefTemplate(Template):

    """A :class:`.Template` which represents a callable def in a parent
    template."""

    def __init__(self, parent, callable_):
        self.parent = parent
        self.callable_ = callable_
        self.output_encoding = parent.output_encoding
        self.module = parent.module
        self.encoding_errors = parent.encoding_errors
        self.format_exceptions = parent.format_exceptions
        self.error_handler = parent.error_handler
        self.include_error_handler = parent.include_error_handler
        self.enable_loop = parent.enable_loop
        self.lookup = parent.lookup

    def get_def(self, name):
        return self.parent.get_def(name)


class ModuleInfo:

    """Stores information about a module currently loaded into
    memory, provides reverse lookups of template source, module
    source code based on a module's identifier.

    """

    _modules = weakref.WeakValueDictionary()

    def __init__(
        self,
        module,
        module_filename,
        template,
        template_filename,
        module_source,
        template_source,
        template_uri,
    ):
        self.module = module
        self.module_filename = module_filename
        self.template_filename = template_filename
        self.module_source = module_source
        self.template_source = template_source
        self.template_uri = template_uri
        self._modules[module.__name__] = template._mmarker = self
        if module_filename:
            self._modules[module_filename] = self

    @classmethod
    def get_module_source_metadata(cls, module_source, full_line_map=False):
        source_map = re.search(
            r"__M_BEGIN_METADATA(.+?)__M_END_METADATA", module_source, re.S
        ).group(1)
        source_map = json.loads(source_map)
        source_map["line_map"] = {
            int(k): int(v) for k, v in source_map["line_map"].items()
        }
        if full_line_map:
            f_line_map = source_map["full_line_map"] = []
            line_map = source_map["line_map"]

            curr_templ_line = 1
            for mod_line in range(1, max(line_map)):
                if mod_line in line_map:
                    curr_templ_line = line_map[mod_line]
                f_line_map.append(curr_templ_line)
        return source_map

    @property
    def code(self):
        if self.module_source is not None:
            return self.module_source
        else:
            return util.read_python_file(self.module_filename)

    @property
    def source(self):
        if self.template_source is None:
            data = util.read_file(self.template_filename)
            if self.module._source_encoding:
                return data.decode(self.module._source_encoding)
            else:
                return data

        elif self.module._source_encoding and not isinstance(
            self.template_source, str
        ):
            return self.template_source.decode(self.module._source_encoding)
        else:
            return self.template_source


def _compile(template, text, filename, generate_magic_comment):
    lexer = template.lexer_cls(
        text,
        filename,
        input_encoding=template.input_encoding,
        preprocessor=template.preprocessor,
    )
    node = lexer.parse()
    source = codegen.compile(
        node,
        template.uri,
        filename,
        default_filters=template.default_filters,
        buffer_filters=template.buffer_filters,
        imports=template.imports,
        future_imports=template.future_imports,
        source_encoding=lexer.encoding,
        generate_magic_comment=generate_magic_comment,
        strict_undefined=template.strict_undefined,
        enable_loop=template.enable_loop,
        reserved_names=template.reserved_names,
    )
    return source, lexer


def _compile_text(template, text, filename):
    identifier = template.module_id
    source, lexer = _compile(
        template, text, filename, generate_magic_comment=False
    )

    cid = identifier
    module = types.ModuleType(cid)
    code = compile(source, cid, "exec")

    # this exec() works for 2.4->3.3.
    exec(code, module.__dict__, module.__dict__)
    return (source, module)


def _compile_module_file(template, text, filename, outputpath, module_writer):
    source, lexer = _compile(
        template, text, filename, generate_magic_comment=True
    )

    if isinstance(source, str):
        source = source.encode(lexer.encoding or "ascii")

    if module_writer:
        module_writer(source, outputpath)
    else:
        # make tempfiles in the same location as the ultimate
        # location.   this ensures they're on the same filesystem,
        # avoiding synchronization issues.
        (dest, name) = tempfile.mkstemp(dir=os.path.dirname(outputpath))

        os.write(dest, source)
        os.close(dest)
        shutil.move(name, outputpath)


def _get_module_info_from_callable(callable_):
    return _get_module_info(callable_.__globals__["__name__"])


def _get_module_info(filename):
    return ModuleInfo._modules[filename]

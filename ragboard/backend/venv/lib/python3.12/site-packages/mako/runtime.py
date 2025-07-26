# mako/runtime.py
# Copyright 2006-2020 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""provides runtime services for templates, including Context,
Namespace, and various helper functions."""

import builtins
import functools
import sys

from mako import compat
from mako import exceptions
from mako import util


class Context:

    """Provides runtime namespace, output buffer, and various
    callstacks for templates.

    See :ref:`runtime_toplevel` for detail on the usage of
    :class:`.Context`.

    """

    def __init__(self, buffer, **data):
        self._buffer_stack = [buffer]

        self._data = data

        self._kwargs = data.copy()
        self._with_template = None
        self._outputting_as_unicode = None
        self.namespaces = {}

        # "capture" function which proxies to the
        # generic "capture" function
        self._data["capture"] = functools.partial(capture, self)

        # "caller" stack used by def calls with content
        self.caller_stack = self._data["caller"] = CallerStack()

    def _set_with_template(self, t):
        self._with_template = t
        illegal_names = t.reserved_names.intersection(self._data)
        if illegal_names:
            raise exceptions.NameConflictError(
                "Reserved words passed to render(): %s"
                % ", ".join(illegal_names)
            )

    @property
    def lookup(self):
        """Return the :class:`.TemplateLookup` associated
        with this :class:`.Context`.

        """
        return self._with_template.lookup

    @property
    def kwargs(self):
        """Return the dictionary of top level keyword arguments associated
        with this :class:`.Context`.

        This dictionary only includes the top-level arguments passed to
        :meth:`.Template.render`.  It does not include names produced within
        the template execution such as local variable names or special names
        such as ``self``, ``next``, etc.

        The purpose of this dictionary is primarily for the case that
        a :class:`.Template` accepts arguments via its ``<%page>`` tag,
        which are normally expected to be passed via :meth:`.Template.render`,
        except the template is being called in an inheritance context,
        using the ``body()`` method.   :attr:`.Context.kwargs` can then be
        used to propagate these arguments to the inheriting template::

            ${next.body(**context.kwargs)}

        """
        return self._kwargs.copy()

    def push_caller(self, caller):
        """Push a ``caller`` callable onto the callstack for
        this :class:`.Context`."""

        self.caller_stack.append(caller)

    def pop_caller(self):
        """Pop a ``caller`` callable onto the callstack for this
        :class:`.Context`."""

        del self.caller_stack[-1]

    def keys(self):
        """Return a list of all names established in this :class:`.Context`."""

        return list(self._data.keys())

    def __getitem__(self, key):
        if key in self._data:
            return self._data[key]
        else:
            return builtins.__dict__[key]

    def _push_writer(self):
        """push a capturing buffer onto this Context and return
        the new writer function."""

        buf = util.FastEncodingBuffer()
        self._buffer_stack.append(buf)
        return buf.write

    def _pop_buffer_and_writer(self):
        """pop the most recent capturing buffer from this Context
        and return the current writer after the pop.

        """

        buf = self._buffer_stack.pop()
        return buf, self._buffer_stack[-1].write

    def _push_buffer(self):
        """push a capturing buffer onto this Context."""

        self._push_writer()

    def _pop_buffer(self):
        """pop the most recent capturing buffer from this Context."""

        return self._buffer_stack.pop()

    def get(self, key, default=None):
        """Return a value from this :class:`.Context`."""

        return self._data.get(key, builtins.__dict__.get(key, default))

    def write(self, string):
        """Write a string to this :class:`.Context` object's
        underlying output buffer."""

        self._buffer_stack[-1].write(string)

    def writer(self):
        """Return the current writer function."""

        return self._buffer_stack[-1].write

    def _copy(self):
        c = Context.__new__(Context)
        c._buffer_stack = self._buffer_stack
        c._data = self._data.copy()
        c._kwargs = self._kwargs
        c._with_template = self._with_template
        c._outputting_as_unicode = self._outputting_as_unicode
        c.namespaces = self.namespaces
        c.caller_stack = self.caller_stack
        return c

    def _locals(self, d):
        """Create a new :class:`.Context` with a copy of this
        :class:`.Context`'s current state,
        updated with the given dictionary.

        The :attr:`.Context.kwargs` collection remains
        unaffected.


        """

        if not d:
            return self
        c = self._copy()
        c._data.update(d)
        return c

    def _clean_inheritance_tokens(self):
        """create a new copy of this :class:`.Context`. with
        tokens related to inheritance state removed."""

        c = self._copy()
        x = c._data
        x.pop("self", None)
        x.pop("parent", None)
        x.pop("next", None)
        return c


class CallerStack(list):
    def __init__(self):
        self.nextcaller = None

    def __nonzero__(self):
        return self.__bool__()

    def __bool__(self):
        return len(self) and self._get_caller() and True or False

    def _get_caller(self):
        # this method can be removed once
        # codegen MAGIC_NUMBER moves past 7
        return self[-1]

    def __getattr__(self, key):
        return getattr(self._get_caller(), key)

    def _push_frame(self):
        frame = self.nextcaller or None
        self.append(frame)
        self.nextcaller = None
        return frame

    def _pop_frame(self):
        self.nextcaller = self.pop()


class Undefined:

    """Represents an undefined value in a template.

    All template modules have a constant value
    ``UNDEFINED`` present which is an instance of this
    object.

    """

    def __str__(self):
        raise NameError("Undefined")

    def __nonzero__(self):
        return self.__bool__()

    def __bool__(self):
        return False


UNDEFINED = Undefined()
STOP_RENDERING = ""


class LoopStack:

    """a stack for LoopContexts that implements the context manager protocol
    to automatically pop off the top of the stack on context exit
    """

    def __init__(self):
        self.stack = []

    def _enter(self, iterable):
        self._push(iterable)
        return self._top

    def _exit(self):
        self._pop()
        return self._top

    @property
    def _top(self):
        if self.stack:
            return self.stack[-1]
        else:
            return self

    def _pop(self):
        return self.stack.pop()

    def _push(self, iterable):
        new = LoopContext(iterable)
        if self.stack:
            new.parent = self.stack[-1]
        return self.stack.append(new)

    def __getattr__(self, key):
        raise exceptions.RuntimeException("No loop context is established")

    def __iter__(self):
        return iter(self._top)


class LoopContext:

    """A magic loop variable.
    Automatically accessible in any ``% for`` block.

    See the section :ref:`loop_context` for usage
    notes.

    :attr:`parent` -> :class:`.LoopContext` or ``None``
        The parent loop, if one exists.
    :attr:`index` -> `int`
        The 0-based iteration count.
    :attr:`reverse_index` -> `int`
        The number of iterations remaining.
    :attr:`first` -> `bool`
        ``True`` on the first iteration, ``False`` otherwise.
    :attr:`last` -> `bool`
        ``True`` on the last iteration, ``False`` otherwise.
    :attr:`even` -> `bool`
        ``True`` when ``index`` is even.
    :attr:`odd` -> `bool`
        ``True`` when ``index`` is odd.
    """

    def __init__(self, iterable):
        self._iterable = iterable
        self.index = 0
        self.parent = None

    def __iter__(self):
        for i in self._iterable:
            yield i
            self.index += 1

    @util.memoized_instancemethod
    def __len__(self):
        return len(self._iterable)

    @property
    def reverse_index(self):
        return len(self) - self.index - 1

    @property
    def first(self):
        return self.index == 0

    @property
    def last(self):
        return self.index == len(self) - 1

    @property
    def even(self):
        return not self.odd

    @property
    def odd(self):
        return bool(self.index % 2)

    def cycle(self, *values):
        """Cycle through values as the loop progresses."""
        if not values:
            raise ValueError("You must provide values to cycle through")
        return values[self.index % len(values)]


class _NSAttr:
    def __init__(self, parent):
        self.__parent = parent

    def __getattr__(self, key):
        ns = self.__parent
        while ns:
            if hasattr(ns.module, key):
                return getattr(ns.module, key)
            else:
                ns = ns.inherits
        raise AttributeError(key)


class Namespace:

    """Provides access to collections of rendering methods, which
    can be local, from other templates, or from imported modules.

    To access a particular rendering method referenced by a
    :class:`.Namespace`, use plain attribute access:

    .. sourcecode:: mako

      ${some_namespace.foo(x, y, z)}

    :class:`.Namespace` also contains several built-in attributes
    described here.

    """

    def __init__(
        self,
        name,
        context,
        callables=None,
        inherits=None,
        populate_self=True,
        calling_uri=None,
    ):
        self.name = name
        self.context = context
        self.inherits = inherits
        if callables is not None:
            self.callables = {c.__name__: c for c in callables}

    callables = ()

    module = None
    """The Python module referenced by this :class:`.Namespace`.

    If the namespace references a :class:`.Template`, then
    this module is the equivalent of ``template.module``,
    i.e. the generated module for the template.

    """

    template = None
    """The :class:`.Template` object referenced by this
        :class:`.Namespace`, if any.

    """

    context = None
    """The :class:`.Context` object for this :class:`.Namespace`.

    Namespaces are often created with copies of contexts that
    contain slightly different data, particularly in inheritance
    scenarios. Using the :class:`.Context` off of a :class:`.Namespace` one
    can traverse an entire chain of templates that inherit from
    one-another.

    """

    filename = None
    """The path of the filesystem file used for this
    :class:`.Namespace`'s module or template.

    If this is a pure module-based
    :class:`.Namespace`, this evaluates to ``module.__file__``. If a
    template-based namespace, it evaluates to the original
    template file location.

    """

    uri = None
    """The URI for this :class:`.Namespace`'s template.

    I.e. whatever was sent to :meth:`.TemplateLookup.get_template()`.

    This is the equivalent of :attr:`.Template.uri`.

    """

    _templateuri = None

    @util.memoized_property
    def attr(self):
        """Access module level attributes by name.

        This accessor allows templates to supply "scalar"
        attributes which are particularly handy in inheritance
        relationships.

        .. seealso::

            :ref:`inheritance_attr`

            :ref:`namespace_attr_for_includes`

        """
        return _NSAttr(self)

    def get_namespace(self, uri):
        """Return a :class:`.Namespace` corresponding to the given ``uri``.

        If the given ``uri`` is a relative URI (i.e. it does not
        contain a leading slash ``/``), the ``uri`` is adjusted to
        be relative to the ``uri`` of the namespace itself. This
        method is therefore mostly useful off of the built-in
        ``local`` namespace, described in :ref:`namespace_local`.

        In
        most cases, a template wouldn't need this function, and
        should instead use the ``<%namespace>`` tag to load
        namespaces. However, since all ``<%namespace>`` tags are
        evaluated before the body of a template ever runs,
        this method can be used to locate namespaces using
        expressions that were generated within the body code of
        the template, or to conditionally use a particular
        namespace.

        """
        key = (self, uri)
        if key in self.context.namespaces:
            return self.context.namespaces[key]
        ns = TemplateNamespace(
            uri,
            self.context._copy(),
            templateuri=uri,
            calling_uri=self._templateuri,
        )
        self.context.namespaces[key] = ns
        return ns

    def get_template(self, uri):
        """Return a :class:`.Template` from the given ``uri``.

        The ``uri`` resolution is relative to the ``uri`` of this
        :class:`.Namespace` object's :class:`.Template`.

        """
        return _lookup_template(self.context, uri, self._templateuri)

    def get_cached(self, key, **kwargs):
        """Return a value from the :class:`.Cache` referenced by this
        :class:`.Namespace` object's :class:`.Template`.

        The advantage to this method versus direct access to the
        :class:`.Cache` is that the configuration parameters
        declared in ``<%page>`` take effect here, thereby calling
        up the same configured backend as that configured
        by ``<%page>``.

        """

        return self.cache.get(key, **kwargs)

    @property
    def cache(self):
        """Return the :class:`.Cache` object referenced
        by this :class:`.Namespace` object's
        :class:`.Template`.

        """
        return self.template.cache

    def include_file(self, uri, **kwargs):
        """Include a file at the given ``uri``."""

        _include_file(self.context, uri, self._templateuri, **kwargs)

    def _populate(self, d, l):
        for ident in l:
            if ident == "*":
                for k, v in self._get_star():
                    d[k] = v
            else:
                d[ident] = getattr(self, ident)

    def _get_star(self):
        if self.callables:
            for key in self.callables:
                yield (key, self.callables[key])

    def __getattr__(self, key):
        if key in self.callables:
            val = self.callables[key]
        elif self.inherits:
            val = getattr(self.inherits, key)
        else:
            raise AttributeError(
                "Namespace '%s' has no member '%s'" % (self.name, key)
            )
        setattr(self, key, val)
        return val


class TemplateNamespace(Namespace):

    """A :class:`.Namespace` specific to a :class:`.Template` instance."""

    def __init__(
        self,
        name,
        context,
        template=None,
        templateuri=None,
        callables=None,
        inherits=None,
        populate_self=True,
        calling_uri=None,
    ):
        self.name = name
        self.context = context
        self.inherits = inherits
        if callables is not None:
            self.callables = {c.__name__: c for c in callables}

        if templateuri is not None:
            self.template = _lookup_template(context, templateuri, calling_uri)
            self._templateuri = self.template.module._template_uri
        elif template is not None:
            self.template = template
            self._templateuri = template.module._template_uri
        else:
            raise TypeError("'template' argument is required.")

        if populate_self:
            lclcallable, lclcontext = _populate_self_namespace(
                context, self.template, self_ns=self
            )

    @property
    def module(self):
        """The Python module referenced by this :class:`.Namespace`.

        If the namespace references a :class:`.Template`, then
        this module is the equivalent of ``template.module``,
        i.e. the generated module for the template.

        """
        return self.template.module

    @property
    def filename(self):
        """The path of the filesystem file used for this
        :class:`.Namespace`'s module or template.
        """
        return self.template.filename

    @property
    def uri(self):
        """The URI for this :class:`.Namespace`'s template.

        I.e. whatever was sent to :meth:`.TemplateLookup.get_template()`.

        This is the equivalent of :attr:`.Template.uri`.

        """
        return self.template.uri

    def _get_star(self):
        if self.callables:
            for key in self.callables:
                yield (key, self.callables[key])

        def get(key):
            callable_ = self.template._get_def_callable(key)
            return functools.partial(callable_, self.context)

        for k in self.template.module._exports:
            yield (k, get(k))

    def __getattr__(self, key):
        if key in self.callables:
            val = self.callables[key]
        elif self.template.has_def(key):
            callable_ = self.template._get_def_callable(key)
            val = functools.partial(callable_, self.context)
        elif self.inherits:
            val = getattr(self.inherits, key)

        else:
            raise AttributeError(
                "Namespace '%s' has no member '%s'" % (self.name, key)
            )
        setattr(self, key, val)
        return val


class ModuleNamespace(Namespace):

    """A :class:`.Namespace` specific to a Python module instance."""

    def __init__(
        self,
        name,
        context,
        module,
        callables=None,
        inherits=None,
        populate_self=True,
        calling_uri=None,
    ):
        self.name = name
        self.context = context
        self.inherits = inherits
        if callables is not None:
            self.callables = {c.__name__: c for c in callables}

        mod = __import__(module)
        for token in module.split(".")[1:]:
            mod = getattr(mod, token)
        self.module = mod

    @property
    def filename(self):
        """The path of the filesystem file used for this
        :class:`.Namespace`'s module or template.
        """
        return self.module.__file__

    def _get_star(self):
        if self.callables:
            for key in self.callables:
                yield (key, self.callables[key])
        for key in dir(self.module):
            if key[0] != "_":
                callable_ = getattr(self.module, key)
                if callable(callable_):
                    yield key, functools.partial(callable_, self.context)

    def __getattr__(self, key):
        if key in self.callables:
            val = self.callables[key]
        elif hasattr(self.module, key):
            callable_ = getattr(self.module, key)
            val = functools.partial(callable_, self.context)
        elif self.inherits:
            val = getattr(self.inherits, key)
        else:
            raise AttributeError(
                "Namespace '%s' has no member '%s'" % (self.name, key)
            )
        setattr(self, key, val)
        return val


def supports_caller(func):
    """Apply a caller_stack compatibility decorator to a plain
    Python function.

    See the example in :ref:`namespaces_python_modules`.

    """

    def wrap_stackframe(context, *args, **kwargs):
        context.caller_stack._push_frame()
        try:
            return func(context, *args, **kwargs)
        finally:
            context.caller_stack._pop_frame()

    return wrap_stackframe


def capture(context, callable_, *args, **kwargs):
    """Execute the given template def, capturing the output into
    a buffer.

    See the example in :ref:`namespaces_python_modules`.

    """

    if not callable(callable_):
        raise exceptions.RuntimeException(
            "capture() function expects a callable as "
            "its argument (i.e. capture(func, *args, **kwargs))"
        )
    context._push_buffer()
    try:
        callable_(*args, **kwargs)
    finally:
        buf = context._pop_buffer()
    return buf.getvalue()


def _decorate_toplevel(fn):
    def decorate_render(render_fn):
        def go(context, *args, **kw):
            def y(*args, **kw):
                return render_fn(context, *args, **kw)

            try:
                y.__name__ = render_fn.__name__[7:]
            except TypeError:
                # < Python 2.4
                pass
            return fn(y)(context, *args, **kw)

        return go

    return decorate_render


def _decorate_inline(context, fn):
    def decorate_render(render_fn):
        dec = fn(render_fn)

        def go(*args, **kw):
            return dec(context, *args, **kw)

        return go

    return decorate_render


def _include_file(context, uri, calling_uri, **kwargs):
    """locate the template from the given uri and include it in
    the current output."""

    template = _lookup_template(context, uri, calling_uri)
    (callable_, ctx) = _populate_self_namespace(
        context._clean_inheritance_tokens(), template
    )
    kwargs = _kwargs_for_include(callable_, context._data, **kwargs)
    if template.include_error_handler:
        try:
            callable_(ctx, **kwargs)
        except Exception:
            result = template.include_error_handler(ctx, compat.exception_as())
            if not result:
                raise
    else:
        callable_(ctx, **kwargs)


def _inherit_from(context, uri, calling_uri):
    """called by the _inherit method in template modules to set
    up the inheritance chain at the start of a template's
    execution."""

    if uri is None:
        return None
    template = _lookup_template(context, uri, calling_uri)
    self_ns = context["self"]
    ih = self_ns
    while ih.inherits is not None:
        ih = ih.inherits
    lclcontext = context._locals({"next": ih})
    ih.inherits = TemplateNamespace(
        "self:%s" % template.uri,
        lclcontext,
        template=template,
        populate_self=False,
    )
    context._data["parent"] = lclcontext._data["local"] = ih.inherits
    callable_ = getattr(template.module, "_mako_inherit", None)
    if callable_ is not None:
        ret = callable_(template, lclcontext)
        if ret:
            return ret

    gen_ns = getattr(template.module, "_mako_generate_namespaces", None)
    if gen_ns is not None:
        gen_ns(context)
    return (template.callable_, lclcontext)


def _lookup_template(context, uri, relativeto):
    lookup = context._with_template.lookup
    if lookup is None:
        raise exceptions.TemplateLookupException(
            "Template '%s' has no TemplateLookup associated"
            % context._with_template.uri
        )
    uri = lookup.adjust_uri(uri, relativeto)
    try:
        return lookup.get_template(uri)
    except exceptions.TopLevelLookupException as e:
        raise exceptions.TemplateLookupException(
            str(compat.exception_as())
        ) from e


def _populate_self_namespace(context, template, self_ns=None):
    if self_ns is None:
        self_ns = TemplateNamespace(
            "self:%s" % template.uri,
            context,
            template=template,
            populate_self=False,
        )
    context._data["self"] = context._data["local"] = self_ns
    if hasattr(template.module, "_mako_inherit"):
        ret = template.module._mako_inherit(template, context)
        if ret:
            return ret
    return (template.callable_, context)


def _render(template, callable_, args, data, as_unicode=False):
    """create a Context and return the string
    output of the given template and template callable."""

    if as_unicode:
        buf = util.FastEncodingBuffer()
    else:
        buf = util.FastEncodingBuffer(
            encoding=template.output_encoding, errors=template.encoding_errors
        )
    context = Context(buf, **data)
    context._outputting_as_unicode = as_unicode
    context._set_with_template(template)

    _render_context(
        template,
        callable_,
        context,
        *args,
        **_kwargs_for_callable(callable_, data),
    )
    return context._pop_buffer().getvalue()


def _kwargs_for_callable(callable_, data):
    argspec = compat.inspect_getargspec(callable_)
    # for normal pages, **pageargs is usually present
    if argspec[2]:
        return data

    # for rendering defs from the top level, figure out the args
    namedargs = argspec[0] + [v for v in argspec[1:3] if v is not None]
    kwargs = {}
    for arg in namedargs:
        if arg != "context" and arg in data and arg not in kwargs:
            kwargs[arg] = data[arg]
    return kwargs


def _kwargs_for_include(callable_, data, **kwargs):
    argspec = compat.inspect_getargspec(callable_)
    namedargs = argspec[0] + [v for v in argspec[1:3] if v is not None]
    for arg in namedargs:
        if arg != "context" and arg in data and arg not in kwargs:
            kwargs[arg] = data[arg]
    return kwargs


def _render_context(tmpl, callable_, context, *args, **kwargs):
    import mako.template as template

    # create polymorphic 'self' namespace for this
    # template with possibly updated context
    if not isinstance(tmpl, template.DefTemplate):
        # if main render method, call from the base of the inheritance stack
        (inherit, lclcontext) = _populate_self_namespace(context, tmpl)
        _exec_template(inherit, lclcontext, args=args, kwargs=kwargs)
    else:
        # otherwise, call the actual rendering method specified
        (inherit, lclcontext) = _populate_self_namespace(context, tmpl.parent)
        _exec_template(callable_, context, args=args, kwargs=kwargs)


def _exec_template(callable_, context, args=None, kwargs=None):
    """execute a rendering callable given the callable, a
    Context, and optional explicit arguments

    the contextual Template will be located if it exists, and
    the error handling options specified on that Template will
    be interpreted here.
    """
    template = context._with_template
    if template is not None and (
        template.format_exceptions or template.error_handler
    ):
        try:
            callable_(context, *args, **kwargs)
        except Exception:
            _render_error(template, context, compat.exception_as())
        except:
            e = sys.exc_info()[0]
            _render_error(template, context, e)
    else:
        callable_(context, *args, **kwargs)


def _render_error(template, context, error):
    if template.error_handler:
        result = template.error_handler(context, error)
        if not result:
            tp, value, tb = sys.exc_info()
            if value and tb:
                raise value.with_traceback(tb)
            else:
                raise error
    else:
        error_template = exceptions.html_error_template()
        if context._outputting_as_unicode:
            context._buffer_stack[:] = [util.FastEncodingBuffer()]
        else:
            context._buffer_stack[:] = [
                util.FastEncodingBuffer(
                    error_template.output_encoding,
                    error_template.encoding_errors,
                )
            ]

        context._set_with_template(error_template)
        error_template.render_context(context, error=error)

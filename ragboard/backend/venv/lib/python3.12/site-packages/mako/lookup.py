# mako/lookup.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

import os
import posixpath
import re
import stat
import threading

from mako import exceptions
from mako import util
from mako.template import Template


class TemplateCollection:

    """Represent a collection of :class:`.Template` objects,
    identifiable via URI.

    A :class:`.TemplateCollection` is linked to the usage of
    all template tags that address other templates, such
    as ``<%include>``, ``<%namespace>``, and ``<%inherit>``.
    The ``file`` attribute of each of those tags refers
    to a string URI that is passed to that :class:`.Template`
    object's :class:`.TemplateCollection` for resolution.

    :class:`.TemplateCollection` is an abstract class,
    with the usual default implementation being :class:`.TemplateLookup`.

    """

    def has_template(self, uri):
        """Return ``True`` if this :class:`.TemplateLookup` is
        capable of returning a :class:`.Template` object for the
        given ``uri``.

        :param uri: String URI of the template to be resolved.

        """
        try:
            self.get_template(uri)
            return True
        except exceptions.TemplateLookupException:
            return False

    def get_template(self, uri, relativeto=None):
        """Return a :class:`.Template` object corresponding to the given
        ``uri``.

        The default implementation raises
        :class:`.NotImplementedError`. Implementations should
        raise :class:`.TemplateLookupException` if the given ``uri``
        cannot be resolved.

        :param uri: String URI of the template to be resolved.
        :param relativeto: if present, the given ``uri`` is assumed to
         be relative to this URI.

        """
        raise NotImplementedError()

    def filename_to_uri(self, uri, filename):
        """Convert the given ``filename`` to a URI relative to
        this :class:`.TemplateCollection`."""

        return uri

    def adjust_uri(self, uri, filename):
        """Adjust the given ``uri`` based on the calling ``filename``.

        When this method is called from the runtime, the
        ``filename`` parameter is taken directly to the ``filename``
        attribute of the calling template. Therefore a custom
        :class:`.TemplateCollection` subclass can place any string
        identifier desired in the ``filename`` parameter of the
        :class:`.Template` objects it constructs and have them come back
        here.

        """
        return uri


class TemplateLookup(TemplateCollection):

    """Represent a collection of templates that locates template source files
    from the local filesystem.

    The primary argument is the ``directories`` argument, the list of
    directories to search:

    .. sourcecode:: python

        lookup = TemplateLookup(["/path/to/templates"])
        some_template = lookup.get_template("/index.html")

    The :class:`.TemplateLookup` can also be given :class:`.Template` objects
    programatically using :meth:`.put_string` or :meth:`.put_template`:

    .. sourcecode:: python

        lookup = TemplateLookup()
        lookup.put_string("base.html", '''
            <html><body>${self.next()}</body></html>
        ''')
        lookup.put_string("hello.html", '''
            <%include file='base.html'/>

            Hello, world !
        ''')


    :param directories: A list of directory names which will be
     searched for a particular template URI. The URI is appended
     to each directory and the filesystem checked.

    :param collection_size: Approximate size of the collection used
     to store templates. If left at its default of ``-1``, the size
     is unbounded, and a plain Python dictionary is used to
     relate URI strings to :class:`.Template` instances.
     Otherwise, a least-recently-used cache object is used which
     will maintain the size of the collection approximately to
     the number given.

    :param filesystem_checks: When at its default value of ``True``,
     each call to :meth:`.TemplateLookup.get_template()` will
     compare the filesystem last modified time to the time in
     which an existing :class:`.Template` object was created.
     This allows the :class:`.TemplateLookup` to regenerate a
     new :class:`.Template` whenever the original source has
     been updated. Set this to ``False`` for a very minor
     performance increase.

    :param modulename_callable: A callable which, when present,
     is passed the path of the source file as well as the
     requested URI, and then returns the full path of the
     generated Python module file. This is used to inject
     alternate schemes for Python module location. If left at
     its default of ``None``, the built in system of generation
     based on ``module_directory`` plus ``uri`` is used.

    All other keyword parameters available for
    :class:`.Template` are mirrored here. When new
    :class:`.Template` objects are created, the keywords
    established with this :class:`.TemplateLookup` are passed on
    to each new :class:`.Template`.

    """

    def __init__(
        self,
        directories=None,
        module_directory=None,
        filesystem_checks=True,
        collection_size=-1,
        format_exceptions=False,
        error_handler=None,
        output_encoding=None,
        encoding_errors="strict",
        cache_args=None,
        cache_impl="beaker",
        cache_enabled=True,
        cache_type=None,
        cache_dir=None,
        cache_url=None,
        modulename_callable=None,
        module_writer=None,
        default_filters=None,
        buffer_filters=(),
        strict_undefined=False,
        imports=None,
        future_imports=None,
        enable_loop=True,
        input_encoding=None,
        preprocessor=None,
        lexer_cls=None,
        include_error_handler=None,
    ):
        self.directories = [
            posixpath.normpath(d) for d in util.to_list(directories, ())
        ]
        self.module_directory = module_directory
        self.modulename_callable = modulename_callable
        self.filesystem_checks = filesystem_checks
        self.collection_size = collection_size

        if cache_args is None:
            cache_args = {}
        # transfer deprecated cache_* args
        if cache_dir:
            cache_args.setdefault("dir", cache_dir)
        if cache_url:
            cache_args.setdefault("url", cache_url)
        if cache_type:
            cache_args.setdefault("type", cache_type)

        self.template_args = {
            "format_exceptions": format_exceptions,
            "error_handler": error_handler,
            "include_error_handler": include_error_handler,
            "output_encoding": output_encoding,
            "cache_impl": cache_impl,
            "encoding_errors": encoding_errors,
            "input_encoding": input_encoding,
            "module_directory": module_directory,
            "module_writer": module_writer,
            "cache_args": cache_args,
            "cache_enabled": cache_enabled,
            "default_filters": default_filters,
            "buffer_filters": buffer_filters,
            "strict_undefined": strict_undefined,
            "imports": imports,
            "future_imports": future_imports,
            "enable_loop": enable_loop,
            "preprocessor": preprocessor,
            "lexer_cls": lexer_cls,
        }

        if collection_size == -1:
            self._collection = {}
            self._uri_cache = {}
        else:
            self._collection = util.LRUCache(collection_size)
            self._uri_cache = util.LRUCache(collection_size)
        self._mutex = threading.Lock()

    def get_template(self, uri):
        """Return a :class:`.Template` object corresponding to the given
        ``uri``.

        .. note:: The ``relativeto`` argument is not supported here at
           the moment.

        """

        try:
            if self.filesystem_checks:
                return self._check(uri, self._collection[uri])
            else:
                return self._collection[uri]
        except KeyError as e:
            u = re.sub(r"^\/+", "", uri)
            for dir_ in self.directories:
                # make sure the path seperators are posix - os.altsep is empty
                # on POSIX and cannot be used.
                dir_ = dir_.replace(os.path.sep, posixpath.sep)
                srcfile = posixpath.normpath(posixpath.join(dir_, u))
                if os.path.isfile(srcfile):
                    return self._load(srcfile, uri)
            else:
                raise exceptions.TopLevelLookupException(
                    "Can't locate template for uri %r" % uri
                ) from e

    def adjust_uri(self, uri, relativeto):
        """Adjust the given ``uri`` based on the given relative URI."""

        key = (uri, relativeto)
        if key in self._uri_cache:
            return self._uri_cache[key]

        if uri[0] == "/":
            v = self._uri_cache[key] = uri
        elif relativeto is not None:
            v = self._uri_cache[key] = posixpath.join(
                posixpath.dirname(relativeto), uri
            )
        else:
            v = self._uri_cache[key] = "/" + uri
        return v

    def filename_to_uri(self, filename):
        """Convert the given ``filename`` to a URI relative to
        this :class:`.TemplateCollection`."""

        try:
            return self._uri_cache[filename]
        except KeyError:
            value = self._relativeize(filename)
            self._uri_cache[filename] = value
            return value

    def _relativeize(self, filename):
        """Return the portion of a filename that is 'relative'
        to the directories in this lookup.

        """

        filename = posixpath.normpath(filename)
        for dir_ in self.directories:
            if filename[0 : len(dir_)] == dir_:
                return filename[len(dir_) :]
        else:
            return None

    def _load(self, filename, uri):
        self._mutex.acquire()
        try:
            try:
                # try returning from collection one
                # more time in case concurrent thread already loaded
                return self._collection[uri]
            except KeyError:
                pass
            try:
                if self.modulename_callable is not None:
                    module_filename = self.modulename_callable(filename, uri)
                else:
                    module_filename = None
                self._collection[uri] = template = Template(
                    uri=uri,
                    filename=posixpath.normpath(filename),
                    lookup=self,
                    module_filename=module_filename,
                    **self.template_args,
                )
                return template
            except:
                # if compilation fails etc, ensure
                # template is removed from collection,
                # re-raise
                self._collection.pop(uri, None)
                raise
        finally:
            self._mutex.release()

    def _check(self, uri, template):
        if template.filename is None:
            return template

        try:
            template_stat = os.stat(template.filename)
            if template.module._modified_time >= template_stat[stat.ST_MTIME]:
                return template
            self._collection.pop(uri, None)
            return self._load(template.filename, uri)
        except OSError as e:
            self._collection.pop(uri, None)
            raise exceptions.TemplateLookupException(
                "Can't locate template for uri %r" % uri
            ) from e

    def put_string(self, uri, text):
        """Place a new :class:`.Template` object into this
        :class:`.TemplateLookup`, based on the given string of
        ``text``.

        """
        self._collection[uri] = Template(
            text, lookup=self, uri=uri, **self.template_args
        )

    def put_template(self, uri, template):
        """Place a new :class:`.Template` object into this
        :class:`.TemplateLookup`, based on the given
        :class:`.Template` object.

        """
        self._collection[uri] = template

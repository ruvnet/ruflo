# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: June 11, 2021
# URL: https://humanfriendly.readthedocs.io

"""
Customizations for and integration with the Sphinx_ documentation generator.

The :mod:`humanfriendly.sphinx` module uses the `Sphinx extension API`_ to
customize the process of generating Sphinx based Python documentation. To
explore the functionality this module offers its best to start reading
from the :func:`setup()` function.

.. _Sphinx: http://www.sphinx-doc.org/
.. _Sphinx extension API: http://sphinx-doc.org/extdev/appapi.html
"""

# Standard library modules.
import logging
import types

# External dependencies (if Sphinx is installed docutils will be installed).
import docutils.nodes
import docutils.utils

# Modules included in our package.
from humanfriendly.deprecation import get_aliases
from humanfriendly.text import compact, dedent, format
from humanfriendly.usage import USAGE_MARKER, render_usage

# Public identifiers that require documentation.
__all__ = (
    "deprecation_note_callback",
    "enable_deprecation_notes",
    "enable_man_role",
    "enable_pypi_role",
    "enable_special_methods",
    "enable_usage_formatting",
    "logger",
    "man_role",
    "pypi_role",
    "setup",
    "special_methods_callback",
    "usage_message_callback",
)

# Initialize a logger for this module.
logger = logging.getLogger(__name__)


def deprecation_note_callback(app, what, name, obj, options, lines):
    """
    Automatically document aliases defined using :func:`~humanfriendly.deprecation.define_aliases()`.

    Refer to :func:`enable_deprecation_notes()` to enable the use of this
    function (you probably don't want to call :func:`deprecation_note_callback()`
    directly).

    This function implements a callback for ``autodoc-process-docstring`` that
    reformats module docstrings to append an overview of aliases defined by the
    module.

    The parameters expected by this function are those defined for Sphinx event
    callback functions (i.e. I'm not going to document them here :-).
    """
    if isinstance(obj, types.ModuleType) and lines:
        aliases = get_aliases(obj.__name__)
        if aliases:
            # Convert the existing docstring to a string and remove leading
            # indentation from that string, otherwise our generated content
            # would have to match the existing indentation in order not to
            # break docstring parsing (because indentation is significant
            # in the reStructuredText format).
            blocks = [dedent("\n".join(lines))]
            # Use an admonition to group the deprecated aliases together and
            # to distinguish them from the autodoc entries that follow.
            blocks.append(".. note:: Deprecated names")
            indent = " " * 3
            if len(aliases) == 1:
                explanation = """
                    The following alias exists to preserve backwards compatibility,
                    however a :exc:`~exceptions.DeprecationWarning` is triggered
                    when it is accessed, because this alias will be removed
                    in a future release.
                """
            else:
                explanation = """
                    The following aliases exist to preserve backwards compatibility,
                    however a :exc:`~exceptions.DeprecationWarning` is triggered
                    when they are accessed, because these aliases will be
                    removed in a future release.
                """
            blocks.append(indent + compact(explanation))
            for name, target in aliases.items():
                blocks.append(format("%s.. data:: %s", indent, name))
                blocks.append(format("%sAlias for :obj:`%s`.", indent * 2, target))
            update_lines(lines, "\n\n".join(blocks))


def enable_deprecation_notes(app):
    """
    Enable documenting backwards compatibility aliases using the autodoc_ extension.

    :param app: The Sphinx application object.

    This function connects the :func:`deprecation_note_callback()` function to
    ``autodoc-process-docstring`` events.

    .. _autodoc: http://www.sphinx-doc.org/en/stable/ext/autodoc.html
    """
    app.connect("autodoc-process-docstring", deprecation_note_callback)


def enable_man_role(app):
    """
    Enable the ``:man:`` role for linking to Debian Linux manual pages.

    :param app: The Sphinx application object.

    This function registers the :func:`man_role()` function to handle the
    ``:man:`` role.
    """
    app.add_role("man", man_role)


def enable_pypi_role(app):
    """
    Enable the ``:pypi:`` role for linking to the Python Package Index.

    :param app: The Sphinx application object.

    This function registers the :func:`pypi_role()` function to handle the
    ``:pypi:`` role.
    """
    app.add_role("pypi", pypi_role)


def enable_special_methods(app):
    """
    Enable documenting "special methods" using the autodoc_ extension.

    :param app: The Sphinx application object.

    This function connects the :func:`special_methods_callback()` function to
    ``autodoc-skip-member`` events.

    .. _autodoc: http://www.sphinx-doc.org/en/stable/ext/autodoc.html
    """
    app.connect("autodoc-skip-member", special_methods_callback)


def enable_usage_formatting(app):
    """
    Reformat human friendly usage messages to reStructuredText_.

    :param app: The Sphinx application object (as given to ``setup()``).

    This function connects the :func:`usage_message_callback()` function to
    ``autodoc-process-docstring`` events.

    .. _reStructuredText: https://en.wikipedia.org/wiki/ReStructuredText
    """
    app.connect("autodoc-process-docstring", usage_message_callback)


def man_role(role, rawtext, text, lineno, inliner, options={}, content=[]):
    """
    Convert a Linux manual topic to a hyperlink.

    Using the ``:man:`` role is very simple, here's an example:

    .. code-block:: rst

        See the :man:`python` documentation.

    This results in the following:

      See the :man:`python` documentation.

    As the example shows you can use the role inline, embedded in sentences of
    text. In the generated documentation the ``:man:`` text is omitted and a
    hyperlink pointing to the Debian Linux manual pages is emitted.
    """
    man_url = "https://manpages.debian.org/%s" % text
    reference = docutils.nodes.reference(rawtext, docutils.utils.unescape(text), refuri=man_url, **options)
    return [reference], []


def pypi_role(role, rawtext, text, lineno, inliner, options={}, content=[]):
    """
    Generate hyperlinks to the Python Package Index.

    Using the ``:pypi:`` role is very simple, here's an example:

    .. code-block:: rst

        See the :pypi:`humanfriendly` package.

    This results in the following:

      See the :pypi:`humanfriendly` package.

    As the example shows you can use the role inline, embedded in sentences of
    text. In the generated documentation the ``:pypi:`` text is omitted and a
    hyperlink pointing to the Python Package Index is emitted.
    """
    pypi_url = "https://pypi.org/project/%s/" % text
    reference = docutils.nodes.reference(rawtext, docutils.utils.unescape(text), refuri=pypi_url, **options)
    return [reference], []


def setup(app):
    """
    Enable all of the provided Sphinx_ customizations.

    :param app: The Sphinx application object.

    The :func:`setup()` function makes it easy to enable all of the Sphinx
    customizations provided by the :mod:`humanfriendly.sphinx` module with the
    least amount of code. All you need to do is to add the module name to the
    ``extensions`` variable in your ``conf.py`` file:

    .. code-block:: python

       # Sphinx extension module names.
       extensions = [
           'sphinx.ext.autodoc',
           'sphinx.ext.doctest',
           'sphinx.ext.intersphinx',
           'humanfriendly.sphinx',
       ]

    When Sphinx sees the :mod:`humanfriendly.sphinx` name it will import the
    module and call its :func:`setup()` function. This function will then call
    the following:

    - :func:`enable_deprecation_notes()`
    - :func:`enable_man_role()`
    - :func:`enable_pypi_role()`
    - :func:`enable_special_methods()`
    - :func:`enable_usage_formatting()`

    Of course more functionality may be added at a later stage. If you don't
    like that idea you may be better of calling the individual functions from
    your own ``setup()`` function.
    """
    from humanfriendly import __version__

    enable_deprecation_notes(app)
    enable_man_role(app)
    enable_pypi_role(app)
    enable_special_methods(app)
    enable_usage_formatting(app)

    return dict(parallel_read_safe=True, parallel_write_safe=True, version=__version__)


def special_methods_callback(app, what, name, obj, skip, options):
    """
    Enable documenting "special methods" using the autodoc_ extension.

    Refer to :func:`enable_special_methods()` to enable the use of this
    function (you probably don't want to call
    :func:`special_methods_callback()` directly).

    This function implements a callback for ``autodoc-skip-member`` events to
    include documented "special methods" (method names with two leading and two
    trailing underscores) in your documentation. The result is similar to the
    use of the ``special-members`` flag with one big difference: Special
    methods are included but other types of members are ignored. This means
    that attributes like ``__weakref__`` will always be ignored (this was my
    main annoyance with the ``special-members`` flag).

    The parameters expected by this function are those defined for Sphinx event
    callback functions (i.e. I'm not going to document them here :-).
    """
    if getattr(obj, "__doc__", None) and isinstance(obj, (types.FunctionType, types.MethodType)):
        return False
    else:
        return skip


def update_lines(lines, text):
    """Private helper for ``autodoc-process-docstring`` callbacks."""
    while lines:
        lines.pop()
    lines.extend(text.splitlines())


def usage_message_callback(app, what, name, obj, options, lines):
    """
    Reformat human friendly usage messages to reStructuredText_.

    Refer to :func:`enable_usage_formatting()` to enable the use of this
    function (you probably don't want to call :func:`usage_message_callback()`
    directly).

    This function implements a callback for ``autodoc-process-docstring`` that
    reformats module docstrings using :func:`.render_usage()` so that Sphinx
    doesn't mangle usage messages that were written to be human readable
    instead of machine readable. Only module docstrings whose first line starts
    with :data:`.USAGE_MARKER` are reformatted.

    The parameters expected by this function are those defined for Sphinx event
    callback functions (i.e. I'm not going to document them here :-).
    """
    # Make sure we only modify the docstrings of modules.
    if isinstance(obj, types.ModuleType) and lines:
        # Make sure we only modify docstrings containing a usage message.
        if lines[0].startswith(USAGE_MARKER):
            # Convert the usage message to reStructuredText.
            text = render_usage("\n".join(lines))
            # Fill up the buffer with our modified docstring.
            update_lines(lines, text)

"""Utilities to allow inserting docstring fragments for common
parameters into function and method docstrings."""

from collections.abc import Callable, Iterable, Mapping
from typing import Protocol, TypeVar
import sys

__all__ = [
    "docformat",
    "inherit_docstring_from",
    "indentcount_lines",
    "filldoc",
    "unindent_dict",
    "unindent_string",
    "extend_notes_in_docstring",
    "replace_notes_in_docstring",
    "doc_replace",
]

_F = TypeVar("_F", bound=Callable[..., object])


class Decorator(Protocol):
    """A decorator of a function."""

    def __call__(self, func: _F, /) -> _F: ...


def docformat(docstring: str, docdict: Mapping[str, str] | None = None) -> str:
    """Fill a function docstring from variables in dictionary.

    Adapt the indent of the inserted docs

    Parameters
    ----------
    docstring : str
        A docstring from a function, possibly with dict formatting strings.
    docdict : dict[str, str], optional
        A dictionary with keys that match the dict formatting strings
        and values that are docstring fragments to be inserted. The
        indentation of the inserted docstrings is set to match the
        minimum indentation of the ``docstring`` by adding this
        indentation to all lines of the inserted string, except the
        first.

    Returns
    -------
    docstring : str
        string with requested ``docdict`` strings inserted.

    Examples
    --------
    >>> docformat(' Test string with %(value)s', {'value':'inserted value'})
    ' Test string with inserted value'
    >>> docstring = 'First line\\n    Second line\\n    %(value)s'
    >>> inserted_string = "indented\\nstring"
    >>> docdict = {'value': inserted_string}
    >>> docformat(docstring, docdict)
    'First line\\n    Second line\\n    indented\\n    string'
    """
    if not docstring:
        return docstring
    if docdict is None:
        docdict = {}
    if not docdict:
        return docstring
    lines = docstring.expandtabs().splitlines()
    # Find the minimum indent of the main docstring, after first line
    if len(lines) < 2:
        icount = 0
    else:
        icount = indentcount_lines(lines[1:])
    indent = " " * icount
    # Insert this indent to dictionary docstrings
    indented = {}
    for name, dstr in docdict.items():
        lines = dstr.expandtabs().splitlines()
        indented[name] = ("\n" + indent).join(lines)
    return docstring % indented


def inherit_docstring_from(cls: object) -> Decorator:
    """This decorator modifies the decorated function's docstring by
    replacing occurrences of '%(super)s' with the docstring of the
    method of the same name from the class `cls`.

    If the decorated method has no docstring, it is simply given the
    docstring of `cls`s method.

    Parameters
    ----------
    cls : type or object
        A class with a method with the same name as the decorated method.
        The docstring of the method in this class replaces '%(super)s' in the
        docstring of the decorated method.

    Returns
    -------
    decfunc : function
        The decorator function that modifies the __doc__ attribute
        of its argument.

    Examples
    --------
    In the following, the docstring for Bar.func created using the
    docstring of `Foo.func`.

    >>> class Foo:
    ...     def func(self):
    ...         '''Do something useful.'''
    ...         return
    ...
    >>> class Bar(Foo):
    ...     @inherit_docstring_from(Foo)
    ...     def func(self):
    ...         '''%(super)s
    ...         Do it fast.
    ...         '''
    ...         return
    ...
    >>> b = Bar()
    >>> b.func.__doc__
    'Do something useful.\n        Do it fast.\n        '
    """

    def _doc(func: _F) -> _F:
        cls_docstring = getattr(cls, func.__name__).__doc__
        func_docstring = func.__doc__
        if func_docstring is None:
            func.__doc__ = cls_docstring
        else:
            new_docstring = func_docstring % dict(super=cls_docstring)
            func.__doc__ = new_docstring
        return func

    return _doc


def extend_notes_in_docstring(cls: object, notes: str) -> Decorator:
    """This decorator replaces the decorated function's docstring
    with the docstring from corresponding method in `cls`.
    It extends the 'Notes' section of that docstring to include
    the given `notes`.

    Parameters
    ----------
    cls : type or object
        A class with a method with the same name as the decorated method.
        The docstring of the method in this class replaces the docstring of the
        decorated method.
    notes : str
        Additional notes to append to the 'Notes' section of the docstring.

    Returns
    -------
    decfunc : function
        The decorator function that modifies the __doc__ attribute
        of its argument.
    """

    def _doc(func: _F) -> _F:
        cls_docstring = getattr(cls, func.__name__).__doc__
        # If python is called with -OO option,
        # there is no docstring
        if cls_docstring is None:
            return func
        end_of_notes = cls_docstring.find("        References\n")
        if end_of_notes == -1:
            end_of_notes = cls_docstring.find("        Examples\n")
            if end_of_notes == -1:
                end_of_notes = len(cls_docstring)
        func.__doc__ = (
            cls_docstring[:end_of_notes] + notes + cls_docstring[end_of_notes:]
        )
        return func

    return _doc


def replace_notes_in_docstring(cls: object, notes: str) -> Decorator:
    """This decorator replaces the decorated function's docstring
    with the docstring from corresponding method in `cls`.
    It replaces the 'Notes' section of that docstring with
    the given `notes`.

    Parameters
    ----------
    cls : type or object
        A class with a method with the same name as the decorated method.
        The docstring of the method in this class replaces the docstring of the
        decorated method.
    notes : str
        The notes to replace the existing 'Notes' section with.

    Returns
    -------
    decfunc : function
        The decorator function that modifies the __doc__ attribute
        of its argument.
    """

    def _doc(func: _F) -> _F:
        cls_docstring = getattr(cls, func.__name__).__doc__
        notes_header = "        Notes\n        -----\n"
        # If python is called with -OO option,
        # there is no docstring
        if cls_docstring is None:
            return func
        start_of_notes = cls_docstring.find(notes_header)
        end_of_notes = cls_docstring.find("        References\n")
        if end_of_notes == -1:
            end_of_notes = cls_docstring.find("        Examples\n")
            if end_of_notes == -1:
                end_of_notes = len(cls_docstring)
        func.__doc__ = (
            cls_docstring[: start_of_notes + len(notes_header)]
            + notes
            + cls_docstring[end_of_notes:]
        )
        return func

    return _doc


def indentcount_lines(lines: Iterable[str]) -> int:
    """Minimum indent for all lines in line list

    Parameters
    ----------
    lines : Iterable[str]
        The lines to find the minimum indent of.

    Returns
    -------
    indent : int
        The minimum indent.


    Examples
    --------
    >>> lines = [' one', '  two', '   three']
    >>> indentcount_lines(lines)
    1
    >>> lines = []
    >>> indentcount_lines(lines)
    0
    >>> lines = [' one']
    >>> indentcount_lines(lines)
    1
    >>> indentcount_lines(['    '])
    0
    """
    indentno = sys.maxsize
    for line in lines:
        stripped = line.lstrip()
        if stripped:
            indentno = min(indentno, len(line) - len(stripped))
    if indentno == sys.maxsize:
        return 0
    return indentno


def filldoc(docdict: Mapping[str, str], unindent_params: bool = True) -> Decorator:
    """Return docstring decorator using docdict variable dictionary.

    Parameters
    ----------
    docdict : dict[str, str]
        A dictionary containing name, docstring fragment pairs.
    unindent_params : bool, optional
        If True, strip common indentation from all parameters in docdict.
        Default is False.

    Returns
    -------
    decfunc : function
        The decorator function that applies dictionary to its
        argument's __doc__ attribute.
    """
    if unindent_params:
        docdict = unindent_dict(docdict)

    def decorate(func: _F) -> _F:
        # __doc__ may be None for optimized Python (-OO)
        doc = func.__doc__ or ""
        func.__doc__ = docformat(doc, docdict)
        return func

    return decorate


def unindent_dict(docdict: Mapping[str, str]) -> dict[str, str]:
    """Unindent all strings in a docdict.

    Parameters
    ----------
    docdict : dict[str, str]
        A dictionary with string values to unindent.

    Returns
    -------
    docdict : dict[str, str]
        The `docdict` dictionary but each of its string values are unindented.
    """
    can_dict: dict[str, str] = {}
    for name, dstr in docdict.items():
        can_dict[name] = unindent_string(dstr)
    return can_dict


def unindent_string(docstring: str) -> str:
    """Set docstring to minimum indent for all lines, including first.

    Parameters
    ----------
    docstring : str
        The input docstring to unindent.

    Returns
    -------
    docstring : str
        The unindented docstring.

    Examples
    --------
    >>> unindent_string(' two')
    'two'
    >>> unindent_string('  two\\n   three')
    'two\\n three'
    """
    lines = docstring.expandtabs().splitlines()
    icount = indentcount_lines(lines)
    if icount == 0:
        return docstring
    return "\n".join([line[icount:] for line in lines])


def doc_replace(obj: object, oldval: str, newval: str) -> Decorator:
    """Decorator to take the docstring from obj, with oldval replaced by newval

    Equivalent to ``func.__doc__ = obj.__doc__.replace(oldval, newval)``

    Parameters
    ----------
    obj : object
        A class or object whose docstring will be used as the basis for the
        replacement operation.
    oldval : str
        The string to search for in the docstring.
    newval : str
        The string to replace `oldval` with in the docstring.

    Returns
    -------
    decfunc : function
        A decorator function that replaces occurrences of `oldval` with `newval`
        in the docstring of the decorated function.
    """
    # __doc__ may be None for optimized Python (-OO)
    doc = (obj.__doc__ or "").replace(oldval, newval)

    def inner(func: _F) -> _F:
        func.__doc__ = doc
        return func

    return inner

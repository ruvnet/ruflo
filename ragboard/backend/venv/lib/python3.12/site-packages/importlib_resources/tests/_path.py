import functools
import pathlib
from typing import Dict, Protocol, Union, runtime_checkable

####
# from jaraco.path 3.7.1


class Symlink(str):
    """
    A string indicating the target of a symlink.
    """


FilesSpec = Dict[str, Union[str, bytes, Symlink, 'FilesSpec']]


@runtime_checkable
class TreeMaker(Protocol):
    def __truediv__(self, *args, **kwargs): ...  # pragma: no cover

    def mkdir(self, **kwargs): ...  # pragma: no cover

    def write_text(self, content, **kwargs): ...  # pragma: no cover

    def write_bytes(self, content): ...  # pragma: no cover

    def symlink_to(self, target): ...  # pragma: no cover


def _ensure_tree_maker(obj: Union[str, TreeMaker]) -> TreeMaker:
    return obj if isinstance(obj, TreeMaker) else pathlib.Path(obj)  # type: ignore[return-value]


def build(
    spec: FilesSpec,
    prefix: Union[str, TreeMaker] = pathlib.Path(),  # type: ignore[assignment]
):
    """
    Build a set of files/directories, as described by the spec.

    Each key represents a pathname, and the value represents
    the content. Content may be a nested directory.

    >>> spec = {
    ...     'README.txt': "A README file",
    ...     "foo": {
    ...         "__init__.py": "",
    ...         "bar": {
    ...             "__init__.py": "",
    ...         },
    ...         "baz.py": "# Some code",
    ...         "bar.py": Symlink("baz.py"),
    ...     },
    ...     "bing": Symlink("foo"),
    ... }
    >>> target = getfixture('tmp_path')
    >>> build(spec, target)
    >>> target.joinpath('foo/baz.py').read_text(encoding='utf-8')
    '# Some code'
    >>> target.joinpath('bing/bar.py').read_text(encoding='utf-8')
    '# Some code'
    """
    for name, contents in spec.items():
        create(contents, _ensure_tree_maker(prefix) / name)


@functools.singledispatch
def create(content: Union[str, bytes, FilesSpec], path):
    path.mkdir(exist_ok=True)
    build(content, prefix=path)  # type: ignore[arg-type]


@create.register
def _(content: bytes, path):
    path.write_bytes(content)


@create.register
def _(content: str, path):
    path.write_text(content, encoding='utf-8')


@create.register
def _(content: Symlink, path):
    path.symlink_to(content)


# end from jaraco.path
####

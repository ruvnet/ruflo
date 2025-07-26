import abc
import contextlib
import functools
import importlib
import io
import pathlib
import sys
import types
from importlib.machinery import ModuleSpec

from ..abc import ResourceReader, Traversable, TraversableResources
from . import _path
from . import zip as zip_
from .compat.py39 import import_helper, os_helper


class Reader(ResourceReader):
    def __init__(self, **kwargs):
        vars(self).update(kwargs)

    def get_resource_reader(self, package):
        return self

    def open_resource(self, path):
        self._path = path
        if isinstance(self.file, Exception):
            raise self.file
        return self.file

    def resource_path(self, path_):
        self._path = path_
        if isinstance(self.path, Exception):
            raise self.path
        return self.path

    def is_resource(self, path_):
        self._path = path_
        if isinstance(self.path, Exception):
            raise self.path

        def part(entry):
            return entry.split('/')

        return any(
            len(parts) == 1 and parts[0] == path_ for parts in map(part, self._contents)
        )

    def contents(self):
        if isinstance(self.path, Exception):
            raise self.path
        yield from self._contents


def create_package_from_loader(loader, is_package=True):
    name = 'testingpackage'
    module = types.ModuleType(name)
    spec = ModuleSpec(name, loader, origin='does-not-exist', is_package=is_package)
    module.__spec__ = spec
    module.__loader__ = loader
    return module


def create_package(file=None, path=None, is_package=True, contents=()):
    return create_package_from_loader(
        Reader(file=file, path=path, _contents=contents),
        is_package,
    )


class CommonTestsBase(metaclass=abc.ABCMeta):
    """
    Tests shared by test_open, test_path, and test_read.
    """

    @abc.abstractmethod
    def execute(self, package, path):
        """
        Call the pertinent legacy API function (e.g. open_text, path)
        on package and path.
        """

    def test_package_name(self):
        """
        Passing in the package name should succeed.
        """
        self.execute(self.data.__name__, 'utf-8.file')

    def test_package_object(self):
        """
        Passing in the package itself should succeed.
        """
        self.execute(self.data, 'utf-8.file')

    def test_string_path(self):
        """
        Passing in a string for the path should succeed.
        """
        path = 'utf-8.file'
        self.execute(self.data, path)

    def test_pathlib_path(self):
        """
        Passing in a pathlib.PurePath object for the path should succeed.
        """
        path = pathlib.PurePath('utf-8.file')
        self.execute(self.data, path)

    def test_importing_module_as_side_effect(self):
        """
        The anchor package can already be imported.
        """
        del sys.modules[self.data.__name__]
        self.execute(self.data.__name__, 'utf-8.file')

    def test_missing_path(self):
        """
        Attempting to open or read or request the path for a
        non-existent path should succeed if open_resource
        can return a viable data stream.
        """
        bytes_data = io.BytesIO(b'Hello, world!')
        package = create_package(file=bytes_data, path=FileNotFoundError())
        self.execute(package, 'utf-8.file')
        self.assertEqual(package.__loader__._path, 'utf-8.file')

    def test_extant_path(self):
        # Attempting to open or read or request the path when the
        # path does exist should still succeed. Does not assert
        # anything about the result.
        bytes_data = io.BytesIO(b'Hello, world!')
        # any path that exists
        path = __file__
        package = create_package(file=bytes_data, path=path)
        self.execute(package, 'utf-8.file')
        self.assertEqual(package.__loader__._path, 'utf-8.file')

    def test_useless_loader(self):
        package = create_package(file=FileNotFoundError(), path=FileNotFoundError())
        with self.assertRaises(FileNotFoundError):
            self.execute(package, 'utf-8.file')


fixtures = dict(
    data01={
        '__init__.py': '',
        'binary.file': bytes(range(4)),
        'utf-16.file': '\ufeffHello, UTF-16 world!\n'.encode('utf-16-le'),
        'utf-8.file': 'Hello, UTF-8 world!\n'.encode('utf-8'),
        'subdirectory': {
            '__init__.py': '',
            'binary.file': bytes(range(4, 8)),
        },
    },
    data02={
        '__init__.py': '',
        'one': {'__init__.py': '', 'resource1.txt': 'one resource'},
        'two': {'__init__.py': '', 'resource2.txt': 'two resource'},
        'subdirectory': {'subsubdir': {'resource.txt': 'a resource'}},
    },
    namespacedata01={
        'binary.file': bytes(range(4)),
        'utf-16.file': '\ufeffHello, UTF-16 world!\n'.encode('utf-16-le'),
        'utf-8.file': 'Hello, UTF-8 world!\n'.encode('utf-8'),
        'subdirectory': {
            'binary.file': bytes(range(12, 16)),
        },
    },
)


class ModuleSetup:
    def setUp(self):
        self.fixtures = contextlib.ExitStack()
        self.addCleanup(self.fixtures.close)

        self.fixtures.enter_context(import_helper.isolated_modules())
        self.data = self.load_fixture(self.MODULE)

    def load_fixture(self, module):
        self.tree_on_path({module: fixtures[module]})
        return importlib.import_module(module)


class ZipSetup(ModuleSetup):
    MODULE = 'data01'

    def tree_on_path(self, spec):
        temp_dir = self.fixtures.enter_context(os_helper.temp_dir())
        modules = pathlib.Path(temp_dir) / 'zipped modules.zip'
        self.fixtures.enter_context(
            import_helper.DirsOnSysPath(str(zip_.make_zip_file(spec, modules)))
        )


class DiskSetup(ModuleSetup):
    MODULE = 'data01'

    def tree_on_path(self, spec):
        temp_dir = self.fixtures.enter_context(os_helper.temp_dir())
        _path.build(spec, pathlib.Path(temp_dir))
        self.fixtures.enter_context(import_helper.DirsOnSysPath(temp_dir))


class MemorySetup(ModuleSetup):
    """Support loading a module in memory."""

    MODULE = 'data01'

    def load_fixture(self, module):
        self.fixtures.enter_context(self.augment_sys_metapath(module))
        return importlib.import_module(module)

    @contextlib.contextmanager
    def augment_sys_metapath(self, module):
        finder_instance = self.MemoryFinder(module)
        sys.meta_path.append(finder_instance)
        yield
        sys.meta_path.remove(finder_instance)

    class MemoryFinder(importlib.abc.MetaPathFinder):
        def __init__(self, module):
            self._module = module

        def find_spec(self, fullname, path, target=None):
            if fullname != self._module:
                return None

            return importlib.machinery.ModuleSpec(
                name=fullname,
                loader=MemorySetup.MemoryLoader(self._module),
                is_package=True,
            )

    class MemoryLoader(importlib.abc.Loader):
        def __init__(self, module):
            self._module = module

        def exec_module(self, module):
            pass

        def get_resource_reader(self, fullname):
            return MemorySetup.MemoryTraversableResources(self._module, fullname)

    class MemoryTraversableResources(TraversableResources):
        def __init__(self, module, fullname):
            self._module = module
            self._fullname = fullname

        def files(self):
            return MemorySetup.MemoryTraversable(self._module, self._fullname)

    class MemoryTraversable(Traversable):
        """Implement only the abstract methods of `Traversable`.

        Besides `.__init__()`, no other methods may be implemented or overridden.
        This is critical for validating the concrete `Traversable` implementations.
        """

        def __init__(self, module, fullname):
            self._module = module
            self._fullname = fullname

        def _resolve(self):
            """
            Fully traverse the `fixtures` dictionary.

            This should be wrapped in a `try/except KeyError`
            but it is not currently needed and lowers the code coverage numbers.
            """
            path = pathlib.PurePosixPath(self._fullname)
            return functools.reduce(lambda d, p: d[p], path.parts, fixtures)

        def iterdir(self):
            directory = self._resolve()
            if not isinstance(directory, dict):
                # Filesystem openers raise OSError, and that exception is mirrored here.
                raise OSError(f"{self._fullname} is not a directory")
            for path in directory:
                yield MemorySetup.MemoryTraversable(
                    self._module, f"{self._fullname}/{path}"
                )

        def is_dir(self) -> bool:
            return isinstance(self._resolve(), dict)

        def is_file(self) -> bool:
            return not self.is_dir()

        def open(self, mode='r', encoding=None, errors=None, *_, **__):
            contents = self._resolve()
            if isinstance(contents, dict):
                # Filesystem openers raise OSError when attempting to open a directory,
                # and that exception is mirrored here.
                raise OSError(f"{self._fullname} is a directory")
            if isinstance(contents, str):
                contents = contents.encode("utf-8")
            result = io.BytesIO(contents)
            if "b" in mode:
                return result
            return io.TextIOWrapper(result, encoding=encoding, errors=errors)

        @property
        def name(self):
            return pathlib.PurePosixPath(self._fullname).name


class CommonTests(DiskSetup, CommonTestsBase):
    pass

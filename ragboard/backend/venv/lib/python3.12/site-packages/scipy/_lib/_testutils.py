"""
Generic test utilities.

"""

import inspect
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import threading
from importlib.util import module_from_spec, spec_from_file_location

import numpy as np
import scipy

try:
    # Need type: ignore[import-untyped] for mypy >= 1.6
    import cython  # type: ignore[import-untyped]
    from Cython.Compiler.Version import (  # type: ignore[import-untyped]
        version as cython_version,
    )
except ImportError:
    cython = None
else:
    from scipy._lib import _pep440
    required_version = '3.0.8'
    if _pep440.parse(cython_version) < _pep440.Version(required_version):
        # too old or wrong cython, skip Cython API tests
        cython = None


__all__ = ['PytestTester', 'check_free_memory', '_TestPythranFunc', 'IS_MUSL']


IS_MUSL = False
# alternate way is
# from packaging.tags import sys_tags
#     _tags = list(sys_tags())
#     if 'musllinux' in _tags[0].platform:
_v = sysconfig.get_config_var('HOST_GNU_TYPE') or ''
if 'musl' in _v:
    IS_MUSL = True


IS_EDITABLE = 'editable' in scipy.__path__[0]


class FPUModeChangeWarning(RuntimeWarning):
    """Warning about FPU mode change"""
    pass


class PytestTester:
    """
    Run tests for this namespace

    ``scipy.test()`` runs tests for all of SciPy, with the default settings.
    When used from a submodule (e.g., ``scipy.cluster.test()``, only the tests
    for that namespace are run.

    Parameters
    ----------
    label : {'fast', 'full'}, optional
        Whether to run only the fast tests, or also those marked as slow.
        Default is 'fast'.
    verbose : int, optional
        Test output verbosity. Default is 1.
    extra_argv : list, optional
        Arguments to pass through to Pytest.
    doctests : bool, optional
        Whether to run doctests or not. Default is False.
    coverage : bool, optional
        Whether to run tests with code coverage measurements enabled.
        Default is False.
    tests : list of str, optional
        List of module names to run tests for. By default, uses the module
        from which the ``test`` function is called.
    parallel : int, optional
        Run tests in parallel with pytest-xdist, if number given is larger than
        1. Default is 1.

    """
    def __init__(self, module_name):
        self.module_name = module_name

    def __call__(self, label="fast", verbose=1, extra_argv=None, doctests=False,
                 coverage=False, tests=None, parallel=None):
        import pytest

        module = sys.modules[self.module_name]
        module_path = os.path.abspath(module.__path__[0])

        pytest_args = ['--showlocals', '--tb=short']

        if extra_argv is None:
            extra_argv = []
        pytest_args += extra_argv
        if any(arg == "-m" or arg == "--markers" for arg in extra_argv):
            # Likely conflict with default --mode=fast
            raise ValueError("Must specify -m before --")

        if verbose and int(verbose) > 1:
            pytest_args += ["-" + "v"*(int(verbose)-1)]

        if coverage:
            pytest_args += ["--cov=" + module_path]

        if label == "fast":
            pytest_args += ["-m", "not slow"]
        elif label != "full":
            pytest_args += ["-m", label]

        if tests is None:
            tests = [self.module_name]

        if parallel is not None and parallel > 1:
            if _pytest_has_xdist():
                pytest_args += ['-n', str(parallel)]
            else:
                import warnings
                warnings.warn('Could not run tests in parallel because '
                              'pytest-xdist plugin is not available.',
                              stacklevel=2)

        pytest_args += ['--pyargs'] + list(tests)

        try:
            code = pytest.main(pytest_args)
        except SystemExit as exc:
            code = exc.code

        return (code == 0)


class _TestPythranFunc:
    '''
    These are situations that can be tested in our pythran tests:
    - A function with multiple array arguments and then
      other positional and keyword arguments.
    - A function with array-like keywords (e.g. `def somefunc(x0, x1=None)`.
    Note: list/tuple input is not yet tested!

    `self.arguments`: A dictionary which key is the index of the argument,
                      value is tuple(array value, all supported dtypes)
    `self.partialfunc`: A function used to freeze some non-array argument
                        that of no interests in the original function
    '''
    ALL_INTEGER = [np.int8, np.int16, np.int32, np.int64, np.intc, np.intp]
    ALL_FLOAT = [np.float32, np.float64]
    ALL_COMPLEX = [np.complex64, np.complex128]

    def setup_method(self):
        self.arguments = {}
        self.partialfunc = None
        self.expected = None

    def get_optional_args(self, func):
        # get optional arguments with its default value,
        # used for testing keywords
        signature = inspect.signature(func)
        optional_args = {}
        for k, v in signature.parameters.items():
            if v.default is not inspect.Parameter.empty:
                optional_args[k] = v.default
        return optional_args

    def get_max_dtype_list_length(self):
        # get the max supported dtypes list length in all arguments
        max_len = 0
        for arg_idx in self.arguments:
            cur_len = len(self.arguments[arg_idx][1])
            if cur_len > max_len:
                max_len = cur_len
        return max_len

    def get_dtype(self, dtype_list, dtype_idx):
        # get the dtype from dtype_list via index
        # if the index is out of range, then return the last dtype
        if dtype_idx > len(dtype_list)-1:
            return dtype_list[-1]
        else:
            return dtype_list[dtype_idx]

    def test_all_dtypes(self):
        for type_idx in range(self.get_max_dtype_list_length()):
            args_array = []
            for arg_idx in self.arguments:
                new_dtype = self.get_dtype(self.arguments[arg_idx][1],
                                           type_idx)
                args_array.append(self.arguments[arg_idx][0].astype(new_dtype))
            self.pythranfunc(*args_array)

    def test_views(self):
        args_array = []
        for arg_idx in self.arguments:
            args_array.append(self.arguments[arg_idx][0][::-1][::-1])
        self.pythranfunc(*args_array)

    def test_strided(self):
        args_array = []
        for arg_idx in self.arguments:
            args_array.append(np.repeat(self.arguments[arg_idx][0],
                                        2, axis=0)[::2])
        self.pythranfunc(*args_array)


def _pytest_has_xdist():
    """
    Check if the pytest-xdist plugin is installed, providing parallel tests
    """
    # Check xdist exists without importing, otherwise pytests emits warnings
    from importlib.util import find_spec
    return find_spec('xdist') is not None


def check_free_memory(free_mb):
    """
    Check *free_mb* of memory is available, otherwise do pytest.skip
    """
    import pytest

    try:
        mem_free = _parse_size(os.environ['SCIPY_AVAILABLE_MEM'])
        msg = '{} MB memory required, but environment SCIPY_AVAILABLE_MEM={}'.format(
            free_mb, os.environ['SCIPY_AVAILABLE_MEM'])
    except KeyError:
        mem_free = _get_mem_available()
        if mem_free is None:
            pytest.skip("Could not determine available memory; set SCIPY_AVAILABLE_MEM "
                        "variable to free memory in MB to run the test.")
        msg = f'{free_mb} MB memory required, but {mem_free/1e6} MB available'

    if mem_free < free_mb * 1e6:
        pytest.skip(msg)


def _parse_size(size_str):
    suffixes = {'': 1e6,
                'b': 1.0,
                'k': 1e3, 'M': 1e6, 'G': 1e9, 'T': 1e12,
                'kb': 1e3, 'Mb': 1e6, 'Gb': 1e9, 'Tb': 1e12,
                'kib': 1024.0, 'Mib': 1024.0**2, 'Gib': 1024.0**3, 'Tib': 1024.0**4}
    m = re.match(r'^\s*(\d+)\s*({})\s*$'.format('|'.join(suffixes.keys())),
                 size_str,
                 re.I)
    if not m or m.group(2) not in suffixes:
        raise ValueError("Invalid size string")

    return float(m.group(1)) * suffixes[m.group(2)]


def _get_mem_available():
    """
    Get information about memory available, not counting swap.
    """
    try:
        import psutil
        return psutil.virtual_memory().available
    except (ImportError, AttributeError):
        pass

    if sys.platform.startswith('linux'):
        info = {}
        with open('/proc/meminfo') as f:
            for line in f:
                p = line.split()
                info[p[0].strip(':').lower()] = float(p[1]) * 1e3

        if 'memavailable' in info:
            # Linux >= 3.14
            return info['memavailable']
        else:
            return info['memfree'] + info['cached']

    return None

def _test_cython_extension(tmp_path, srcdir):
    """
    Helper function to test building and importing Cython modules that
    make use of the Cython APIs for BLAS, LAPACK, optimize, and special.
    """
    import pytest
    try:
        subprocess.check_call(["meson", "--version"])
    except FileNotFoundError:
        pytest.skip("No usable 'meson' found")

    # Make safe for being called by multiple threads within one test
    tmp_path = tmp_path / str(threading.get_ident())

    # build the examples in a temporary directory
    mod_name = os.path.split(srcdir)[1]
    shutil.copytree(srcdir, tmp_path / mod_name)
    build_dir = tmp_path / mod_name / 'tests' / '_cython_examples'
    target_dir = build_dir / 'build'
    os.makedirs(target_dir, exist_ok=True)

    # Ensure we use the correct Python interpreter even when `meson` is
    # installed in a different Python environment (see numpy#24956)
    native_file = str(build_dir / 'interpreter-native-file.ini')
    with open(native_file, 'w') as f:
        f.write("[binaries]\n")
        f.write(f"python = '{sys.executable}'")

    if sys.platform == "win32":
        subprocess.check_call(["meson", "setup",
                               "--buildtype=release",
                               "--native-file", native_file,
                               "--vsenv", str(build_dir)],
                              cwd=target_dir,
                              )
    else:
        subprocess.check_call(["meson", "setup",
                               "--native-file", native_file, str(build_dir)],
                              cwd=target_dir
                              )
    subprocess.check_call(["meson", "compile", "-vv"], cwd=target_dir)

    # import without adding the directory to sys.path
    suffix = sysconfig.get_config_var('EXT_SUFFIX')

    def load(modname):
        so = (target_dir / modname).with_suffix(suffix)
        spec = spec_from_file_location(modname, so)
        mod = module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    # test that the module can be imported
    return load("extending"), load("extending_cpp")


def _run_concurrent_barrier(n_workers, fn, *args, **kwargs):
    """
    Run a given function concurrently across a given number of threads.

    This is equivalent to using a ThreadPoolExecutor, but using the threading
    primitives instead. This function ensures that the closure passed by
    parameter gets called concurrently by setting up a barrier before it gets
    called before any of the threads.

    Arguments
    ---------
    n_workers: int
        Number of concurrent threads to spawn.
    fn: callable
        Function closure to execute concurrently. Its first argument will
        be the thread id.
    *args: tuple
        Variable number of positional arguments to pass to the function.
    **kwargs: dict
        Keyword arguments to pass to the function.
    """
    barrier = threading.Barrier(n_workers)

    def closure(i, *args, **kwargs):
        barrier.wait()
        fn(i, *args, **kwargs)

    workers = []
    for i in range(0, n_workers):
        workers.append(threading.Thread(
            target=closure,
            args=(i,) + args, kwargs=kwargs))

    for worker in workers:
        worker.start()

    for worker in workers:
        worker.join()

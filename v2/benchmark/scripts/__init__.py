import pathlib
import sys

# Make the hive-mind-benchmarks/scripts directory available under the
# top-level 'scripts' package so tests can import 'scripts.*'.
_here = pathlib.Path(__file__).resolve()
_bench_root = _here.parent
_alternate = _bench_root / 'hive-mind-benchmarks' / 'scripts'
if _alternate.exists():
    # prepend to package __path__ so imports find modules there
    __path__.insert(0, str(_alternate))
"""
Executable scripts for swarm benchmarking.

This module contains standalone scripts for running performance tests,
load tests, and monitoring tools.
"""
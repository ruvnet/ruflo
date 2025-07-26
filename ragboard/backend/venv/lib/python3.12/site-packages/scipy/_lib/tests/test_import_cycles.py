import pytest
import sys
import subprocess

from .test_public_api import PUBLIC_MODULES

# Regression tests for gh-6793.
# Check that all modules are importable in a new Python process.
# This is not necessarily true if there are import cycles present.

@pytest.mark.fail_slow(40)
@pytest.mark.slow
@pytest.mark.thread_unsafe
def test_public_modules_importable():
    pids = [subprocess.Popen([sys.executable, '-c', f'import {module}'])
            for module in PUBLIC_MODULES]
    for i, pid in enumerate(pids):
        assert pid.wait() == 0, f'Failed to import {PUBLIC_MODULES[i]}'

import numpy as np
import pytest

from scipy.special import _test_internal


@pytest.mark.fail_slow(20)
@pytest.mark.skipif(not _test_internal.have_fenv(), reason="no fenv()")
def test_add_round_up():
    rng = np.random.RandomState(1234)
    _test_internal.test_add_round(10**5, 'up', rng)


@pytest.mark.fail_slow(20)
@pytest.mark.skipif(not _test_internal.have_fenv(), reason="no fenv()")
def test_add_round_down():
    rng = np.random.RandomState(1234)
    _test_internal.test_add_round(10**5, 'down', rng)

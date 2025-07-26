from scipy.constants import find, value, c, speed_of_light, precision
from numpy.testing import assert_equal, assert_, assert_almost_equal
import scipy.constants._codata as _cd
from scipy import constants


def test_find():
    keys = find('weak mixing', disp=False)
    assert_equal(keys, ['weak mixing angle'])

    keys = find('qwertyuiop', disp=False)
    assert_equal(keys, [])

    keys = find('natural unit', disp=False)
    assert_equal(keys, sorted(['natural unit of velocity',
                                'natural unit of action',
                                'natural unit of action in eV s',
                                'natural unit of mass',
                                'natural unit of energy',
                                'natural unit of energy in MeV',
                                'natural unit of momentum',
                                'natural unit of momentum in MeV/c',
                                'natural unit of length',
                                'natural unit of time']))


def test_basic_table_parse():
    c_s = 'speed of light in vacuum'
    assert_equal(value(c_s), c)
    assert_equal(value(c_s), speed_of_light)


def test_basic_lookup():
    assert_equal('{} {}'.format(int(_cd.value('speed of light in vacuum')),
                                _cd.unit('speed of light in vacuum')),
                 '299792458 m s^-1')


def test_find_all():
    assert_(len(find(disp=False)) > 300)


def test_find_single():
    assert_equal(find('Wien freq', disp=False)[0],
                 'Wien frequency displacement law constant')


def test_2002_vs_2006():
    assert_almost_equal(value('magn. flux quantum'),
                        value('mag. flux quantum'))


def test_exact_values():
    # Check that updating stored values with exact ones worked.
    exact = dict((k, v[0]) for k, v in _cd._physical_constants_2018.items())
    replace = _cd.exact2018(exact)
    for key, val in replace.items():
        assert_equal(val, value(key))
        assert precision(key) == 0


def test_gh11341():
    # gh-11341 noted that these three constants should exist (for backward
    # compatibility) and should always have the same value:
    a = constants.epsilon_0
    b = constants.physical_constants['electric constant'][0]
    c = constants.physical_constants['vacuum electric permittivity'][0]
    assert a == b == c


def test_gh14467():
    # gh-14467 noted that some physical constants in CODATA are rounded
    # to only ten significant figures even though they are supposed to be
    # exact. Check that (at least) the case mentioned in the issue is resolved.
    res = constants.physical_constants['Boltzmann constant in eV/K'][0]
    ref = (constants.physical_constants['Boltzmann constant'][0]
           / constants.physical_constants['elementary charge'][0])
    assert res == ref

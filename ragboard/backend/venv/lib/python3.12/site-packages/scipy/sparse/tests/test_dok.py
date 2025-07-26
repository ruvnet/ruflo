import pytest
import numpy as np
from numpy.testing import assert_equal
import scipy as sp
from scipy.sparse import dok_array, dok_matrix


pytestmark = pytest.mark.thread_unsafe


@pytest.fixture
def d():
    return {(0, 1): 1, (0, 2): 2}

@pytest.fixture
def A():
    return np.array([[0, 1, 2], [0, 0, 0], [0, 0, 0]])

@pytest.fixture(params=[dok_array, dok_matrix])
def Asp(request):
    A = request.param((3, 3))
    A[(0, 1)] = 1
    A[(0, 2)] = 2
    yield A

# Note: __iter__ and comparison dunders act like ndarrays for DOK, not dict.
# Dunders reversed, or, ror, ior work as dict for dok_matrix, raise for dok_array
# All other dict methods on DOK format act like dict methods (with extra checks).

# Start of tests
################
def test_dict_methods_covered(d, Asp):
    d_methods = set(dir(d)) - {"__class_getitem__"}
    asp_methods = set(dir(Asp))
    assert d_methods < asp_methods

def test_clear(d, Asp):
    assert d.items() == Asp.items()
    d.clear()
    Asp.clear()
    assert d.items() == Asp.items()

def test_copy(d, Asp):
    assert d.items() == Asp.items()
    dd = d.copy()
    asp = Asp.copy()
    assert dd.items() == asp.items()
    assert asp.items() == Asp.items()
    asp[(0, 1)] = 3
    assert Asp[(0, 1)] == 1

def test_fromkeys_default():
    # test with default value
    edges = [(0, 2), (1, 0), (2, 1)]
    Xdok = dok_array.fromkeys(edges)
    X = [[0, 0, 1], [1, 0, 0], [0, 1, 0]]
    assert_equal(Xdok.toarray(), X)

def test_fromkeys_positional():
    # test with positional value
    edges = [(0, 2), (1, 0), (2, 1)]
    Xdok = dok_array.fromkeys(edges, -1)
    X = [[0, 0, -1], [-1, 0, 0], [0, -1, 0]]
    assert_equal(Xdok.toarray(), X)

def test_fromkeys_iterator():
    it = ((a, a % 2) for a in range(4))
    Xdok = dok_array.fromkeys(it)
    X = [[1, 0], [0, 1], [1, 0], [0, 1]]
    assert_equal(Xdok.toarray(), X)

def test_get(d, Asp):
    assert Asp.get((0, 1)) == d.get((0, 1))
    assert Asp.get((0, 0), 99) == d.get((0, 0), 99)
    with pytest.raises(IndexError, match="out of bounds"):
        Asp.get((0, 4), 99)

def test_items(d, Asp):
    assert Asp.items() == d.items()

def test_keys(d, Asp):
    assert Asp.keys() == d.keys()

def test_pop(d, Asp):
    assert d.pop((0, 1)) == 1
    assert Asp.pop((0, 1)) == 1
    assert d.items() == Asp.items()

    assert Asp.pop((22, 21), None) is None
    assert Asp.pop((22, 21), "other") == "other"
    with pytest.raises(KeyError, match="(22, 21)"):
        Asp.pop((22, 21))
    with pytest.raises(TypeError, match="got an unexpected keyword argument"):
        Asp.pop((22, 21), default=5)

def test_popitem(d, Asp):
    assert d.popitem() == Asp.popitem()
    assert d.items() == Asp.items()

def test_setdefault(d, Asp):
    assert Asp.setdefault((0, 1), 4) == 1
    assert Asp.setdefault((2, 2), 4) == 4
    d.setdefault((0, 1), 4)
    d.setdefault((2, 2), 4)
    assert d.items() == Asp.items()

def test_update(d, Asp):
    with pytest.raises(NotImplementedError):
        Asp.update(Asp)

def test_values(d, Asp):
    # Note: dict.values are strange: d={1: 1}; d.values() == d.values() is False
    # Using list(d.values()) makes them comparable.
    assert list(Asp.values()) == list(d.values())

def test_dunder_getitem(d, Asp):
    assert Asp[(0, 1)] == d[(0, 1)]

def test_dunder_setitem(d, Asp):
    Asp[(1, 1)] = 5
    d[(1, 1)] = 5
    assert d.items() == Asp.items()

def test_dunder_delitem(d, Asp):
    del Asp[(0, 1)]
    del d[(0, 1)]
    assert d.items() == Asp.items()

def test_dunder_contains(d, Asp):
    assert ((0, 1) in d) == ((0, 1) in Asp)
    assert ((0, 0) in d) == ((0, 0) in Asp)

def test_dunder_len(d, Asp):
    assert len(d) == len(Asp)

# Note: dunders reversed, or, ror, ior work as dict for dok_matrix, raise for dok_array
def test_dunder_reversed(d, Asp):
    if isinstance(Asp, dok_array):
        with pytest.raises(TypeError):
            list(reversed(Asp))
    else:
        assert list(reversed(Asp)) == list(reversed(d))

def test_dunder_ior(d, Asp):
    if isinstance(Asp, dok_array):
        with pytest.raises(TypeError):
            Asp |= Asp
    else:
        dd = {(0, 0): 5}
        Asp |= dd
        assert Asp[(0, 0)] == 5
        d |= dd
        assert d.items() == Asp.items()
        dd |= Asp
        assert dd.items() == Asp.items()

def test_dunder_or(d, Asp):
    if isinstance(Asp, dok_array):
        with pytest.raises(TypeError):
            Asp | Asp
    else:
        assert d | d == Asp | d
        assert d | d == Asp | Asp

def test_dunder_ror(d, Asp):
    if isinstance(Asp, dok_array):
        with pytest.raises(TypeError):
            Asp | Asp
        with pytest.raises(TypeError):
            d | Asp
    else:
        assert Asp.__ror__(d) == Asp.__ror__(Asp)
        assert d.__ror__(d) == Asp.__ror__(d)
        assert d | Asp

# Note: comparison dunders, e.g. ==, >=, etc follow np.array not dict
def test_dunder_eq(A, Asp):
    with np.testing.suppress_warnings() as sup:
        sup.filter(sp.sparse.SparseEfficiencyWarning)
        assert (Asp == Asp).toarray().all()
        assert (A == Asp).all()

def test_dunder_ne(A, Asp):
    assert not (Asp != Asp).toarray().any()
    assert not (A != Asp).any()

def test_dunder_lt(A, Asp):
    assert not (Asp < Asp).toarray().any()
    assert not (A < Asp).any()

def test_dunder_gt(A, Asp):
    assert not (Asp > Asp).toarray().any()
    assert not (A > Asp).any()

def test_dunder_le(A, Asp):
    with np.testing.suppress_warnings() as sup:
        sup.filter(sp.sparse.SparseEfficiencyWarning)
        assert (Asp <= Asp).toarray().all()
        assert (A <= Asp).all()

def test_dunder_ge(A, Asp):
    with np.testing.suppress_warnings() as sup:
        sup.filter(sp.sparse.SparseEfficiencyWarning)
        assert (Asp >= Asp).toarray().all()
        assert (A >= Asp).all()

# Note: iter dunder follows np.array not dict
def test_dunder_iter(A, Asp):
    assert all((a == asp).all() for a, asp in zip(A, Asp))

import contextlib
import pytest
import numpy as np
from numpy.testing import assert_allclose, assert_equal

from scipy.sparse import csr_array, dok_array, SparseEfficiencyWarning
from .test_arithmetic1d import toarray


formats_for_index1d = [csr_array, dok_array]


@contextlib.contextmanager
def check_remains_sorted(X):
    """Checks that sorted indices property is retained through an operation"""
    yield
    if not hasattr(X, 'has_sorted_indices') or not X.has_sorted_indices:
        return
    indices = X.indices.copy()
    X.has_sorted_indices = False
    X.sort_indices()
    assert_equal(indices, X.indices, 'Expected sorted indices, found unsorted')


@pytest.mark.parametrize("spcreator", formats_for_index1d)
class TestGetSet1D:
    def test_None_index(self, spcreator):
        D = np.array([4, 3, 0])
        A = spcreator(D)

        N = D.shape[0]
        for j in range(-N, N):
            assert_equal(A[j, None].toarray(), D[j, None])
            assert_equal(A[None, j].toarray(), D[None, j])
            assert_equal(A[None, None, j].toarray(), D[None, None, j])

    def test_getitem_shape(self, spcreator):
        A = spcreator(np.arange(3 * 4).reshape(3, 4))
        assert A[1, 2].ndim == 0
        assert A[1, 2:3].shape == (1,)
        assert A[None, 1, 2:3].shape == (1, 1)
        assert A[None, 1, 2].shape == (1,)
        assert A[None, 1, 2, None].shape == (1, 1)

        # see gh-22458
        assert A[None, 1].shape == (1, 4)
        assert A[1, None].shape == (1, 4)
        assert A[None, 1, :].shape == (1, 4)
        assert A[1, None, :].shape == (1, 4)
        assert A[1, :, None].shape == (4, 1)

        with pytest.raises(IndexError, match='Only 1D or 2D arrays'):
            A[None, 2, 1, None, None]
        with pytest.raises(IndexError, match='Only 1D or 2D arrays'):
            A[None, 0:2, None, 1]
        with pytest.raises(IndexError, match='Only 1D or 2D arrays'):
            A[0:1, 1:, None]
        with pytest.raises(IndexError, match='Only 1D or 2D arrays'):
            A[1:, 1, None, None]

    def test_getelement(self, spcreator):
        D = np.array([4, 3, 0])
        A = spcreator(D)

        N = D.shape[0]
        for j in range(-N, N):
            assert_equal(A[j], D[j])

        for ij in [3, -4]:
            with pytest.raises(IndexError, match='index (.*) out of (range|bounds)'):
                A.__getitem__(ij)

        # single element tuples unwrapped
        assert A[(0,)] == 4

        with pytest.raises(IndexError, match='index (.*) out of (range|bounds)'):
            A.__getitem__((4,))

    def test_setelement(self, spcreator):
        dtype = np.float64
        A = spcreator((12,), dtype=dtype)
        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            A[0] = dtype(0)
            A[1] = dtype(3)
            A[8] = dtype(9.0)
            A[-2] = dtype(7)
            A[5] = 9

            A[-9,] = dtype(8)
            A[1,] = dtype(5)  # overwrite using 1-tuple index

            for ij in [13, -14, (13,), (14,)]:
                with pytest.raises(IndexError, match='out of (range|bounds)'):
                    A.__setitem__(ij, 123.0)


@pytest.mark.parametrize("spcreator", formats_for_index1d)
class TestSlicingAndFancy1D:
    #######################
    #  Int-like Array Index
    #######################
    def test_get_array_index(self, spcreator):
        D = np.array([4, 3, 0])
        A = spcreator(D)

        assert_equal(A[()].toarray(), D[()])
        for ij in [(0, 3), (3,)]:
            with pytest.raises(IndexError, match='out of (range|bounds)|many indices'):
                A.__getitem__(ij)

    def test_set_array_index(self, spcreator):
        dtype = np.float64
        A = spcreator((12,), dtype=dtype)
        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            A[np.array(6)] = dtype(4.0)  # scalar index
            A[np.array(6)] = dtype(2.0)  # overwrite with scalar index
            assert_equal(A.toarray(), [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0])

            for ij in [(13,), (-14,)]:
                with pytest.raises(IndexError, match='index .* out of (range|bounds)'):
                    A.__setitem__(ij, 123.0)

            for v in [(), (0, 3), [1, 2, 3], np.array([1, 2, 3])]:
                msg = 'Trying to assign a sequence to an item'
                with pytest.raises(ValueError, match=msg):
                    A.__setitem__(0, v)

    ####################
    #  1d Slice as index
    ####################
    def test_dtype_preservation(self, spcreator):
        assert_equal(spcreator((10,), dtype=np.int16)[1:5].dtype, np.int16)
        assert_equal(spcreator((6,), dtype=np.int32)[0:0:2].dtype, np.int32)
        assert_equal(spcreator((6,), dtype=np.int64)[:].dtype, np.int64)

    def test_get_1d_slice(self, spcreator):
        B = np.arange(50.)
        A = spcreator(B)
        assert_equal(B[:], A[:].toarray())
        assert_equal(B[2:5], A[2:5].toarray())

        C = np.array([4, 0, 6, 0, 0, 0, 0, 0, 1])
        D = spcreator(C)
        assert_equal(C[1:3], D[1:3].toarray())

        # Now test slicing when a row contains only zeros
        E = np.array([0, 0, 0, 0, 0])
        F = spcreator(E)
        assert_equal(E[1:3], F[1:3].toarray())
        assert_equal(E[-2:], F[-2:].toarray())
        assert_equal(E[:], F[:].toarray())
        assert_equal(E[slice(None)], F[slice(None)].toarray())

    def test_slicing_idx_slice(self, spcreator):
        B = np.arange(50)
        A = spcreator(B)

        # [i]
        assert_equal(A[2], B[2])
        assert_equal(A[-1], B[-1])
        assert_equal(A[np.array(-2)], B[-2])

        # [1:2]
        assert_equal(A[:].toarray(), B[:])
        assert_equal(A[5:-2].toarray(), B[5:-2])
        assert_equal(A[5:12:3].toarray(), B[5:12:3])

        # int8 slice
        s = slice(np.int8(2), np.int8(4), None)
        assert_equal(A[s].toarray(), B[2:4])

        # np.s_
        s_ = np.s_
        slices = [s_[:2], s_[1:2], s_[3:], s_[3::2],
                  s_[15:20], s_[3:2],
                  s_[8:3:-1], s_[4::-2], s_[:5:-1],
                  0, 1, s_[:], s_[1:5], -1, -2, -5,
                  np.array(-1), np.int8(-3)]

        for j, a in enumerate(slices):
            x = A[a]
            y = B[a]
            if y.shape == ():
                assert_equal(x, y, repr(a))
            else:
                if x.size == 0 and y.size == 0:
                    pass
                else:
                    assert_equal(x.toarray(), y, repr(a))

    def test_ellipsis_1d_slicing(self, spcreator):
        B = np.arange(50)
        A = spcreator(B)
        assert_equal(A[...].toarray(), B[...])
        assert_equal(A[...,].toarray(), B[...,])

    ##########################
    #  Assignment with Slicing
    ##########################
    def test_slice_scalar_assign(self, spcreator):
        A = spcreator((5,))
        B = np.zeros((5,))
        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            for C in [A, B]:
                C[0:1] = 1
                C[2:0] = 4
                C[2:3] = 9
                C[3:] = 1
                C[3::-1] = 9
        assert_equal(A.toarray(), B)

    def test_slice_assign_2(self, spcreator):
        shape = (10,)

        for idx in [slice(3), slice(None, 10, 4), slice(5, -2)]:
            A = spcreator(shape)
            with np.testing.suppress_warnings() as sup:
                sup.filter(
                    SparseEfficiencyWarning,
                    "Changing the sparsity structure of .* is expensive",
                )
                A[idx] = 1
            B = np.zeros(shape)
            B[idx] = 1
            msg = f"idx={idx!r}"
            assert_allclose(A.toarray(), B, err_msg=msg)

    def test_self_self_assignment(self, spcreator):
        # Tests whether a row of one lil_matrix can be assigned to another.
        B = spcreator((5,))
        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            B[0] = 2
            B[1] = 0
            B[2] = 3
            B[3] = 10

            A = B / 10
            B[:] = A[:]
            assert_equal(A[:].toarray(), B[:].toarray())

            A = B / 10
            B[:] = A[:1]
            assert_equal(np.zeros((5,)) + A[0], B.toarray())

            A = B / 10
            B[:-1] = A[1:]
            assert_equal(A[1:].toarray(), B[:-1].toarray())

    def test_slice_assignment(self, spcreator):
        B = spcreator((4,))
        expected = np.array([10, 0, 14, 0])
        block = [2, 1]

        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            B[0] = 5
            B[2] = 7
            B[:] = B + B
            assert_equal(B.toarray(), expected)

            B[:2] = csr_array(block)
            assert_equal(B.toarray()[:2], block)

    def test_set_slice(self, spcreator):
        A = spcreator((5,))
        B = np.zeros(5, float)
        s_ = np.s_
        slices = [s_[:2], s_[1:2], s_[3:], s_[3::2],
                  s_[8:3:-1], s_[4::-2], s_[:5:-1],
                  0, 1, s_[:], s_[1:5], -1, -2, -5,
                  np.array(-1), np.int8(-3)]

        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            for j, a in enumerate(slices):
                A[a] = j
                B[a] = j
                assert_equal(A.toarray(), B, repr(a))

            A[1:10:2] = range(1, 5, 2)
            B[1:10:2] = range(1, 5, 2)
            assert_equal(A.toarray(), B)

        # The next commands should raise exceptions
        toobig = list(range(100))
        with pytest.raises(ValueError, match='Trying to assign a sequence to an item'):
            A.__setitem__(0, toobig)
        with pytest.raises(ValueError, match='could not be broadcast together'):
            A.__setitem__(slice(None), toobig)

    def test_assign_empty(self, spcreator):
        A = spcreator(np.ones(3))
        B = spcreator((2,))
        A[:2] = B
        assert_equal(A.toarray(), [0, 0, 1])

    ####################
    #  1d Fancy Indexing
    ####################
    def test_dtype_preservation_empty_index(self, spcreator):
        A = spcreator((2,), dtype=np.int16)
        assert_equal(A[[False, False]].dtype, np.int16)
        assert_equal(A[[]].dtype, np.int16)

    def test_bad_index(self, spcreator):
        A = spcreator(np.zeros(5))
        with pytest.raises(
            (IndexError, ValueError, TypeError),
            match='Index dimension must be 1 or 2|only integers',
        ):
            A.__getitem__("foo")
        with pytest.raises(
            (IndexError, ValueError, TypeError),
            match='tuple index out of range|only integers',
        ):
            A.__getitem__((2, "foo"))

    def test_fancy_indexing_2darray(self, spcreator):
        B = np.arange(50).reshape((5, 10))
        A = spcreator(B)

        # [i]
        assert_equal(A[[1, 3]].toarray(), B[[1, 3]])

        # [i,[1,2]]
        assert_equal(A[3, [1, 3]].toarray(), B[3, [1, 3]])
        assert_equal(A[-1, [2, -5]].toarray(), B[-1, [2, -5]])
        assert_equal(A[np.array(-1), [2, -5]].toarray(), B[-1, [2, -5]])
        assert_equal(A[-1, np.array([2, -5])].toarray(), B[-1, [2, -5]])
        assert_equal(A[np.array(-1), np.array([2, -5])].toarray(), B[-1, [2, -5]])

        # [1:2,[1,2]]
        assert_equal(A[:, [2, 8, 3, -1]].toarray(), B[:, [2, 8, 3, -1]])
        assert_equal(A[3:4, [9]].toarray(), B[3:4, [9]])
        assert_equal(A[1:4, [-1, -5]].toarray(), B[1:4, [-1, -5]])
        assert_equal(A[1:4, np.array([-1, -5])].toarray(), B[1:4, [-1, -5]])

        # [[1,2],j]
        assert_equal(A[[1, 3], 3].toarray(), B[[1, 3], 3])
        assert_equal(A[[2, -5], -4].toarray(), B[[2, -5], -4])
        assert_equal(A[np.array([2, -5]), -4].toarray(), B[[2, -5], -4])
        assert_equal(A[[2, -5], np.array(-4)].toarray(), B[[2, -5], -4])
        assert_equal(A[np.array([2, -5]), np.array(-4)].toarray(), B[[2, -5], -4])

        # [[1,2],1:2]
        assert_equal(A[[1, 3], :].toarray(), B[[1, 3], :])
        assert_equal(A[[2, -5], 8:-1].toarray(), B[[2, -5], 8:-1])
        assert_equal(A[np.array([2, -5]), 8:-1].toarray(), B[[2, -5], 8:-1])

        # [[1,2],[1,2]]
        assert_equal(toarray(A[[1, 3], [2, 4]]), B[[1, 3], [2, 4]])
        assert_equal(toarray(A[[-1, -3], [2, -4]]), B[[-1, -3], [2, -4]])
        assert_equal(
            toarray(A[np.array([-1, -3]), [2, -4]]), B[[-1, -3], [2, -4]]
        )
        assert_equal(
            toarray(A[[-1, -3], np.array([2, -4])]), B[[-1, -3], [2, -4]]
        )
        assert_equal(
            toarray(A[np.array([-1, -3]), np.array([2, -4])]), B[[-1, -3], [2, -4]]
        )

        # [[[1],[2]],[1,2]]
        assert_equal(A[[[1], [3]], [2, 4]].toarray(), B[[[1], [3]], [2, 4]])
        assert_equal(
            A[[[-1], [-3], [-2]], [2, -4]].toarray(),
            B[[[-1], [-3], [-2]], [2, -4]]
        )
        assert_equal(
            A[np.array([[-1], [-3], [-2]]), [2, -4]].toarray(),
            B[[[-1], [-3], [-2]], [2, -4]]
        )
        assert_equal(
            A[[[-1], [-3], [-2]], np.array([2, -4])].toarray(),
            B[[[-1], [-3], [-2]], [2, -4]]
        )
        assert_equal(
            A[np.array([[-1], [-3], [-2]]), np.array([2, -4])].toarray(),
            B[[[-1], [-3], [-2]], [2, -4]]
        )

        # [[1,2]]
        assert_equal(A[[1, 3]].toarray(), B[[1, 3]])
        assert_equal(A[[-1, -3]].toarray(), B[[-1, -3]])
        assert_equal(A[np.array([-1, -3])].toarray(), B[[-1, -3]])

        # [[1,2],:][:,[1,2]]
        assert_equal(
            A[[1, 3], :][:, [2, 4]].toarray(), B[[1, 3], :][:, [2, 4]]
        )
        assert_equal(
            A[[-1, -3], :][:, [2, -4]].toarray(), B[[-1, -3], :][:, [2, -4]]
        )
        assert_equal(
            A[np.array([-1, -3]), :][:, np.array([2, -4])].toarray(),
            B[[-1, -3], :][:, [2, -4]]
        )

        # [:,[1,2]][[1,2],:]
        assert_equal(
            A[:, [1, 3]][[2, 4], :].toarray(), B[:, [1, 3]][[2, 4], :]
        )
        assert_equal(
            A[:, [-1, -3]][[2, -4], :].toarray(), B[:, [-1, -3]][[2, -4], :]
        )
        assert_equal(
            A[:, np.array([-1, -3])][np.array([2, -4]), :].toarray(),
            B[:, [-1, -3]][[2, -4], :]
        )

    def test_fancy_indexing(self, spcreator):
        B = np.arange(50)
        A = spcreator(B)

        # [i]
        assert_equal(A[[3]].toarray(), B[[3]])

        # [np.array]
        assert_equal(A[[1, 3]].toarray(), B[[1, 3]])
        assert_equal(A[[2, -5]].toarray(), B[[2, -5]])
        assert_equal(A[np.array(-1)], B[-1])
        assert_equal(A[np.array([-1, 2])].toarray(), B[[-1, 2]])
        assert_equal(A[np.array(5)], B[np.array(5)])

        # [[[1],[2]]]
        ind = np.array([[1], [3]])
        assert_equal(A[ind].toarray(), B[ind])
        ind = np.array([[-1], [-3], [-2]])
        assert_equal(A[ind].toarray(), B[ind])

        # [[1, 2]]
        assert_equal(A[[1, 3]].toarray(), B[[1, 3]])
        assert_equal(A[[-1, -3]].toarray(), B[[-1, -3]])
        assert_equal(A[np.array([-1, -3])].toarray(), B[[-1, -3]])

        # [[1, 2]][[1, 2]]
        assert_equal(A[[1, 5, 2, 8]][[1, 3]].toarray(),
                     B[[1, 5, 2, 8]][[1, 3]])
        assert_equal(A[[-1, -5, 2, 8]][[1, -4]].toarray(),
                     B[[-1, -5, 2, 8]][[1, -4]])

    def test_fancy_indexing_boolean(self, spcreator):
        np.random.seed(1234)  # make runs repeatable

        B = np.arange(50)
        A = spcreator(B)

        I = np.array(np.random.randint(0, 2, size=50), dtype=bool)

        assert_equal(toarray(A[I]), B[I])
        assert_equal(toarray(A[B > 9]), B[B > 9])

        Z1 = np.zeros(51, dtype=bool)
        Z2 = np.zeros(51, dtype=bool)
        Z2[-1] = True
        Z3 = np.zeros(51, dtype=bool)
        Z3[0] = True

        msg = 'bool index .* has shape|boolean index did not match'
        with pytest.raises(IndexError, match=msg):
            A.__getitem__(Z1)
        with pytest.raises(IndexError, match=msg):
            A.__getitem__(Z2)
        with pytest.raises(IndexError, match=msg):
            A.__getitem__(Z3)

    def test_fancy_indexing_sparse_boolean(self, spcreator):
        np.random.seed(1234)  # make runs repeatable

        B = np.arange(20)
        A = spcreator(B)

        X = np.array(np.random.randint(0, 2, size=20), dtype=bool)
        Xsp = csr_array(X)

        assert_equal(toarray(A[Xsp]), B[X])
        assert_equal(toarray(A[A > 9]), B[B > 9])

        Y = np.array(np.random.randint(0, 2, size=60), dtype=bool)

        Ysp = csr_array(Y)

        with pytest.raises(IndexError, match='bool index .* has shape|only integers'):
            A.__getitem__(Ysp)
        with pytest.raises(IndexError, match='tuple index out of range|only integers'):
            A.__getitem__((Xsp, 1))

    def test_fancy_indexing_seq_assign(self, spcreator):
        mat = spcreator(np.array([1, 0]))
        with pytest.raises(ValueError, match='Trying to assign a sequence to an item'):
            mat.__setitem__(0, np.array([1, 2]))

    def test_fancy_indexing_empty(self, spcreator):
        B = np.arange(50)
        B[3:9] = 0
        B[30] = 0
        A = spcreator(B)

        K = np.array([False] * 50)
        assert_equal(toarray(A[K]), B[K])
        K = np.array([], dtype=int)
        assert_equal(toarray(A[K]), B[K])
        J = np.array([0, 1, 2, 3, 4], dtype=int)
        assert_equal(toarray(A[J]), B[J])

    ############################
    #  1d Fancy Index Assignment
    ############################
    def test_bad_index_assign(self, spcreator):
        A = spcreator(np.zeros(5))
        msg = 'Index dimension must be 1 or 2|only integers'
        with pytest.raises((IndexError, ValueError, TypeError), match=msg):
            A.__setitem__("foo", 2)

    def test_fancy_indexing_set(self, spcreator):
        M = (5,)

        # [1:2]
        for j in [[2, 3, 4], slice(None, 10, 4), np.arange(3),
                     slice(5, -2), slice(2, 5)]:
            A = spcreator(M)
            B = np.zeros(M)
            with np.testing.suppress_warnings() as sup:
                sup.filter(
                    SparseEfficiencyWarning,
                    "Changing the sparsity structure of .* is expensive",
                )
                B[j] = 1
                with check_remains_sorted(A):
                    A[j] = 1
            assert_allclose(A.toarray(), B)

    def test_sequence_assignment(self, spcreator):
        A = spcreator((4,))
        B = spcreator((3,))

        i0 = [0, 1, 2]
        i1 = (0, 1, 2)
        i2 = np.array(i0)

        with np.testing.suppress_warnings() as sup:
            sup.filter(
                SparseEfficiencyWarning,
                "Changing the sparsity structure of .* is expensive",
            )
            with check_remains_sorted(A):
                A[i0] = B[i0]
                msg = "too many indices for array|tuple index out of range"
                with pytest.raises(IndexError, match=msg):
                    B.__getitem__(i1)
                A[i2] = B[i2]
            assert_equal(A[:3].toarray(), B.toarray())
            assert A.shape == (4,)

            # slice
            A = spcreator((4,))
            with check_remains_sorted(A):
                A[1:3] = [10, 20]
            assert_equal(A.toarray(), [0, 10, 20, 0])

            # array
            A = spcreator((4,))
            B = np.zeros(4)
            with check_remains_sorted(A):
                for C in [A, B]:
                    C[[0, 1, 2]] = [4, 5, 6]
            assert_equal(A.toarray(), B)

    def test_fancy_assign_empty(self, spcreator):
        B = np.arange(50)
        B[2] = 0
        B[[3, 6]] = 0
        A = spcreator(B)

        K = np.array([False] * 50)
        A[K] = 42
        assert_equal(A.toarray(), B)

        K = np.array([], dtype=int)
        A[K] = 42
        assert_equal(A.toarray(), B)

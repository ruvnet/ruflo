import math

import pytest

import numpy as np
from numpy.testing import assert_equal
from scipy.spatial.transform import Rotation, Slerp
from scipy.stats import special_ortho_group
from itertools import permutations, product
from scipy._lib._array_api import (
    xp_assert_equal,
    is_numpy,
    is_lazy_array,
    xp_vector_norm,
    xp_assert_close,
    eager_warns,
    xp_default_dtype
)
import scipy._lib.array_api_extra as xpx

import pickle
import copy


pytestmark = pytest.mark.skip_xp_backends(np_only=True)


def basis_vec(axis):
    if axis == 'x':
        return [1, 0, 0]
    elif axis == 'y':
        return [0, 1, 0]
    elif axis == 'z':
        return [0, 0, 1]


def rotation_to_xp(r: Rotation, xp):
    return Rotation.from_quat(xp.asarray(r.as_quat()))


def test_init_non_array():
    Rotation((0, 0, 0, 1))
    Rotation([0, 0, 0, 1])


def test_generic_quat_matrix(xp):
    x = xp.asarray([[3.0, 4, 0, 0], [5, 12, 0, 0]])
    r = Rotation.from_quat(x)
    expected_quat = x / xp.asarray([[5.0], [13.0]])
    xp_assert_close(r.as_quat(), expected_quat)


def test_from_single_1d_quaternion(xp):
    x = xp.asarray([3.0, 4, 0, 0])
    r = Rotation.from_quat(x)
    expected_quat = x / 5
    xp_assert_close(r.as_quat(), expected_quat)


def test_from_single_2d_quaternion(xp):
    x = xp.asarray([[3.0, 4, 0, 0]])
    r = Rotation.from_quat(x)
    expected_quat = x / 5
    xp_assert_close(r.as_quat(), expected_quat)


def test_from_quat_scalar_first(xp):
    rng = np.random.RandomState(0)

    r = Rotation.from_quat(xp.asarray([1, 0, 0, 0]), scalar_first=True)
    xp_assert_close(r.as_matrix(), xp.eye(3), rtol=1e-15, atol=1e-16)

    q = xp.tile(xp.asarray([1, 0, 0, 0]), (10, 1))
    r = Rotation.from_quat(q, scalar_first=True)
    xp_assert_close(
        r.as_matrix(), xp.tile(xp.eye(3), (10, 1, 1)), rtol=1e-15, atol=1e-16
    )

    q = xp.asarray(rng.randn(100, 4))
    q /= xp_vector_norm(q, axis=1)[:, None]
    for i in range(q.shape[0]):  # Array API conforming loop
        qi = q[i, ...]
        r = Rotation.from_quat(qi, scalar_first=True)
        xp_assert_close(xp.roll(r.as_quat(), 1), qi, rtol=1e-15)

    r = Rotation.from_quat(q, scalar_first=True)
    xp_assert_close(xp.roll(r.as_quat(), 1, axis=1), q, rtol=1e-15)


def test_from_quat_array_like():
    rng = np.random.default_rng(123)
    # Single rotation
    r_expected = Rotation.random(rng=rng)
    r = Rotation.from_quat(r_expected.as_quat().tolist())
    assert r_expected.approx_equal(r, atol=1e-12)

    # Multiple rotations
    r_expected = Rotation.random(3, rng=rng)
    r = Rotation.from_quat(r_expected.as_quat().tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_from_quat_int_dtype(xp):
    r = Rotation.from_quat(xp.asarray([1, 0, 0, 0]))
    assert r.as_quat().dtype == xp_default_dtype(xp)


def test_as_quat_scalar_first(xp):
    rng = np.random.RandomState(0)

    r = Rotation.from_euler('xyz', xp.zeros(3))
    xp_assert_close(r.as_quat(scalar_first=True), xp.asarray([1.0, 0, 0, 0]),
                    rtol=1e-15, atol=1e-16)

    r = Rotation.from_euler('xyz', xp.zeros((10, 3)))
    xp_assert_close(r.as_quat(scalar_first=True),
                    xp.tile(xp.asarray([1.0, 0, 0, 0]), (10, 1)),
                    rtol=1e-15, atol=1e-16)

    q = xp.asarray(rng.randn(100, 4))
    q /= xp_vector_norm(q, axis=1)[:, None]
    for i in range(q.shape[0]):  # Array API conforming loop
        qi = q[i, ...]
        r = Rotation.from_quat(qi)
        xp_assert_close(r.as_quat(scalar_first=True), xp.roll(qi, 1),
                        rtol=1e-15)

        xp_assert_close(r.as_quat(canonical=True, scalar_first=True),
                        xp.roll(r.as_quat(canonical=True), 1),
                        rtol=1e-15)

    r = Rotation.from_quat(q)
    xp_assert_close(r.as_quat(scalar_first=True), xp.roll(q, 1, axis=1),
                    rtol=1e-15)

    xp_assert_close(r.as_quat(canonical=True, scalar_first=True),
                    xp.roll(r.as_quat(canonical=True), 1, axis=1), rtol=1e-15)


def test_from_square_quat_matrix(xp):
    # Ensure proper norm array broadcasting
    x = xp.asarray([
        [3.0, 0, 0, 4],
        [5, 0, 12, 0],
        [0, 0, 0, 1],
        [-1, -1, -1, 1],
        [0, 0, 0, -1],  # Check double cover
        [-1, -1, -1, -1]  # Check double cover
        ])
    r = Rotation.from_quat(x)
    expected_quat = x / xp.asarray([[5.0], [13], [1], [2], [1], [2]])
    xp_assert_close(r.as_quat(), expected_quat)


def test_quat_double_to_canonical_single_cover(xp):
    x = xp.asarray([
        [-1.0, 0, 0, 0],
        [0, -1, 0, 0],
        [0, 0, -1, 0],
        [0, 0, 0, -1],
        [-1, -1, -1, -1]
        ])
    r = Rotation.from_quat(x)
    expected_quat = xp.abs(x) / xp_vector_norm(x, axis=1)[:, None]
    xp_assert_close(r.as_quat(canonical=True), expected_quat)


def test_quat_double_cover(xp):
    # See the Rotation.from_quat() docstring for scope of the quaternion
    # double cover property.
    # Check from_quat and as_quat(canonical=False)
    q = xp.asarray([0.0, 0, 0, -1])
    r = Rotation.from_quat(q)
    xp_assert_equal(q, r.as_quat(canonical=False))
    # Check composition and inverse
    q = xp.asarray([1.0, 0, 0, 1])/math.sqrt(2)  # 90 deg rotation about x
    r = Rotation.from_quat(q)
    r3 = r*r*r
    xp_assert_close(r.as_quat(canonical=False)*math.sqrt(2),
                    xp.asarray([1.0, 0, 0, 1]))
    xp_assert_close(r.inv().as_quat(canonical=False)*math.sqrt(2),
                    xp.asarray([-1.0, 0, 0, 1]))
    xp_assert_close(r3.as_quat(canonical=False)*math.sqrt(2),
                    xp.asarray([1.0, 0, 0, -1]))
    xp_assert_close(r3.inv().as_quat(canonical=False)*math.sqrt(2),
                    xp.asarray([-1.0, 0, 0, -1]))

    # More sanity checks
    xp_assert_close((r*r.inv()).as_quat(canonical=False),
                    xp.asarray([0.0, 0, 0, 1]), atol=2e-16)
    xp_assert_close((r3*r3.inv()).as_quat(canonical=False),
                    xp.asarray([0.0, 0, 0, 1]), atol=2e-16)
    xp_assert_close((r*r3).as_quat(canonical=False),
                    xp.asarray([0.0, 0, 0, -1]), atol=2e-16)
    xp_assert_close((r.inv() * r3.inv()).as_quat(canonical=False),
                    xp.asarray([0.0, 0, 0, -1]), atol=2e-16)


def test_from_quat_wrong_shape(xp):
    # Wrong shape 1d array
    with pytest.raises(ValueError, match='Expected `quat` to have shape'):
        Rotation.from_quat(xp.asarray([1, 2, 3]))

    # Wrong shape 2d array
    with pytest.raises(ValueError, match='Expected `quat` to have shape'):
        Rotation.from_quat(xp.asarray([
            [1, 2, 3, 4, 5],
            [4, 5, 6, 7, 8]
            ]))

    # 3d array
    with pytest.raises(ValueError, match='Expected `quat` to have shape'):
        Rotation.from_quat(xp.asarray([
            [[1, 2, 3, 4]],
            [[4, 5, 6, 7]]
            ]))


def test_zero_norms_from_quat(xp):
    x = xp.asarray([
            [3, 4, 0, 0],
            [0, 0, 0, 0],
            [5, 0, 12, 0]
            ])
    if is_lazy_array(x):
        assert xp.all(xp.isnan(Rotation.from_quat(x).as_quat()[1, ...]))
    else:
        with pytest.raises(ValueError):
            Rotation.from_quat(x)


def test_as_matrix_single_1d_quaternion(xp):
    quat = xp.asarray([0, 0, 0, 1])
    mat = Rotation.from_quat(quat).as_matrix()
    # mat.shape == (3,3) due to 1d input
    xp_assert_close(mat, xp.eye(3))


def test_as_matrix_single_2d_quaternion(xp):
    quat = xp.asarray([[0, 0, 1, 1]])
    mat = Rotation.from_quat(quat).as_matrix()
    assert_equal(mat.shape, (1, 3, 3))
    expected_mat = xp.asarray([
        [0.0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
        ])
    xp_assert_close(mat[0, ...], expected_mat)


def test_as_matrix_from_square_input(xp):
    quats = xp.asarray([
            [0, 0, 1, 1],
            [0, 1, 0, 1],
            [0, 0, 0, 1],
            [0, 0, 0, -1]
            ])
    mat = Rotation.from_quat(quats).as_matrix()
    assert_equal(mat.shape, (4, 3, 3))

    expected0 = xp.asarray([
        [0.0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
        ])
    xp_assert_close(mat[0, ...], expected0)

    expected1 = xp.asarray([
        [0.0, 0, 1],
        [0, 1, 0],
        [-1, 0, 0]
        ])
    xp_assert_close(mat[1, ...], expected1)

    xp_assert_close(mat[2, ...], xp.eye(3))
    xp_assert_close(mat[3, ...], xp.eye(3))


def test_as_matrix_from_generic_input(xp):
    quats = xp.asarray([
            [0, 0, 1, 1],
            [0, 1, 0, 1],
            [1, 2, 3, 4]
            ])
    mat = Rotation.from_quat(quats).as_matrix()
    assert_equal(mat.shape, (3, 3, 3))

    expected0 = xp.asarray([
        [0.0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
        ])
    xp_assert_close(mat[0, ...], expected0)

    expected1 = xp.asarray([
        [0.0, 0, 1],
        [0, 1, 0],
        [-1, 0, 0]
        ])
    xp_assert_close(mat[1, ...], expected1)

    expected2 = xp.asarray([
        [0.4, -2, 2.2],
        [2.8, 1, 0.4],
        [-1, 2, 2]
        ]) / 3
    xp_assert_close(mat[2, ...], expected2)


def test_from_single_2d_matrix(xp):
    mat = xp.asarray([
            [0, 0, 1],
            [1, 0, 0],
            [0, 1, 0]
            ])
    expected_quat = xp.asarray([0.5, 0.5, 0.5, 0.5])
    xp_assert_close(Rotation.from_matrix(mat).as_quat(), expected_quat)


def test_from_single_3d_matrix(xp):
    mat = xp.asarray([[
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
        ]])
    expected_quat = xp.asarray([[0.5, 0.5, 0.5, 0.5]])
    xp_assert_close(Rotation.from_matrix(mat).as_quat(), expected_quat)


def test_from_matrix_calculation(xp):
    atol = 1e-8
    expected_quat = xp.asarray([1.0, 1, 6, 1]) / math.sqrt(39)
    mat = xp.asarray([
            [-0.8974359, -0.2564103, 0.3589744],
            [0.3589744, -0.8974359, 0.2564103],
            [0.2564103, 0.3589744, 0.8974359]
            ])
    xp_assert_close(Rotation.from_matrix(mat).as_quat(), expected_quat, atol=atol)
    xp_assert_close(Rotation.from_matrix(xp.reshape(mat, (1, 3, 3))).as_quat(),
                    xp.reshape(expected_quat, (1, 4)),
                    atol=atol)


def test_matrix_calculation_pipeline(xp):
    mat = xp.asarray(special_ortho_group.rvs(3, size=10, random_state=0))
    xp_assert_close(Rotation.from_matrix(mat).as_matrix(), mat)


def test_from_matrix_ortho_output(xp):
    atol = 1e-12
    rnd = np.random.RandomState(0)
    mat = xp.asarray(rnd.random_sample((100, 3, 3)))
    dets = xp.linalg.det(mat)
    for i in range(dets.shape[0]):
        # Make sure we have a right-handed rotation matrix
        if dets[i] < 0:
            mat = xpx.at(mat)[i, ...].set(-mat[i, ...])
    ortho_mat = Rotation.from_matrix(mat).as_matrix()

    mult_result = xp.matmul(ortho_mat, xp.matrix_transpose(ortho_mat))

    eye3d = xp.zeros((100, 3, 3)) + xp.eye(3)
    xp_assert_close(mult_result, eye3d, atol=atol)


def test_from_matrix_normalize(xp):
    mat = xp.asarray([
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1]])
    expected = xp.asarray([[ 0.894427, 0.447214, 0.0],
                           [-0.447214, 0.894427, 0.0],
                           [ 0.0,      0.0,      1.0]])
    xp_assert_close(Rotation.from_matrix(mat).as_matrix(), expected, atol=1e-6)

    mat = xp.asarray([
        [0,  -0.5, 0  ],
        [0.5, 0  , 0  ],
        [0,   0  , 0.5]])
    expected = xp.asarray([[0.0, -1, 0],
                           [  1,  0, 0],
                           [  0,  0, 1]])
    xp_assert_close(Rotation.from_matrix(mat).as_matrix(), expected, atol=1e-6)


def test_from_matrix_non_positive_determinant(xp):
    mat = xp.eye(3)
    mat = xpx.at(mat)[0, 0].set(0)
    if is_lazy_array(mat):
        assert xp.all(xp.isnan(Rotation.from_matrix(mat).as_matrix()))
    else:
        with pytest.raises(ValueError, match="Non-positive determinant"):
            Rotation.from_matrix(mat)

    mat = xpx.at(mat)[0, 0].set(-1)
    if is_lazy_array(mat):
        assert xp.all(xp.isnan(Rotation.from_matrix(mat).as_matrix()))
    else:
        with pytest.raises(ValueError, match="Non-positive determinant"):
            Rotation.from_matrix(mat)


def test_from_matrix_array_like():
    rng = np.random.default_rng(123)
    # Single rotation
    r_expected = Rotation.random(rng=rng)
    r = Rotation.from_matrix(r_expected.as_matrix().tolist())
    assert r_expected.approx_equal(r, atol=1e-12)
    
    # Multiple rotations
    r_expected = Rotation.random(3, rng=rng)
    r = Rotation.from_matrix(r_expected.as_matrix().tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_from_matrix_int_dtype(xp):
    mat = xp.asarray([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    r = Rotation.from_matrix(mat)
    assert r.as_quat().dtype == xp_default_dtype(xp)


def test_from_1d_single_rotvec(xp):
    atol = 1e-7
    rotvec = xp.asarray([1, 0, 0])
    expected_quat = xp.asarray([0.4794255, 0, 0, 0.8775826])
    result = Rotation.from_rotvec(rotvec)
    xp_assert_close(result.as_quat(), expected_quat, atol=atol)


def test_from_2d_single_rotvec(xp):
    atol = 1e-7
    rotvec = xp.asarray([[1, 0, 0]])
    expected_quat = xp.asarray([[0.4794255, 0, 0, 0.8775826]])
    result = Rotation.from_rotvec(rotvec)
    xp_assert_close(result.as_quat(), expected_quat, atol=atol)


def test_from_generic_rotvec(xp):
    atol = 1e-7
    rotvec = xp.asarray([
            [1, 2, 2],
            [1, -1, 0.5],
            [0, 0, 0]])
    expected_quat = xp.asarray([
        [0.3324983, 0.6649967, 0.6649967, 0.0707372],
        [0.4544258, -0.4544258, 0.2272129, 0.7316889],
        [0, 0, 0, 1]
        ])
    xp_assert_close(Rotation.from_rotvec(rotvec).as_quat(), expected_quat, atol=atol)


def test_from_rotvec_small_angle(xp):
    rotvec = xp.asarray([
        [5e-4 / math.sqrt(3), -5e-4 / math.sqrt(3), 5e-4 / math.sqrt(3)],
        [0.2, 0.3, 0.4],
        [0, 0, 0]
        ])

    quat = Rotation.from_rotvec(rotvec).as_quat()
    # cos(theta/2) ~~ 1 for small theta
    xp_assert_close(quat[0, 3], xp.asarray(1.0)[()])
    # sin(theta/2) / theta ~~ 0.5 for small theta
    xp_assert_close(quat[0, :3], rotvec[0, ...] * 0.5)

    xp_assert_close(quat[1, 3], xp.asarray(0.9639685)[()])
    xp_assert_close(quat[1, :3],
            xp.asarray([
                0.09879603932153465,
                0.14819405898230198,
                0.19759207864306931]))

    xp_assert_equal(quat[2, ...], xp.asarray([0.0, 0, 0, 1]))


def test_from_rotvec_array_like():
    rng = np.random.default_rng(123)
    # Single rotation
    r_expected = Rotation.random(rng=rng)
    r = Rotation.from_rotvec(r_expected.as_rotvec().tolist())
    assert r_expected.approx_equal(r, atol=1e-12)

    # Multiple rotations
    r_expected = Rotation.random(3, rng=rng)
    r = Rotation.from_rotvec(r_expected.as_rotvec().tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_from_rotvec_int_dtype(xp):
    rotvec = xp.asarray([1, 0, 0])
    r = Rotation.from_rotvec(rotvec)
    assert r.as_quat().dtype == xp_default_dtype(xp)


def test_degrees_from_rotvec(xp):
    rotvec1 = xp.asarray([1 / 3 ** (1/3)] * 3)
    rot1 = Rotation.from_rotvec(rotvec1, degrees=True)
    quat1 = rot1.as_quat()

    # deg2rad is not implemented in Array API -> / 180 * xp.pi
    rotvec2 = xp.asarray(rotvec1 / 180 * xp.pi)
    rot2 = Rotation.from_rotvec(rotvec2)
    quat2 = rot2.as_quat()

    xp_assert_close(quat1, quat2)


def test_malformed_1d_from_rotvec(xp):
    with pytest.raises(ValueError, match='Expected `rot_vec` to have shape'):
        Rotation.from_rotvec(xp.asarray([1, 2]))


def test_malformed_2d_from_rotvec(xp):
    with pytest.raises(ValueError, match='Expected `rot_vec` to have shape'):
        Rotation.from_rotvec(xp.asarray([
            [1, 2, 3, 4],
            [5, 6, 7, 8]
            ]))


def test_as_generic_rotvec(xp):
    quat = xp.asarray([
            [1, 2, -1, 0.5],
            [1, -1, 1, 0.0003],
            [0, 0, 0, 1]
            ])
    quat /= xp_vector_norm(quat, axis=-1, keepdims=True)

    rotvec = Rotation.from_quat(quat).as_rotvec()
    angle = xp_vector_norm(rotvec, axis=-1)

    xp_assert_close(quat[:, 3], xp.cos(angle / 2))
    xp_assert_close(xp.linalg.cross(rotvec, quat[:, :3]), xp.zeros((3, 3)), atol=1e-15)


def test_as_rotvec_single_1d_input(xp):
    quat = xp.asarray([1, 2, -3, 2])
    expected_rotvec = xp.asarray([0.5772381, 1.1544763, -1.7317144])

    actual_rotvec = Rotation.from_quat(quat).as_rotvec()

    assert_equal(actual_rotvec.shape, (3,))
    xp_assert_close(actual_rotvec, expected_rotvec)


def test_as_rotvec_single_2d_input(xp):
    quat = xp.asarray([[1, 2, -3, 2]])
    expected_rotvec = xp.asarray([[0.5772381, 1.1544763, -1.7317144]])

    actual_rotvec = Rotation.from_quat(quat).as_rotvec()

    assert_equal(actual_rotvec.shape, (1, 3))
    xp_assert_close(actual_rotvec, expected_rotvec)


def test_as_rotvec_degrees(xp):
    # x->y, y->z, z->x
    mat = xp.asarray([[0, 0, 1], [1, 0, 0], [0, 1, 0]])
    rot = Rotation.from_matrix(mat)
    rotvec = rot.as_rotvec(degrees=True)
    angle = xp_vector_norm(rotvec, axis=-1)
    xp_assert_close(angle, xp.asarray(120.0)[()])
    xp_assert_close(rotvec[0], rotvec[1])
    xp_assert_close(rotvec[1], rotvec[2])


def test_rotvec_calc_pipeline(xp):
    # Include small angles
    rotvec = xp.asarray([
        [0, 0, 0],
        [1, -1, 2],
        [-3e-4, 3.5e-4, 7.5e-5]
        ])
    xp_assert_close(Rotation.from_rotvec(rotvec).as_rotvec(), rotvec)
    xp_assert_close(Rotation.from_rotvec(rotvec, degrees=True).as_rotvec(degrees=True),
                    rotvec)


def test_from_1d_single_mrp(xp):
    mrp = xp.asarray([0, 0, 1.0])
    expected_quat = xp.asarray([0.0, 0, 1, 0])
    result = Rotation.from_mrp(mrp)
    xp_assert_close(result.as_quat(), expected_quat, atol=1e-12)


def test_from_2d_single_mrp(xp):
    mrp = xp.asarray([[0, 0, 1.0]])
    expected_quat = xp.asarray([[0.0, 0, 1, 0]])
    result = Rotation.from_mrp(mrp)
    xp_assert_close(result.as_quat(), expected_quat)


def test_from_mrp_array_like():
    rng = np.random.default_rng(123)
    # Single rotation
    r_expected = Rotation.random(rng=rng)
    r = Rotation.from_mrp(r_expected.as_mrp().tolist())
    assert r_expected.approx_equal(r, atol=1e-12)

    # Multiple rotations
    r_expected = Rotation.random(3, rng=rng)
    r = Rotation.from_mrp(r_expected.as_mrp().tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_from_mrp_int_dtype(xp):
    mrp = xp.asarray([0, 0, 1])
    r = Rotation.from_mrp(mrp)
    assert r.as_quat().dtype == xp_default_dtype(xp)


def test_from_generic_mrp(xp):
    mrp = xp.asarray([
        [1, 2, 2],
        [1, -1, 0.5],
        [0, 0, 0]])
    expected_quat = xp.asarray([
        [0.2, 0.4, 0.4, -0.8],
        [0.61538462, -0.61538462, 0.30769231, -0.38461538],
        [0, 0, 0, 1]])
    xp_assert_close(Rotation.from_mrp(mrp).as_quat(), expected_quat)


def test_malformed_1d_from_mrp(xp):
    with pytest.raises(ValueError, match='Expected `mrp` to have shape'):
        Rotation.from_mrp(xp.asarray([1, 2]))


def test_malformed_2d_from_mrp(xp):
    with pytest.raises(ValueError, match='Expected `mrp` to have shape'):
        Rotation.from_mrp(xp.asarray([
            [1, 2, 3, 4],
            [5, 6, 7, 8]
            ]))


def test_as_generic_mrp(xp):
    quat = xp.asarray([
        [1, 2, -1, 0.5],
        [1, -1, 1, 0.0003],
        [0, 0, 0, 1]])
    quat /= xp_vector_norm(quat, axis=1)[:, None]

    expected_mrp = xp.asarray([
        [0.33333333, 0.66666667, -0.33333333],
        [0.57725028, -0.57725028, 0.57725028],
        [0, 0, 0]])
    xp_assert_close(Rotation.from_quat(quat).as_mrp(), expected_mrp)


def test_past_180_degree_rotation(xp):
    # ensure that a > 180 degree rotation is returned as a <180 rotation in MRPs
    # in this case 270 should be returned as -90
    expected_mrp = xp.asarray([-math.tan(xp.pi / 2 / 4), 0.0, 0])
    xp_assert_close(
        Rotation.from_euler('xyz', xp.asarray([270, 0, 0]), degrees=True).as_mrp(),
        expected_mrp,
    )


def test_as_mrp_single_1d_input(xp):
    quat = xp.asarray([1, 2, -3, 2])
    expected_mrp = xp.asarray([0.16018862, 0.32037724, -0.48056586])

    actual_mrp = Rotation.from_quat(quat).as_mrp()

    assert_equal(actual_mrp.shape, (3,))
    xp_assert_close(actual_mrp, expected_mrp)


def test_as_mrp_single_2d_input(xp):
    quat = xp.asarray([[1, 2, -3, 2]])
    expected_mrp = xp.asarray([[0.16018862, 0.32037724, -0.48056586]])

    actual_mrp = Rotation.from_quat(quat).as_mrp()

    assert_equal(actual_mrp.shape, (1, 3))
    xp_assert_close(actual_mrp, expected_mrp)


def test_mrp_calc_pipeline(xp):
    actual_mrp = xp.asarray([
        [0, 0, 0],
        [1, -1, 2],
        [0.41421356, 0, 0],
        [0.1, 0.2, 0.1]])
    expected_mrp = xp.asarray([
        [0, 0, 0],
        [-0.16666667, 0.16666667, -0.33333333],
        [0.41421356, 0, 0],
        [0.1, 0.2, 0.1]])
    xp_assert_close(Rotation.from_mrp(actual_mrp).as_mrp(), expected_mrp)


def test_from_euler_single_rotation(xp):
    quat = Rotation.from_euler("z", xp.asarray(90), degrees=True).as_quat()
    expected_quat = xp.asarray([0.0, 0, 1, 1]) / math.sqrt(2)
    xp_assert_close(quat, expected_quat)


def test_single_intrinsic_extrinsic_rotation(xp):
    extrinsic = Rotation.from_euler('z', xp.asarray(90), degrees=True).as_matrix()
    intrinsic = Rotation.from_euler('Z', xp.asarray(90), degrees=True).as_matrix()
    xp_assert_close(extrinsic, intrinsic)


def test_from_euler_rotation_order(xp):
    # Intrinsic rotation is same as extrinsic with order reversed
    rnd = np.random.RandomState(0)
    a = xp.asarray(rnd.randint(low=0, high=180, size=(6, 3)))
    b = xp.flip(a, axis=-1)
    x = Rotation.from_euler('xyz', a, degrees=True).as_quat()
    y = Rotation.from_euler('ZYX', b, degrees=True).as_quat()
    xp_assert_close(x, y)


def test_from_euler_elementary_extrinsic_rotation(xp):
    atol = 1e-12
    # Simple test to check if extrinsic rotations are implemented correctly
    mat = Rotation.from_euler('zx', xp.asarray([90, 90]), degrees=True).as_matrix()
    expected_mat = xp.asarray([
        [0.0, -1, 0],
        [0, 0, -1],
        [1, 0, 0]
    ])
    xp_assert_close(mat, expected_mat, atol=atol)


def test_from_euler_intrinsic_rotation_312(xp):
    atol = 1e-7
    angles = xp.asarray([
        [30, 60, 45],
        [30, 60, 30],
        [45, 30, 60]
        ])
    mat = Rotation.from_euler('ZXY', angles, degrees=True).as_matrix()

    xp_assert_close(mat[0, ...], xp.asarray([
        [0.3061862, -0.2500000, 0.9185587],
        [0.8838835, 0.4330127, -0.1767767],
        [-0.3535534, 0.8660254, 0.3535534]
    ]), atol=atol)

    xp_assert_close(mat[1, ...], xp.asarray([
        [0.5334936, -0.2500000, 0.8080127],
        [0.8080127, 0.4330127, -0.3995191],
        [-0.2500000, 0.8660254, 0.4330127]
    ]), atol=atol)

    xp_assert_close(mat[2, ...], xp.asarray([
        [0.0473672, -0.6123725, 0.7891491],
        [0.6597396, 0.6123725, 0.4355958],
        [-0.7500000, 0.5000000, 0.4330127]
    ]), atol=atol)


def test_from_euler_intrinsic_rotation_313(xp):
    angles = xp.asarray([
        [30, 60, 45],
        [30, 60, 30],
        [45, 30, 60]
        ])
    mat = Rotation.from_euler('ZXZ', angles, degrees=True).as_matrix()

    xp_assert_close(mat[0, ...], xp.asarray([
        [0.43559574, -0.78914913, 0.4330127],
        [0.65973961, -0.04736717, -0.750000],
        [0.61237244, 0.61237244, 0.500000]
    ]))

    xp_assert_close(mat[1, ...], xp.asarray([
        [0.6250000, -0.64951905, 0.4330127],
        [0.64951905, 0.1250000, -0.750000],
        [0.4330127, 0.750000, 0.500000]
    ]))

    xp_assert_close(mat[2, ...], xp.asarray([
        [-0.1767767, -0.91855865, 0.35355339],
        [0.88388348, -0.30618622, -0.35355339],
        [0.4330127, 0.25000000, 0.8660254]
    ]))


def test_from_euler_extrinsic_rotation_312(xp):
    angles = xp.asarray([
        [30, 60, 45],
        [30, 60, 30],
        [45, 30, 60]
        ])
    mat = Rotation.from_euler('zxy', angles, degrees=True).as_matrix()

    xp_assert_close(mat[0, ...], xp.asarray([
        [0.91855865, 0.1767767, 0.35355339],
        [0.25000000, 0.4330127, -0.8660254],
        [-0.30618622, 0.88388348, 0.35355339]
    ]))

    xp_assert_close(mat[1, ...], xp.asarray([
        [0.96650635, -0.0580127, 0.2500000],
        [0.25000000, 0.4330127, -0.8660254],
        [-0.0580127, 0.89951905, 0.4330127]
    ]))

    xp_assert_close(mat[2, ...], xp.asarray([
        [0.65973961, -0.04736717, 0.7500000],
        [0.61237244, 0.61237244, -0.5000000],
        [-0.43559574, 0.78914913, 0.4330127]
    ]))


def test_from_euler_extrinsic_rotation_313(xp):
    angles = xp.asarray([
        [30, 60, 45],
        [30, 60, 30],
        [45, 30, 60]
        ])
    mat = Rotation.from_euler('zxz', angles, degrees=True).as_matrix()

    xp_assert_close(mat[0, ...], xp.asarray([
        [0.43559574, -0.65973961, 0.61237244],
        [0.78914913, -0.04736717, -0.61237244],
        [0.4330127, 0.75000000, 0.500000]
    ]))

    xp_assert_close(mat[1, ...], xp.asarray([
        [0.62500000, -0.64951905, 0.4330127],
        [0.64951905, 0.12500000, -0.750000],
        [0.4330127, 0.75000000, 0.500000]
    ]))

    xp_assert_close(mat[2, ...], xp.asarray([
        [-0.1767767, -0.88388348, 0.4330127],
        [0.91855865, -0.30618622, -0.250000],
        [0.35355339, 0.35355339, 0.8660254]
    ]))


def test_from_euler_array_like():
    rng = np.random.default_rng(123)
    order = "xyz"
    # Single rotation
    r_expected = Rotation.random(rng=rng)
    r = Rotation.from_euler(order, r_expected.as_euler(order).tolist())
    assert r_expected.approx_equal(r, atol=1e-12)

    # Multiple rotations
    r_expected = Rotation.random(3, rng=rng)
    r = Rotation.from_euler(order, r_expected.as_euler(order).tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_from_euler_scalar():
    rng = np.random.default_rng(123)
    deg = rng.uniform(low=-180, high=180)
    r_expected = Rotation.from_euler("x", deg, degrees=True)
    r = Rotation.from_euler("x", float(deg), degrees=True)
    assert r_expected.approx_equal(r, atol=1e-12)


@pytest.mark.parametrize("seq_tuple", permutations("xyz"))
@pytest.mark.parametrize("intrinsic", (False, True))
def test_as_euler_asymmetric_axes(xp, seq_tuple, intrinsic):
    # helper function for mean error tests
    def test_stats(error, mean_max, rms_max):
        mean = xp.mean(error, axis=0)
        std = xp.std(error, axis=0)
        rms = xp.hypot(mean, std)
        assert xp.all(xp.abs(mean) < mean_max)
        assert xp.all(rms < rms_max)

    rnd = np.random.RandomState(0)
    n = 1000
    angles = np.empty((n, 3))
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles[:, 1] = rnd.uniform(low=-np.pi / 2, high=np.pi / 2, size=(n,))
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles = xp.asarray(angles)

    seq = "".join(seq_tuple)
    if intrinsic:
        # Extrinsic rotation (wrt to global world) at lower case
        # intrinsic (WRT the object itself) lower case.
        seq = seq.upper()
    rotation = Rotation.from_euler(seq, angles)
    angles_quat = rotation.as_euler(seq)
    # TODO: Why are we using _as_euler_from_matrix here? As a sanity check? It is not
    # part of the public API and should not be used anywhere else
    angles_mat = rotation._as_euler_from_matrix(seq)
    xp_assert_close(angles, angles_quat, atol=0, rtol=1e-12)
    xp_assert_close(angles, angles_mat, atol=0, rtol=1e-12)
    test_stats(angles_quat - angles, 1e-15, 1e-14)
    test_stats(angles_mat - angles, 1e-15, 1e-14)



@pytest.mark.parametrize("seq_tuple", permutations("xyz"))
@pytest.mark.parametrize("intrinsic", (False, True))
def test_as_euler_symmetric_axes(xp, seq_tuple, intrinsic):
    # helper function for mean error tests
    def test_stats(error, mean_max, rms_max):
        mean = xp.mean(error, axis=0)
        std = xp.std(error, axis=0)
        rms = xp.hypot(mean, std)
        assert xp.all(xp.abs(mean) < mean_max)
        assert xp.all(rms < rms_max)

    rnd = np.random.RandomState(0)
    n = 1000
    angles = np.empty((n, 3))
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles[:, 1] = rnd.uniform(low=0, high=np.pi, size=(n,))
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles = xp.asarray(angles)

    # Rotation of the form A/B/A are rotation around symmetric axes
    seq = "".join([seq_tuple[0], seq_tuple[1], seq_tuple[0]])
    if intrinsic:
        seq = seq.upper()
    rotation = Rotation.from_euler(seq, angles)
    angles_quat = rotation.as_euler(seq)
    # TODO: Same as before: Remove _as_euler_from_matrix?
    angles_mat = rotation._as_euler_from_matrix(seq)
    xp_assert_close(angles, angles_quat, atol=0, rtol=1e-13)
    xp_assert_close(angles, angles_mat, atol=0, rtol=1e-9)
    test_stats(angles_quat - angles, 1e-16, 1e-14)
    test_stats(angles_mat - angles, 1e-15, 1e-13)


@pytest.mark.thread_unsafe
@pytest.mark.parametrize("seq_tuple", permutations("xyz"))
@pytest.mark.parametrize("intrinsic", (False, True))
def test_as_euler_degenerate_asymmetric_axes(xp, seq_tuple, intrinsic):
    atol = 1e-12
    # Since we cannot check for angle equality, we check for rotation matrix
    # equality
    angles = xp.asarray([
        [45, 90, 35],
        [35, -90, 20],
        [35, 90, 25],
        [25, -90, 15]])

    seq = "".join(seq_tuple)
    if intrinsic:
        # Extrinsic rotation (wrt to global world) at lower case
        # Intrinsic (WRT the object itself) upper case.
        seq = seq.upper()
    rotation = Rotation.from_euler(seq, angles, degrees=True)
    mat_expected = rotation.as_matrix()

    # We can only warn on non-lazy backends because we'd need to condition on traced
    # booleans
    with eager_warns(mat_expected, UserWarning, match="Gimbal lock"):
        angle_estimates = rotation.as_euler(seq, degrees=True)
    mat_estimated = Rotation.from_euler(seq, angle_estimates, degrees=True).as_matrix()

    xp_assert_close(mat_expected, mat_estimated, atol=atol)


@pytest.mark.thread_unsafe
@pytest.mark.parametrize("seq_tuple", permutations("xyz"))
@pytest.mark.parametrize("intrinsic", (False, True))
def test_as_euler_degenerate_symmetric_axes(xp, seq_tuple, intrinsic):
    atol = 1e-12
    # Since we cannot check for angle equality, we check for rotation matrix
    # equality
    angles = xp.asarray([
        [15, 0, 60],
        [35, 0, 75],
        [60, 180, 35],
        [15, -180, 25]])

    # Rotation of the form A/B/A are rotation around symmetric axes
    seq = "".join([seq_tuple[0], seq_tuple[1], seq_tuple[0]])
    if intrinsic:
        # Extrinsic rotation (wrt to global world) at lower case
        # Intrinsic (WRT the object itself) upper case.
        seq = seq.upper()
    rotation = Rotation.from_euler(seq, angles, degrees=True)
    mat_expected = rotation.as_matrix()

    # We can only warn on non-lazy backends
    with eager_warns(mat_expected, UserWarning, match="Gimbal lock"):
        angle_estimates = rotation.as_euler(seq, degrees=True)
    mat_estimated = Rotation.from_euler(seq, angle_estimates, degrees=True).as_matrix()

    xp_assert_close(mat_expected, mat_estimated, atol=atol)


@pytest.mark.thread_unsafe
@pytest.mark.parametrize("seq_tuple", permutations("xyz"))
@pytest.mark.parametrize("intrinsic", (False, True))
def test_as_euler_degenerate_compare_algorithms(xp, seq_tuple, intrinsic):
    # this test makes sure that both algorithms are doing the same choices
    # in degenerate cases

    # asymmetric axes
    angles = xp.asarray([
        [45, 90, 35],
        [35, -90, 20],
        [35, 90, 25],
        [25, -90, 15]])

    seq = "".join(seq_tuple)
    if intrinsic:
        # Extrinsic rotation (wrt to global world at lower case
        # Intrinsic (WRT the object itself) upper case.
        seq = seq.upper()

    rot = Rotation.from_euler(seq, angles, degrees=True)
    with eager_warns(rot, UserWarning, match="Gimbal lock"):
        estimates_matrix = rot._as_euler_from_matrix(seq, degrees=True)
        estimates_quat = rot.as_euler(seq, degrees=True)
    xp_assert_close(
        estimates_matrix[:, [0, 2]], estimates_quat[:, [0, 2]], atol=0, rtol=1e-12
    )
    xp_assert_close(estimates_matrix[:, 1], estimates_quat[:, 1], atol=0, rtol=1e-7)

    # symmetric axes
    # Absolute error tolerance must be looser to directly compare the results
    # from both algorithms, because of numerical loss of precision for the
    # method _as_euler_from_matrix near a zero angle value

    angles = xp.asarray([
        [15, 0, 60],
        [35, 0, 75],
        [60, 180, 35],
        [15, -180, 25]])

    idx = angles[:, 1] == 0  # find problematic angles indices

    # Rotation of the form A/B/A are rotation around symmetric axes
    seq = "".join([seq_tuple[0], seq_tuple[1], seq_tuple[0]])
    if intrinsic:
        # Extrinsic rotation (wrt to global world) at lower case
        # Intrinsic (WRT the object itself) upper case.
        seq = seq.upper()

    rot = Rotation.from_euler(seq, angles, degrees=True)
    with eager_warns(rot, UserWarning, match="Gimbal lock"):
        estimates_matrix = rot._as_euler_from_matrix(seq, degrees=True)
    with eager_warns(rot, UserWarning, match="Gimbal lock"):
        estimates_quat = rot.as_euler(seq, degrees=True)
    xp_assert_close(
        estimates_matrix[:, [0, 2]], estimates_quat[:, [0, 2]], atol=0, rtol=1e-12
    )

    xp_assert_close(
        estimates_matrix[~idx, 1], estimates_quat[~idx, 1], atol=0, rtol=1e-7
    )

    xp_assert_close(
        estimates_matrix[idx, 1], estimates_quat[idx, 1], atol=1e-6
    )  # problematic, angles[1] = 0


def test_inv(xp):
    atol = 1e-12
    rnd = np.random.RandomState(0)
    n = 10
    # preserve use of old random_state during SPEC 7 transition
    p = Rotation.random(num=n, random_state=rnd)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    q = p.inv()

    p_mat = p.as_matrix()
    q_mat = q.as_matrix()
    result1 = xp.asarray(np.einsum("...ij,...jk->...ik", p_mat, q_mat))
    result2 = xp.asarray(np.einsum("...ij,...jk->...ik", q_mat, p_mat))

    eye3d = xp.empty((n, 3, 3))
    eye3d = xpx.at(eye3d)[..., :3, :3].set(xp.eye(3))

    xp_assert_close(result1, eye3d, atol=atol)
    xp_assert_close(result2, eye3d, atol=atol)


def test_inv_single_rotation(xp):
    atol = 1e-12
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    p = Rotation.random(rng=rng)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    q = p.inv()

    p_mat = p.as_matrix()
    q_mat = q.as_matrix()
    res1 = np.dot(p_mat, q_mat)
    res2 = np.dot(q_mat, p_mat)

    eye = xp.eye(3)

    xp_assert_close(res1, eye, atol=atol)
    xp_assert_close(res2, eye, atol=atol)

    x = Rotation.random(num=1, rng=rng)
    x = Rotation.from_quat(xp.asarray(x.as_quat()))
    y = x.inv()

    x_matrix = x.as_matrix()
    y_matrix = y.as_matrix()
    result1 = xp.linalg.matmul(x_matrix, y_matrix)
    result2 = xp.linalg.matmul(y_matrix, x_matrix)

    eye3d = xp.empty((1, 3, 3))
    eye3d = xpx.at(eye3d)[..., :3, :3].set(xp.eye(3))

    xp_assert_close(result1, eye3d, atol=atol)
    xp_assert_close(result2, eye3d, atol=atol)


def test_identity_magnitude(xp):
    n = 10
    r = Rotation.identity(n)
    r = Rotation.from_quat(xp.asarray(r.as_quat()))
    expected = xp.zeros(n)
    xp_assert_close(r.magnitude(), expected)
    xp_assert_close(r.inv().magnitude(), expected)


def test_single_identity_magnitude(xp):
    r = Rotation.from_quat(xp.asarray(Rotation.identity().as_quat()))
    assert r.magnitude() == 0
    assert r.inv().magnitude() == 0


def test_identity_invariance(xp):
    atol = 1e-12
    n = 10
    p = Rotation.random(n, rng=0)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    q = Rotation.from_quat(xp.asarray(Rotation.identity(n).as_quat()))
    result = p * q
    xp_assert_close(p.as_quat(), result.as_quat())

    result = result * p.inv()
    xp_assert_close(result.magnitude(), xp.zeros(n), atol=atol)


def test_single_identity_invariance(xp):
    atol = 1e-12
    n = 10
    p = Rotation.random(n, rng=0)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))

    q = Rotation.from_quat(xp.asarray(Rotation.identity().as_quat()))
    result = p * q
    xp_assert_close(p.as_quat(), result.as_quat())

    result = result * p.inv()
    xp_assert_close(result.magnitude(), xp.zeros(n), atol=atol)


def test_magnitude(xp):
    r = Rotation.from_quat(xp.eye(4))
    result = r.magnitude()
    xp_assert_close(result, xp.asarray([xp.pi, xp.pi, xp.pi, 0]))

    r = Rotation.from_quat(-xp.eye(4))
    result = r.magnitude()
    xp_assert_close(result, xp.asarray([xp.pi, xp.pi, xp.pi, 0]))


def test_magnitude_single_rotation(xp):
    r = Rotation.from_quat(xp.eye(4))
    result1 = r[0].magnitude()
    xp_assert_close(result1, xp.pi)

    result2 = r[3].magnitude()
    xp_assert_close(result2, 0.0)


def test_approx_equal(xp):
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    p = Rotation.random(10, rng=rng)
    q = Rotation.random(10, rng=rng)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    q = Rotation.from_quat(xp.asarray(q.as_quat()))
    r = p * q.inv()
    r_mag = r.magnitude()
    atol = xp.asarray(np.median(r_mag))  # ensure we get mix of Trues and Falses
    xp_assert_equal(p.approx_equal(q, atol), (r_mag < atol))


@pytest.mark.thread_unsafe
def test_approx_equal_single_rotation(xp):
    # also tests passing single argument to approx_equal
    p = Rotation.from_rotvec(xp.asarray([0, 0, 1e-9]))  # less than default atol of 1e-8
    q = Rotation.from_quat(xp.eye(4))
    assert p.approx_equal(q[3])
    assert not p.approx_equal(q[0])

    # test passing atol and using degrees
    assert not p.approx_equal(q[3], atol=1e-10)
    assert not p.approx_equal(q[3], atol=1e-8, degrees=True)
    with pytest.warns(UserWarning, match="atol must be set"):
        assert p.approx_equal(q[3], degrees=True)


def test_mean(xp):
    axes = xp.concat((-xp.eye(3), xp.eye(3)))
    axes = np.concatenate((-np.eye(3), np.eye(3)))
    thetas = xp.linspace(0, xp.pi / 2, 100)
    for t in thetas:
        r = Rotation.from_rotvec(t * axes)
        xp_assert_close(r.mean().magnitude(), 0.0, atol=1e-10)


def test_weighted_mean(xp):
    # test that doubling a weight is equivalent to including a rotation twice.
    axes = xp.asarray([[0.0, 0, 0], [1, 0, 0], [1, 0, 0]])
    thetas = xp.linspace(0, xp.pi / 2, 100)
    for t in thetas:
        rw = Rotation.from_rotvec(t * axes[:2, ...])
        mw = rw.mean(weights=[1, 2])

        r = Rotation.from_rotvec(t * axes)
        m = r.mean()
        xp_assert_close((m * mw.inv()).magnitude(), 0.0, atol=1e-10)


def test_mean_invalid_weights(xp):
    r = Rotation.from_quat(xp.eye(4))
    if is_lazy_array(r.as_quat()):
        m = r.mean(weights=-xp.ones(4))
        assert all(xp.isnan(m._quat))
    else:
        with pytest.raises(ValueError, match="non-negative"):
            r.mean(weights=-xp.ones(4))


def test_reduction_no_indices(xp):
    r = Rotation.from_quat(xp.asarray([0.0, 0.0, 0.0, 1.0]))
    result = r.reduce(return_indices=False)
    assert isinstance(result, Rotation)


def test_reduction_none_indices(xp):
    r = Rotation.from_quat(xp.asarray([0.0, 0.0, 0.0, 1.0]))
    result = r.reduce(return_indices=True)
    assert type(result) is tuple
    assert len(result) == 3

    reduced, left_best, right_best = result
    assert left_best is None
    assert right_best is None


def test_reduction_scalar_calculation(xp):
    atol = 1e-12
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    l = Rotation.from_quat(xp.asarray(Rotation.random(5, rng=rng).as_quat()))
    r = Rotation.from_quat(xp.asarray(Rotation.random(10, rng=rng).as_quat()))
    p = Rotation.from_quat(xp.asarray(Rotation.random(7, rng=rng).as_quat()))
    reduced, left_best, right_best = p.reduce(l, r, return_indices=True)

    # Loop implementation of the vectorized calculation in Rotation.reduce
    scalars = np.zeros((len(l), len(p), len(r)))
    for i, li in enumerate(l):
        for j, pj in enumerate(p):
            for k, rk in enumerate(r):
                scalars[i, j, k] = np.abs((li * pj * rk).as_quat()[3])
    scalars = np.reshape(np.moveaxis(scalars, 1, 0), (scalars.shape[1], -1))

    max_ind = np.argmax(np.reshape(scalars, (len(p), -1)), axis=1)
    left_best_check = xp.asarray(max_ind // len(r))
    right_best_check = xp.asarray(max_ind % len(r))
    assert xp.all(left_best == left_best_check)
    assert xp.all(right_best == right_best_check)

    reduced_check = l[left_best_check] * p * r[right_best_check]
    mag = (reduced.inv() * reduced_check).magnitude()
    xp_assert_close(mag, xp.zeros(len(p)), atol=atol)


def test_apply_single_rotation_single_point(xp):
    mat = xp.asarray([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    r_1d = Rotation.from_matrix(mat)
    r_2d = Rotation.from_matrix(xp.expand_dims(mat, axis=0))

    v_1d = xp.asarray([1.0, 2, 3])
    v_2d = xp.expand_dims(v_1d, axis=0)
    v1d_rotated = xp.asarray([-2.0, 1, 3])
    v2d_rotated = xp.expand_dims(v1d_rotated, axis=0)

    xp_assert_close(r_1d.apply(v_1d), v1d_rotated)
    xp_assert_close(r_1d.apply(v_2d), v2d_rotated)
    xp_assert_close(r_2d.apply(v_1d), v2d_rotated)
    xp_assert_close(r_2d.apply(v_2d), v2d_rotated)

    v1d_inverse = xp.asarray([2.0, -1, 3])
    v2d_inverse = xp.expand_dims(v1d_inverse, axis=0)

    xp_assert_close(r_1d.apply(v_1d, inverse=True), v1d_inverse)
    xp_assert_close(r_1d.apply(v_2d, inverse=True), v2d_inverse)
    xp_assert_close(r_2d.apply(v_1d, inverse=True), v2d_inverse)
    xp_assert_close(r_2d.apply(v_2d, inverse=True), v2d_inverse)


def test_apply_single_rotation_multiple_points(xp):
    mat = xp.asarray([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    r1 = Rotation.from_matrix(mat)
    r2 = Rotation.from_matrix(xp.expand_dims(mat, axis=0))

    v = xp.asarray([[1, 2, 3], [4, 5, 6]])
    v_rotated = xp.asarray([[-2.0, 1, 3], [-5, 4, 6]])

    xp_assert_close(r1.apply(v), v_rotated)
    xp_assert_close(r2.apply(v), v_rotated)

    v_inverse = xp.asarray([[2.0, -1, 3], [5, -4, 6]])

    xp_assert_close(r1.apply(v, inverse=True), v_inverse)
    xp_assert_close(r2.apply(v, inverse=True), v_inverse)


def test_apply_multiple_rotations_single_point(xp):
    mat = np.empty((2, 3, 3))
    mat[0] = np.array([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    mat[1] = np.array([
        [1, 0, 0],
        [0, 0, -1],
        [0, 1, 0]
    ])
    mat = xp.asarray(mat)
    r = Rotation.from_matrix(mat)

    v1 = xp.asarray([1, 2, 3])
    v2 = xp.expand_dims(v1, axis=0)

    v_rotated = xp.asarray([[-2.0, 1, 3], [1, -3, 2]])

    xp_assert_close(r.apply(v1), v_rotated)
    xp_assert_close(r.apply(v2), v_rotated)

    v_inverse = xp.asarray([[2.0, -1, 3], [1, 3, -2]])

    xp_assert_close(r.apply(v1, inverse=True), v_inverse)
    xp_assert_close(r.apply(v2, inverse=True), v_inverse)


def test_apply_multiple_rotations_multiple_points(xp):
    mat = np.empty((2, 3, 3))
    mat[0] = np.array([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    mat[1] = np.array([
        [1, 0, 0],
        [0, 0, -1],
        [0, 1, 0]
    ])
    mat = xp.asarray(mat)
    r = Rotation.from_matrix(mat)

    v = xp.asarray([[1, 2, 3], [4, 5, 6]])
    v_rotated = xp.asarray([[-2.0, 1, 3], [4, -6, 5]])
    xp_assert_close(r.apply(v), v_rotated)

    v_inverse = xp.asarray([[2.0, -1, 3], [4, 6, -5]])
    xp_assert_close(r.apply(v, inverse=True), v_inverse)


def test_apply_shapes(xp):
    vector0 = xp.asarray([1.0, 2.0, 3.0])
    vector1 = xp.asarray([vector0])
    vector2 = xp.asarray([vector0, vector0])
    matrix0 = xp.eye(3)
    matrix1 = xp.asarray([matrix0])
    matrix2 = xp.asarray([matrix0, matrix0])

    for m, v in product([matrix0, matrix1, matrix2], [vector0, vector1, vector2]):
        r = Rotation.from_matrix(m)
        shape = v.shape
        if not r.single and (v.shape == (3,) or v.shape == (1, 3)):
            shape = (len(r), 3)
        x = r.apply(v)
        assert x.shape == shape
        x = r.apply(v, inverse=True)
        assert x.shape == shape


def test_apply_array_like():
    rng = np.random.default_rng(123)
    # Single vector
    r = Rotation.random(rng=rng)
    t = rng.uniform(-100, 100, size=(3,))
    v = r.apply(t.tolist())
    v_expected = r.apply(t)
    xp_assert_close(v, v_expected, atol=1e-12)
    # Multiple vectors
    t = rng.uniform(-100, 100, size=(2, 3))
    v = r.apply(t.tolist())
    v_expected = r.apply(t)
    xp_assert_close(v, v_expected, atol=1e-12)


def test_getitem(xp):
    mat = np.empty((2, 3, 3))
    mat[0] = np.array([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    mat[1] = np.array([
        [1, 0, 0],
        [0, 0, -1],
        [0, 1, 0]
    ])
    mat = xp.asarray(mat)
    r = Rotation.from_matrix(mat)

    xp_assert_close(r[0].as_matrix(), mat[0], atol=1e-15)
    xp_assert_close(r[1].as_matrix(), mat[1, ...], atol=1e-15)
    xp_assert_close(r[:-1].as_matrix(), xp.expand_dims(mat[0, ...], axis=0), atol=1e-15)


def test_getitem_single(xp):
    with pytest.raises(TypeError, match='not subscriptable'):
        Rotation.from_quat(xp.asarray([0, 0, 0, 1]))[0]


def test_getitem_array_like():
    mat = np.array([[[0.0, -1, 0],
                     [1, 0, 0],
                     [0, 0, 1]],
                    [[1, 0, 0],
                     [0, 0, -1],
                     [0, 1, 0]]])
    r = Rotation.from_matrix(mat)
    xp_assert_close(r[[0]].as_matrix(), mat[[0]], atol=1e-15)
    xp_assert_close(r[[0, 1]].as_matrix(), mat[[0, 1]], atol=1e-15)


def test_setitem_single(xp):
    r = Rotation.from_quat(xp.asarray([0, 0, 0, 1]))
    with pytest.raises(TypeError, match='not subscriptable'):
        r[0] = Rotation.from_quat(xp.asarray([0, 0, 0, 1]))


def test_setitem_slice(xp):
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    r1 = Rotation.from_quat(xp.asarray(Rotation.random(10, rng=rng).as_quat()))
    r2 = Rotation.from_quat(xp.asarray(Rotation.random(5, rng=rng).as_quat()))
    r1[1:6] = r2
    xp_assert_equal(r1[1:6].as_quat(), r2.as_quat())


def test_setitem_integer(xp):
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    r1 = Rotation.from_quat(xp.asarray(Rotation.random(10, rng=rng).as_quat()))
    r2 = Rotation.from_quat(xp.asarray(Rotation.random(rng=rng).as_quat()))
    r1[1] = r2
    xp_assert_equal(r1[1].as_quat(), r2.as_quat())


def test_setitem_wrong_type(xp):
    r = Rotation.from_quat(xp.asarray(Rotation.random(10, rng=0).as_quat()))
    with pytest.raises(TypeError, match='Rotation object'):
        r[0] = 1


def test_n_rotations(xp):
    mat = np.empty((2, 3, 3))
    mat[0] = np.array([
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1]
    ])
    mat[1] = np.array([
        [1, 0, 0],
        [0, 0, -1],
        [0, 1, 0]
    ])
    mat = xp.asarray(mat)
    r = Rotation.from_matrix(mat)

    assert_equal(len(r), 2)
    assert_equal(len(r[:-1]), 1)


def test_random_rotation_shape():
    # No xp testing since random rotations are always using NumPy
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    assert_equal(Rotation.random(rng=rng).as_quat().shape, (4,))
    assert_equal(Rotation.random(None, rng=rng).as_quat().shape, (4,))

    assert_equal(Rotation.random(1, rng=rng).as_quat().shape, (1, 4))
    assert_equal(Rotation.random(5, rng=rng).as_quat().shape, (5, 4))


def test_align_vectors_no_rotation(xp):
    x = xp.asarray([[1, 2, 3], [4, 5, 6]])
    y = xp.asarray(x, copy=True)

    r, rssd = Rotation.align_vectors(x, y)
    xp_assert_close(r.as_matrix(), xp.eye(3), atol=1e-12)
    xp_assert_close(rssd, xp.asarray(0.0)[()], check_shape=False, atol=1e-6)


def test_align_vectors_no_noise(xp):
    rng = np.random.default_rng(14697284569885399755764481408308808739)
    c = Rotation.from_quat(xp.asarray(Rotation.random(rng=rng).as_quat()))
    b = xp.asarray(rng.normal(size=(5, 3)))
    a = c.apply(b)

    est, rssd = Rotation.align_vectors(a, b)
    xp_assert_close(c.as_quat(), est.as_quat())
    xp_assert_close(rssd, xp.asarray(0.0)[()], check_shape=False, atol=1e-7)


def test_align_vectors_improper_rotation(xp):
    # Tests correct logic for issue #10444
    x = xp.asarray([[0.89299824, -0.44372674, 0.0752378],
                    [0.60221789, -0.47564102, -0.6411702]])
    y = xp.asarray([[0.02386536, -0.82176463, 0.5693271],
                    [-0.27654929, -0.95191427, -0.1318321]])

    est, rssd = Rotation.align_vectors(x, y)
    xp_assert_close(x, est.apply(y), atol=1e-6)
    xp_assert_close(rssd, xp.asarray(0.0)[()], check_shape=False, atol=1e-7)


def test_align_vectors_rssd_sensitivity(xp):
    rssd_expected = xp.asarray(0.141421356237308)[()]
    sens_expected = xp.asarray([[0.2, 0. , 0.],
                                [0. , 1.5, 1.],
                                [0. , 1. , 1.]])
    atol = 1e-6
    a = xp.asarray([[0, 1, 0], [0, 1, 1], [0, 1, 1]])
    b = xp.asarray([[1, 0, 0], [1, 1.1, 0], [1, 0.9, 0]])
    rot, rssd, sens = Rotation.align_vectors(a, b, return_sensitivity=True)
    xp_assert_close(rssd, rssd_expected, atol=atol)
    xp_assert_close(sens, sens_expected, atol=atol)


def test_align_vectors_scaled_weights(xp):
    n = 10
    a = xp.asarray(Rotation.random(n, rng=0).apply([1, 0, 0]))
    b = xp.asarray(Rotation.random(n, rng=1).apply([1, 0, 0]))
    scale = 2

    est1, rssd1, cov1 = Rotation.align_vectors(a, b, xp.ones(n), True)
    est2, rssd2, cov2 = Rotation.align_vectors(a, b, scale * xp.ones(n), True)

    xp_assert_close(est1.as_matrix(), est2.as_matrix())
    xp_assert_close(math.sqrt(scale) * rssd1, rssd2, atol=1e-6)
    xp_assert_close(cov1, cov2)


def test_align_vectors_noise(xp):
    rng = np.random.default_rng(146972845698875399755764481408308808739)
    n_vectors = 100
    rot = rotation_to_xp(Rotation.random(rng=rng), xp)
    vectors = xp.asarray(rng.normal(size=(n_vectors, 3)))
    result = rot.apply(vectors)

    # The paper adds noise as independently distributed angular errors
    sigma = np.deg2rad(1)
    tolerance = 1.5 * sigma
    noise = Rotation.from_rotvec(
        xp.asarray(rng.normal(
            size=(n_vectors, 3),
            scale=sigma
        ))
    )

    # Attitude errors must preserve norm. Hence apply individual random
    # rotations to each vector.
    noisy_result = noise.apply(result)

    est, rssd, cov = Rotation.align_vectors(noisy_result, vectors,
                                            return_sensitivity=True)

    # Use rotation compositions to find out closeness
    error_vector = (rot * est.inv()).as_rotvec()
    xp_assert_close(error_vector[0], xp.asarray(0.0)[()], atol=tolerance)
    xp_assert_close(error_vector[1], xp.asarray(0.0)[()], atol=tolerance)
    xp_assert_close(error_vector[2], xp.asarray(0.0)[()], atol=tolerance)

    # Check error bounds using covariance matrix
    cov *= sigma
    xp_assert_close(cov[0, 0], xp.asarray(0.0)[()], atol=tolerance)
    xp_assert_close(cov[1, 1], xp.asarray(0.0)[()], atol=tolerance)
    xp_assert_close(cov[2, 2], xp.asarray(0.0)[()], atol=tolerance)

    rssd_check = xp.sum((noisy_result - est.apply(vectors)) ** 2) ** 0.5
    xp_assert_close(rssd, rssd_check, check_shape=False)


def test_align_vectors_invalid_input(xp):
    with pytest.raises(ValueError, match="Expected input `a` to have shape"):
        a, b = xp.asarray([1, 2, 3, 4]), xp.asarray([1, 2, 3])
        Rotation.align_vectors(a, b)

    with pytest.raises(ValueError, match="Expected input `b` to have shape"):
        a, b = xp.asarray([1, 2, 3]), xp.asarray([1, 2, 3, 4])
        Rotation.align_vectors(a, b)

    with pytest.raises(ValueError, match="Expected inputs `a` and `b` "
                                         "to have same shapes"):
        a, b = xp.asarray([[1, 2, 3], [4, 5, 6]]), xp.asarray([[1, 2, 3]])
        Rotation.align_vectors(a, b)

    with pytest.raises(ValueError,
                       match="Expected `weights` to be 1 dimensional"):
        a, b = xp.asarray([[1, 2, 3]]), xp.asarray([[1, 2, 3]])
        weights = xp.asarray([[1]])
        Rotation.align_vectors(a, b, weights)

    with pytest.raises(ValueError,
                       match="Expected `weights` to have number of values"):
        a, b = xp.asarray([[1, 2, 3], [4, 5, 6]]), xp.asarray([[1, 2, 3], [4, 5, 6]])
        weights = xp.asarray([1, 2, 3])
        Rotation.align_vectors(a, b, weights)

    a, b = xp.asarray([[1, 2, 3]]), xp.asarray([[1, 2, 3]])
    weights = xp.asarray([-1])
    if is_lazy_array(weights):
        r, rssd = Rotation.align_vectors(a, b, weights)
        assert xp.all(xp.isnan(r.as_quat())), "Quaternion should be nan"
        assert xp.isnan(rssd), "RSSD should be nan"
    else:
        with pytest.raises(ValueError,
                           match="`weights` may not contain negative values"):
            Rotation.align_vectors(a, b, weights)

    a, b = xp.asarray([[1, 2, 3], [4, 5, 6]]), xp.asarray([[1, 2, 3], [4, 5, 6]])
    weights = xp.asarray([xp.inf, xp.inf])
    if is_lazy_array(weights):
        r, rssd = Rotation.align_vectors(a, b, weights)
        assert xp.all(xp.isnan(r.as_quat())), "Quaternion should be nan"
        assert xp.isnan(rssd), "RSSD should be nan"
    else:
        with pytest.raises(ValueError,
                           match="Only one infinite weight is allowed"):
            Rotation.align_vectors(a, b, weights)

    a, b = xp.asarray([[0, 0, 0]]), xp.asarray([[1, 2, 3]])
    if is_lazy_array(a):
        r, rssd = Rotation.align_vectors(a, b)
        assert xp.all(xp.isnan(r.as_quat())), "Quaternion should be nan"
        assert xp.isnan(rssd), "RSSD should be nan"
    else:
        with pytest.raises(ValueError,
                           match="Cannot align zero length primary vectors"):
            Rotation.align_vectors(a, b)

    a, b = xp.asarray([[1, 2, 3], [4, 5, 6]]), xp.asarray([[1, 2, 3], [4, 5, 6]])
    weights = xp.asarray([xp.inf, 1])
    if is_lazy_array(a):
        r, rssd, sens = Rotation.align_vectors(a, b, weights, return_sensitivity=True)
        assert xp.all(xp.isnan(sens)), "Sensitivity matrix should be nan"
    else:
        with pytest.raises(ValueError,
                           match="Cannot return sensitivity matrix"):
            Rotation.align_vectors(a, b, weights, return_sensitivity=True)

    a, b = xp.asarray([[1, 2, 3]]), xp.asarray([[1, 2, 3]])
    if is_lazy_array(a):
        r, rssd, sens = Rotation.align_vectors(a, b, return_sensitivity=True)
        assert xp.all(xp.isnan(sens)), "Sensitivity matrix should be nan"
    else:
        with pytest.raises(ValueError,
                        match="Cannot return sensitivity matrix"):
                        Rotation.align_vectors(a, b, return_sensitivity=True)


def test_align_vectors_align_constrain(xp):
    # Align the primary +X B axis with the primary +Y A axis, and rotate about
    # it such that the +Y B axis (residual of the [1, 1, 0] secondary b vector)
    # is aligned with the +Z A axis (residual of the [0, 1, 1] secondary a
    # vector)
    atol = 1e-12
    b = xp.asarray([[1, 0, 0], [1, 1, 0]])
    a = xp.asarray([[0.0, 1, 0], [0, 1, 1]])
    m_expected = xp.asarray([[0.0, 0, 1],
                             [1, 0, 0],
                             [0, 1, 0]])
    R, rssd = Rotation.align_vectors(a, b, weights=xp.asarray([xp.inf, 1]))
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    xp_assert_close(R.apply(b), a, atol=atol)  # Pri and sec align exactly
    assert xpx.isclose(rssd, 0.0, atol=atol, xp=xp)

    # Do the same but with an inexact secondary rotation
    b = xp.asarray([[1, 0, 0], [1, 2, 0]])
    rssd_expected = 1.0
    R, rssd = Rotation.align_vectors(a, b, weights=xp.asarray([xp.inf, 1]))
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    xp_assert_close(R.apply(b)[0, ...], a[0, ...], atol=atol)  # Only pri aligns exactly
    assert xpx.isclose(rssd, rssd_expected, atol=atol, xp=xp)
    a_expected = xp.asarray([[0.0, 1, 0], [0, 1, 2]])
    xp_assert_close(R.apply(b), a_expected, atol=atol)

    # Check random vectors
    b = xp.asarray([[1, 2, 3], [-2, 3, -1]])
    a = xp.asarray([[-1.0, 3, 2], [1, -1, 2]])
    rssd_expected = 1.3101595297515016
    R, rssd = Rotation.align_vectors(a, b, weights=xp.asarray([xp.inf, 1]))
    xp_assert_close(R.apply(b)[0, ...], a[0, ...], atol=atol)  # Only pri aligns exactly
    assert xpx.isclose(rssd, rssd_expected, atol=atol, xp=xp)


def test_align_vectors_near_inf(xp):
    # align_vectors should return near the same result for high weights as for
    # infinite weights. rssd will be different with floating point error on the
    # exactly aligned vector being multiplied by a large non-infinite weight
    n = 100
    mats = []
    for i in range(6):
        mats.append(Rotation.random(n, rng=10 + i).as_matrix())

    for i in range(n):
        # Get random pairs of 3-element vectors
        a = xp.asarray([1 * mats[0][i][0], 2 * mats[1][i][0]])
        b = xp.asarray([3 * mats[2][i][0], 4 * mats[3][i][0]])

        R, _ = Rotation.align_vectors(a, b, weights=[1e10, 1])
        R2, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 1])
        xp_assert_close(R.as_matrix(), R2.as_matrix(), atol=1e-4)

    for i in range(n):
        # Get random triplets of 3-element vectors
        a = xp.asarray([1*mats[0][i][0], 2*mats[1][i][0], 3*mats[2][i][0]])
        b = xp.asarray([4*mats[3][i][0], 5*mats[4][i][0], 6*mats[5][i][0]])

        R, _ = Rotation.align_vectors(a, b, weights=[1e10, 2, 1])
        R2, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 2, 1])
        xp_assert_close(R.as_matrix(), R2.as_matrix(), atol=1e-4)


def test_align_vectors_parallel(xp):
    atol = 1e-12
    a = xp.asarray([[1.0, 0, 0], [0, 1, 0]])
    b = xp.asarray([[0.0, 1, 0], [0, 1, 0]])
    m_expected = xp.asarray([[0.0, 1, 0],
                             [-1, 0, 0],
                             [0, 0, 1]])
    R, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 1])
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    R, _ = Rotation.align_vectors(a[0, ...], b[0, ...])
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    xp_assert_close(R.apply(b[0, ...]), a[0, ...], atol=atol)

    b = xp.asarray([[1, 0, 0], [1, 0, 0]])
    m_expected = xp.asarray([[1.0, 0, 0],
                             [0, 1, 0],
                             [0, 0, 1]])
    R, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 1])
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    R, _ = Rotation.align_vectors(a[0, ...], b[0, ...])
    xp_assert_close(R.as_matrix(), m_expected, atol=atol)
    xp_assert_close(R.apply(b[0, ...]), a[0, ...], atol=atol)


def test_align_vectors_antiparallel(xp):
    # Test exact 180 deg rotation
    atol = 1e-12
    as_to_test = np.array([[[1.0, 0, 0], [0, 1, 0]],
                           [[0, 1, 0], [1, 0, 0]],
                           [[0, 0, 1], [0, 1, 0]]])

    bs_to_test = [[-a[0], a[1]] for a in as_to_test]
    for a, b in zip(as_to_test, bs_to_test):
        a, b = xp.asarray(a), xp.asarray(b)
        R, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 1])
        xp_assert_close(R.magnitude(), xp.pi, atol=atol)
        xp_assert_close(R.apply(b[0, ...]), a[0, ...], atol=atol)

    # Test exact rotations near 180 deg
    Rs = Rotation.random(100, rng=0)
    dRs = Rotation.from_rotvec(Rs.as_rotvec()*1e-4)  # scale down to small angle
    a = [[ 1, 0, 0], [0, 1, 0]]
    b = [[-1, 0, 0], [0, 1, 0]]
    as_to_test = []
    for dR in dRs:
        as_to_test.append(np.array([dR.apply(a[0]), a[1]]))
    for a in as_to_test:
        a, b = xp.asarray(a), xp.asarray(b)
        R, _ = Rotation.align_vectors(a, b, weights=[xp.inf, 1])
        R2, _ = Rotation.align_vectors(a, b, weights=[1e10, 1])
        xp_assert_close(R.as_matrix(), R2.as_matrix(), atol=atol)


def test_align_vectors_primary_only(xp):
    atol = 1e-12
    mats_a = Rotation.random(100, rng=0).as_matrix()
    mats_b = Rotation.random(100, rng=1).as_matrix()

    for mat_a, mat_b in zip(mats_a, mats_b):
        # Get random 3-element unit vectors
        a = xp.asarray(mat_a[0])
        b = xp.asarray(mat_b[0])

        # Compare to align_vectors with primary only
        R, rssd = Rotation.align_vectors(a, b)
        xp_assert_close(R.apply(b), a, atol=atol)
        assert np.isclose(rssd, 0, atol=atol)


def test_align_vectors_array_like():
    rng = np.random.default_rng(123)
    c = Rotation.random(rng=rng)
    b = rng.normal(size=(5, 3))
    a = c.apply(b)

    est_expected, rssd_expected = Rotation.align_vectors(a, b)
    est, rssd = Rotation.align_vectors(a.tolist(), b.tolist())
    xp_assert_close(est_expected.as_quat(), est.as_quat())
    xp_assert_close(rssd, rssd_expected)


def test_repr_single_rotation(xp):
    q = xp.asarray([0, 0, 0, 1])
    actual = repr(Rotation.from_quat(q))
    if is_numpy(xp):
        expected = """\
Rotation.from_matrix(array([[1., 0., 0.],
                            [0., 1., 0.],
                            [0., 0., 1.]]))"""
        assert actual == expected
    else:
        assert actual.startswith("Rotation.from_matrix(")


def test_repr_rotation_sequence(xp):
    q = xp.asarray([[0.0, 1, 0, 1], [0, 0, 1, 1]]) / math.sqrt(2)
    actual = f"{Rotation.from_quat(q)!r}"
    if is_numpy(xp):
        expected = """\
Rotation.from_matrix(array([[[ 0.,  0.,  1.],
                             [ 0.,  1.,  0.],
                             [-1.,  0.,  0.]],
                     
                            [[ 0., -1.,  0.],
                             [ 1.,  0.,  0.],
                             [ 0.,  0.,  1.]]]))"""
        assert actual == expected
    else:
        assert actual.startswith("Rotation.from_matrix(")


def test_slerp(xp):
    rnd = np.random.RandomState(0)

    key_rots = Rotation.from_quat(xp.asarray(rnd.uniform(size=(5, 4))))
    key_quats = key_rots.as_quat()

    key_times = [0, 1, 2, 3, 4]
    interpolator = Slerp(key_times, key_rots)
    assert isinstance(interpolator.times, type(xp.asarray(0)))

    times = [0, 0.5, 0.25, 1, 1.5, 2, 2.75, 3, 3.25, 3.60, 4]
    interp_rots = interpolator(times)
    interp_quats = interp_rots.as_quat()

    # Dot products are affected by sign of quaternions
    mask = (interp_quats[:, -1] < 0)[:, None]
    interp_quats = xp.where(mask, -interp_quats, interp_quats)
    # Checking for quaternion equality, perform same operation
    mask = (key_quats[:, -1] < 0)[:, None]
    key_quats = xp.where(mask, -key_quats, key_quats)

    # Equality at keyframes, including both endpoints
    xp_assert_close(interp_quats[0, ...], key_quats[0, ...])
    xp_assert_close(interp_quats[3, ...], key_quats[1, ...])
    xp_assert_close(interp_quats[5, ...], key_quats[2, ...])
    xp_assert_close(interp_quats[7, ...], key_quats[3, ...])
    xp_assert_close(interp_quats[10, ...], key_quats[4, ...])

    # Constant angular velocity between keyframes. Check by equating
    # cos(theta) between quaternion pairs with equal time difference.
    cos_theta1 = xp.sum(interp_quats[0, ...] * interp_quats[2, ...])
    cos_theta2 = xp.sum(interp_quats[2, ...] * interp_quats[1, ...])
    xp_assert_close(cos_theta1, cos_theta2)

    cos_theta4 = xp.sum(interp_quats[3, ...] * interp_quats[4, ...])
    cos_theta5 = xp.sum(interp_quats[4, ...] * interp_quats[5, ...])
    xp_assert_close(cos_theta4, cos_theta5)

    # theta1: 0 -> 0.25, theta3 : 0.5 -> 1
    # Use double angle formula for double the time difference
    cos_theta3 = xp.sum(interp_quats[1, ...] * interp_quats[3, ...])
    xp_assert_close(cos_theta3, 2 * (cos_theta1**2) - 1)

    # Miscellaneous checks
    assert_equal(len(interp_rots), len(times))


def test_slerp_rot_is_rotation(xp):
    with pytest.raises(TypeError, match="must be a `Rotation` instance"):
        r = xp.asarray([[1,2,3,4],
                        [0,0,0,1]])
        t = xp.asarray([0, 1])
        Slerp(t, r)


SLERP_EXCEPTION_MESSAGE = "must be a sequence of at least 2 rotations"


def test_slerp_single_rot(xp):
    r = Rotation.from_quat(xp.asarray([[1.0, 2, 3, 4]]))
    with pytest.raises(ValueError, match=SLERP_EXCEPTION_MESSAGE):
        Slerp([1], r)


def test_slerp_rot_len0(xp):
    r = Rotation.random()
    r = Rotation.from_quat(xp.asarray(r.as_quat()))
    with pytest.raises(ValueError, match=SLERP_EXCEPTION_MESSAGE):
        Slerp([], r)


def test_slerp_rot_len1(xp):
    r = Rotation.random(1)
    r = Rotation.from_quat(xp.asarray(r.as_quat()))
    with pytest.raises(ValueError, match=SLERP_EXCEPTION_MESSAGE):
        Slerp([1], r)


def test_slerp_time_dim_mismatch(xp):
    with pytest.raises(ValueError,
                       match="times to be specified in a 1 dimensional array"):
        rnd = np.random.RandomState(0)
        r = Rotation.from_quat(xp.asarray(rnd.uniform(size=(2, 4))))
        t = xp.asarray([[1],
                        [2]])
        Slerp(t, r)


def test_slerp_num_rotations_mismatch(xp):
    with pytest.raises(ValueError, match="number of rotations to be equal to "
                                         "number of timestamps"):
        rnd = np.random.RandomState(0)
        r = Rotation.from_quat(xp.asarray(rnd.uniform(size=(5, 4))))
        t = xp.arange(7)
        Slerp(t, r)


def test_slerp_equal_times(xp):
    rnd = np.random.RandomState(0)
    q = xp.asarray(rnd.uniform(size=(5, 4)))
    r = Rotation.from_quat(q)
    t = [0, 1, 2, 2, 4]
    if is_lazy_array(q):
        s = Slerp(t, r)
        assert xp.all(xp.isnan(s.times))
    else:
        with pytest.raises(ValueError, match="strictly increasing order"):
            Slerp(t, r)


def test_slerp_decreasing_times(xp):
    rnd = np.random.RandomState(0)
    q = xp.asarray(rnd.uniform(size=(5, 4)))
    r = Rotation.from_quat(q)
    t = [0, 1, 3, 2, 4]
    if is_lazy_array(q):
        s = Slerp(t, r)
        assert xp.all(xp.isnan(s.times))
    else:
        with pytest.raises(ValueError, match="strictly increasing order"):
            Slerp(t, r)


def test_slerp_call_time_dim_mismatch(xp):
    rnd = np.random.RandomState(0)
    r = Rotation.from_quat(xp.asarray(rnd.uniform(size=(5, 4))))
    t = xp.arange(5)
    s = Slerp(t, r)

    with pytest.raises(ValueError,
                       match="`times` must be at most 1-dimensional."):
        interp_times = xp.asarray([[3.5],
                                   [4.2]])
        s(interp_times)


def test_slerp_call_time_out_of_range(xp):
    rnd = np.random.RandomState(0)
    r = Rotation.from_quat(xp.asarray(rnd.uniform(size=(5, 4))))
    t = xp.arange(5) + 1
    s = Slerp(t, r)

    times_low = xp.asarray([0, 1, 2])
    times_high = xp.asarray([1, 2, 6])
    if is_lazy_array(times_low):
        q = s(times_low).as_quat()
        in_range = xp.logical_and(times_low >= xp.min(t), times_low <= xp.max(t))
        assert xp.all(xp.isnan(q[~in_range, ...]))
        assert xp.all(~xp.isnan(q[in_range, ...]))
        q = s(times_high).as_quat()
        in_range = xp.logical_and(times_high >= xp.min(t), times_high <= xp.max(t))
        assert xp.all(xp.isnan(q[~in_range, ...]))
        assert xp.all(~xp.isnan(q[in_range, ...]))
    else:
        with pytest.raises(ValueError, match="times must be within the range"):
            s(times_low)
        with pytest.raises(ValueError, match="times must be within the range"):
            s(times_high)


def test_slerp_call_scalar_time(xp):
    r = Rotation.from_euler('X', xp.asarray([0, 80]), degrees=True)
    s = Slerp([0, 1], r)

    r_interpolated = s(0.25)
    r_interpolated_expected = Rotation.from_euler('X', xp.asarray(20), degrees=True)

    delta = r_interpolated * r_interpolated_expected.inv()

    assert xp.allclose(delta.magnitude(), 0, atol=1e-16)


def test_multiplication_stability(xp):
    qs = Rotation.random(50, rng=0)
    qs = Rotation.from_quat(xp.asarray(qs.as_quat()))
    rs = Rotation.random(1000, rng=1)
    rs = Rotation.from_quat(xp.asarray(rs.as_quat()))
    expected = xp.ones(len(rs))
    for q in qs:
        rs *= q * rs
        xp_assert_close(xp_vector_norm(rs.as_quat(), axis=1), expected)


def test_pow(xp):
    atol = 1e-14
    p = Rotation.random(10, rng=0)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    p_inv = p.inv()
    # Test the short-cuts and other integers
    for n in [-5, -2, -1, 0, 1, 2, 5]:
        # Test accuracy
        q = p ** n
        r = Rotation.identity(10)
        r = Rotation.from_quat(xp.asarray(r.as_quat()))
        for _ in range(abs(n)):
            if n > 0:
                r = r * p
            else:
                r = r * p_inv
        ang = (q * r.inv()).magnitude()
        assert xp.all(ang < atol)

        # Test shape preservation
        r = Rotation.from_quat(xp.asarray([0, 0, 0, 1]))
        assert (r**n).as_quat().shape == (4,)
        r = Rotation.from_quat(xp.asarray([[0, 0, 0, 1]]))
        assert (r**n).as_quat().shape == (1, 4)

    # Large angle fractional
    for n in [-1.5, -0.5, -0.0, 0.0, 0.5, 1.5]:
        q = p ** n
        r = Rotation.from_rotvec(n * p.as_rotvec())
        xp_assert_close(q.as_quat(), r.as_quat(), atol=atol)

    # Small angle
    p = Rotation.from_rotvec(xp.asarray([1e-12, 0, 0]))
    n = 3
    q = p ** n
    r = Rotation.from_rotvec(n * p.as_rotvec())
    xp_assert_close(q.as_quat(), r.as_quat(), atol=atol)


def test_pow_errors(xp):
    p = Rotation.random(rng=0)
    p = Rotation.from_quat(xp.asarray(p.as_quat()))
    with pytest.raises(NotImplementedError, match='modulus not supported'):
        pow(p, 1, 1)


def test_rotation_within_numpy_array():
    # TODO: Do we want to support this for all Array API frameworks?
    single = Rotation.random(rng=0)
    multiple = Rotation.random(2, rng=1)

    array = np.array(single)
    assert_equal(array.shape, ())

    array = np.array(multiple)
    assert_equal(array.shape, (2,))
    xp_assert_close(array[0].as_matrix(), multiple[0].as_matrix())
    xp_assert_close(array[1].as_matrix(), multiple[1].as_matrix())

    array = np.array([single])
    assert_equal(array.shape, (1,))
    assert_equal(array[0], single)

    array = np.array([multiple])
    assert_equal(array.shape, (1, 2))
    xp_assert_close(array[0, 0].as_matrix(), multiple[0].as_matrix())
    xp_assert_close(array[0, 1].as_matrix(), multiple[1].as_matrix())

    array = np.array([single, multiple], dtype=object)
    assert_equal(array.shape, (2,))
    assert_equal(array[0], single)
    assert_equal(array[1], multiple)

    array = np.array([multiple, multiple, multiple])
    assert_equal(array.shape, (3, 2))


def test_pickling(xp):
    # Note: Array API makes no provision for arrays to be pickleable, so
    # it's OK to skip this test for the backends that don't support it
    r = Rotation.from_quat(xp.asarray([0, 0, math.sin(np.pi/4), math.cos(np.pi/4)]))
    pkl = pickle.dumps(r)
    unpickled = pickle.loads(pkl)
    xp_assert_close(r.as_matrix(), unpickled.as_matrix(), atol=1e-15)


def test_deepcopy(xp):
    # Note: Array API makes no provision for arrays to support the `__copy__`
    # protocol, so it's OK to skip this test for the backends that don't
    r = Rotation.from_quat(xp.asarray([0, 0, math.sin(np.pi/4), math.cos(np.pi/4)]))
    r1 = copy.deepcopy(r)
    xp_assert_close(r.as_matrix(), r1.as_matrix(), atol=1e-15)


def test_as_euler_contiguous():
    # The Array API does not specify contiguous arrays, so we can only check for NumPy
    r = Rotation.from_quat([0, 0, 0, 1])
    e1 = r.as_euler('xyz')  # extrinsic euler rotation
    e2 = r.as_euler('XYZ')  # intrinsic
    assert e1.flags['C_CONTIGUOUS'] is True
    assert e2.flags['C_CONTIGUOUS'] is True
    assert all(i >= 0 for i in e1.strides)
    assert all(i >= 0 for i in e2.strides)


def test_concatenate(xp):
    rotation = Rotation.random(10, rng=0)
    rotation = Rotation.from_quat(xp.asarray(rotation.as_quat()))
    sizes = [1, 2, 3, 1, 3]
    starts = [0] + list(np.cumsum(sizes))
    split = [rotation[i:i + n] for i, n in zip(starts, sizes)]
    result = Rotation.concatenate(split)
    xp_assert_equal(rotation.as_quat(), result.as_quat())

    # Test Rotation input for multiple rotations
    result = Rotation.concatenate(rotation)
    xp_assert_equal(rotation.as_quat(), result.as_quat())

    # Test that a copy is returned
    assert rotation is not result

    # Test Rotation input for single rotations
    rot = Rotation.from_quat(xp.asarray(Rotation.identity().as_quat()))
    result = Rotation.concatenate(rot)
    xp_assert_equal(rot.as_quat(), result.as_quat())


def test_concatenate_wrong_type(xp):
    with pytest.raises(TypeError, match='Rotation objects only'):
        rot = Rotation(xp.asarray(Rotation.identity().as_quat()))
        Rotation.concatenate([rot, 1, None])


# Regression test for gh-16663
def test_len_and_bool(xp):
    rotation_multi_one = Rotation(xp.asarray([[0, 0, 0, 1]]))
    rotation_multi = Rotation(xp.asarray([[0, 0, 0, 1], [0, 0, 0, 1]]))
    rotation_single = Rotation(xp.asarray([0, 0, 0, 1]))

    assert len(rotation_multi_one) == 1
    assert len(rotation_multi) == 2
    with pytest.raises(TypeError, match="Single rotation has no len()."):
        len(rotation_single)

    # Rotation should always be truthy. See gh-16663
    assert rotation_multi_one
    assert rotation_multi
    assert rotation_single


def test_from_davenport_single_rotation(xp):
    axis = xp.asarray([0, 0, 1])
    quat = Rotation.from_davenport(axis, 'extrinsic', 90,
                                   degrees=True).as_quat()
    expected_quat = xp.asarray([0.0, 0, 1, 1]) / math.sqrt(2)
    xp_assert_close(quat, expected_quat)


def test_from_davenport_one_or_two_axes(xp):
    ez = xp.asarray([0.0, 0, 1])
    ey = xp.asarray([0.0, 1, 0])

    # Single rotation, single axis, axes.shape == (3, )
    rot = Rotation.from_rotvec(ez * xp.pi/4)
    rot_dav = Rotation.from_davenport(ez, 'e', xp.pi/4)
    xp_assert_close(rot.as_quat(canonical=True),
                    rot_dav.as_quat(canonical=True))

    # Single rotation, single axis, axes.shape == (1, 3)
    axes = xp.reshape(ez, (1, 3))  # Torch can't create tensors from xp.asarray([ez])
    rot = Rotation.from_rotvec(axes * xp.pi/4)
    rot_dav = Rotation.from_davenport(axes, 'e', [xp.pi/4])
    xp_assert_close(rot.as_quat(canonical=True),
                    rot_dav.as_quat(canonical=True))

    # Single rotation, two axes, axes.shape == (2, 3)
    axes = xp.stack([ez, ey], axis=0)
    rot = Rotation.from_rotvec(axes * xp.asarray([[xp.pi/4], [xp.pi/6]]))
    rot = rot[0] * rot[1]
    axes_dav = xp.stack([ey, ez], axis=0)
    rot_dav = Rotation.from_davenport(axes_dav, 'e', [xp.pi/6, xp.pi/4])
    xp_assert_close(rot.as_quat(canonical=True),
                    rot_dav.as_quat(canonical=True))

    # Two rotations, single axis, axes.shape == (3, )
    axes = xp.stack([ez, ez], axis=0)
    rot = Rotation.from_rotvec(axes * xp.asarray([[xp.pi/6], [xp.pi/4]]))
    axes_dav = xp.reshape(ez, (1, 3))
    rot_dav = Rotation.from_davenport(axes_dav, 'e', [xp.pi/6, xp.pi/4])
    xp_assert_close(rot.as_quat(canonical=True),
                    rot_dav.as_quat(canonical=True))


def test_from_davenport_invalid_input(xp):
    ez = [0, 0, 1]
    ey = [0, 1, 0]
    ezy = [0, 1, 1]
    # We can only raise in non-lazy frameworks.
    axes = xp.asarray([ez, ezy])
    if is_lazy_array(axes):
        q = Rotation.from_davenport(axes, 'e', [0, 0]).as_quat()
        assert xp.all(xp.isnan(q))
    else:
        with pytest.raises(ValueError, match="must be orthogonal"):
            Rotation.from_davenport(axes, 'e', [0, 0])
    axes = xp.asarray([ez, ey, ezy])
    if is_lazy_array(axes):
        q = Rotation.from_davenport(axes, 'e', [0, 0, 0]).as_quat()
        assert xp.all(xp.isnan(q))
    else:
        with pytest.raises(ValueError, match="must be orthogonal"):
            Rotation.from_davenport(axes, 'e', [0, 0, 0])
    with pytest.raises(ValueError, match="order should be"):
        Rotation.from_davenport(xp.asarray([ez]), 'xyz', [0])
    with pytest.raises(ValueError, match="Expected `angles`"):
        Rotation.from_davenport(xp.asarray([ez, ey, ez]), 'e', [0, 1, 2, 3])


def test_from_davenport_array_like():
    rng = np.random.default_rng(123)
    # Single rotation
    e1 = np.array([1, 0, 0])
    e2 = np.array([0, 1, 0])
    e3 = np.array([0, 0, 1])
    r_expected = Rotation.random(rng=rng)
    angles = r_expected.as_davenport([e1, e2, e3], 'e')
    r = Rotation.from_davenport([e1, e2, e3], 'e', angles.tolist())
    assert r_expected.approx_equal(r, atol=1e-12)

    # Multiple rotations
    r_expected = Rotation.random(2, rng=rng)
    angles = r_expected.as_davenport([e1, e2, e3], 'e')
    r = Rotation.from_davenport([e1, e2, e3], 'e', angles.tolist())
    assert np.all(r_expected.approx_equal(r, atol=1e-12))


def test_as_davenport(xp):
    rnd = np.random.RandomState(0)
    n = 100
    angles = np.empty((n, 3))
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles_middle = rnd.uniform(low=0, high=np.pi, size=(n,))
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    lambdas = rnd.uniform(low=0, high=np.pi, size=(20,))

    e1 = xp.asarray([1.0, 0, 0])
    e2 = xp.asarray([0.0, 1, 0])

    for lamb in lambdas:
        e3 = xp.asarray(Rotation.from_rotvec(lamb*e2).apply(e1))
        ax_lamb = xp.stack([e1, e2, e3], axis=0)
        angles[:, 1] = angles_middle - lamb
        for order in ['extrinsic', 'intrinsic']:
            ax = ax_lamb if order == "intrinsic" else xp.flip(ax_lamb, axis=0)
            rot = Rotation.from_davenport(xp.asarray(ax), order, angles)
            angles_dav = rot.as_davenport(xp.asarray(ax), order)
            xp_assert_close(angles_dav, xp.asarray(angles))


@pytest.mark.thread_unsafe
def test_as_davenport_degenerate(xp):
    # Since we cannot check for angle equality, we check for rotation matrix
    # equality
    rnd = np.random.RandomState(0)
    n = 5
    angles = np.empty((n, 3))

    # symmetric sequences
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles_middle = [rnd.choice([0, np.pi]) for i in range(n)]
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    lambdas = rnd.uniform(low=0, high=np.pi, size=(5,))

    e1 = xp.asarray([1.0, 0, 0])
    e2 = xp.asarray([0.0, 1, 0])

    for lamb in lambdas:
        e3 = xp.asarray(Rotation.from_rotvec(lamb*e2).apply(e1))
        ax_lamb = xp.stack([e1, e2, e3], axis=0)
        angles[:, 1] = angles_middle - lamb
        for order in ['extrinsic', 'intrinsic']:
            ax = ax_lamb if order == 'intrinsic' else ax_lamb[::-1]
            rot = Rotation.from_davenport(xp.asarray(ax), order, angles)
            with eager_warns(rot, UserWarning, match="Gimbal lock"):
                angles_dav = rot.as_davenport(xp.asarray(ax), order)
            mat_expected = rot.as_matrix()
            rot_estimated = Rotation.from_davenport(xp.asarray(ax), order, angles_dav)
            mat_estimated = rot_estimated.as_matrix()
            xp_assert_close(mat_expected, mat_estimated, atol=1e-12)


def test_compare_from_davenport_from_euler(xp):
    rnd = np.random.RandomState(0)
    n = 100
    angles = np.empty((n, 3))

    # symmetric sequences
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles[:, 1] = rnd.uniform(low=0, high=np.pi, size=(n,))
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    for order in ['extrinsic', 'intrinsic']:
        for seq_tuple in permutations('xyz'):
            seq = ''.join([seq_tuple[0], seq_tuple[1], seq_tuple[0]])
            ax = [basis_vec(i) for i in seq]
            if order == 'intrinsic':
                seq = seq.upper()
            eul = Rotation.from_euler(seq, xp.asarray(angles))
            dav = Rotation.from_davenport(xp.asarray(ax), order, xp.asarray(angles))
            xp_assert_close(eul.as_quat(canonical=True), dav.as_quat(canonical=True),
                            rtol=1e-12)

    # asymmetric sequences
    angles[:, 1] -= np.pi / 2
    for order in ['extrinsic', 'intrinsic']:
        for seq_tuple in permutations('xyz'):
            seq = ''.join(seq_tuple)
            ax = [basis_vec(i) for i in seq]
            if order == 'intrinsic':
                seq = seq.upper()
            eul = Rotation.from_euler(seq, xp.asarray(angles))
            dav = Rotation.from_davenport(xp.asarray(ax), order, xp.asarray(angles))
            xp_assert_close(eul.as_quat(), dav.as_quat(), rtol=1e-12)


def test_compare_as_davenport_as_euler(xp):
    rnd = np.random.RandomState(0)
    n = 100
    angles = np.empty((n, 3))

    # symmetric sequences
    angles[:, 0] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    angles[:, 1] = rnd.uniform(low=0, high=np.pi, size=(n,))
    angles[:, 2] = rnd.uniform(low=-np.pi, high=np.pi, size=(n,))
    for order in ['extrinsic', 'intrinsic']:
        for seq_tuple in permutations('xyz'):
            seq = ''.join([seq_tuple[0], seq_tuple[1], seq_tuple[0]])
            ax = [basis_vec(i) for i in seq]
            if order == 'intrinsic':
                seq = seq.upper()
            rot = Rotation.from_euler(seq, xp.asarray(angles))
            eul = rot.as_euler(seq)
            dav = rot.as_davenport(xp.asarray(ax), order)
            xp_assert_close(eul, dav, rtol=1e-12)

    # asymmetric sequences
    angles[:, 1] -= np.pi / 2
    for order in ['extrinsic', 'intrinsic']:
        for seq_tuple in permutations('xyz'):
            seq = ''.join(seq_tuple)
            ax = [basis_vec(i) for i in seq]
            if order == 'intrinsic':
                seq = seq.upper()
            rot = Rotation.from_euler(seq, xp.asarray(angles))
            eul = rot.as_euler(seq)
            dav = rot.as_davenport(xp.asarray(ax), order)
            xp_assert_close(eul, dav, rtol=1e-12)


def test_zero_rotation_construction(xp):
    r = Rotation.random(num=0)
    assert len(r) == 0

    r_ide = Rotation.identity(num=0)
    assert len(r_ide) == 0

    r_get = Rotation.random(num=3)[[]]
    assert len(r_get) == 0

    r_quat = Rotation.from_quat(xp.zeros((0, 4)))
    assert len(r_quat) == 0

    r_matrix = Rotation.from_matrix(xp.zeros((0, 3, 3)))
    assert len(r_matrix) == 0

    r_euler = Rotation.from_euler("xyz", xp.zeros((0, 3)))
    assert len(r_euler) == 0

    r_vec = Rotation.from_rotvec(xp.zeros((0, 3)))
    assert len(r_vec) == 0

    r_dav = Rotation.from_davenport(xp.eye(3), "extrinsic", xp.zeros((0, 3)))
    assert len(r_dav) == 0

    r_mrp = Rotation.from_mrp(xp.zeros((0, 3)))
    assert len(r_mrp) == 0


def test_zero_rotation_representation(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    assert r.as_quat().shape == (0, 4)
    assert r.as_matrix().shape == (0, 3, 3)
    assert r.as_euler("xyz").shape == (0, 3)
    assert r.as_rotvec().shape == (0, 3)
    assert r.as_mrp().shape == (0, 3)
    assert r.as_davenport(xp.eye(3), "extrinsic").shape == (0, 3)


def test_zero_rotation_array_rotation(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))

    v = xp.asarray([1, 2, 3])
    v_rotated = r.apply(v)
    assert v_rotated.shape == (0, 3)

    v0 = xp.zeros((0, 3))
    v0_rot = r.apply(v0)
    assert v0_rot.shape == (0, 3)

    v2 = xp.ones((2, 3))
    with pytest.raises(
        ValueError, match="Expected equal numbers of rotations and vectors"):
        r.apply(v2)


def test_zero_rotation_multiplication(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))

    r_single = Rotation.from_quat(xp.asarray([0.0, 0, 0, 1]))
    r_mult_left = r * r_single
    assert len(r_mult_left) == 0

    r_mult_right = r_single * r
    assert len(r_mult_right) == 0

    r0 = Rotation.from_quat(xp.zeros((0, 4)))
    r_mult = r * r0
    assert len(r_mult) == 0

    msg_rotation_error = "Expected equal number of rotations"
    r2 = Rotation.random(2)
    r2 = Rotation.from_quat(xp.asarray(r2.as_quat()))
    with pytest.raises(ValueError, match=msg_rotation_error):
        r0 * r2

    with pytest.raises(ValueError, match=msg_rotation_error):
        r2 * r0


def test_zero_rotation_concatentation(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))

    r0 = Rotation.concatenate([r, r])
    assert len(r0) == 0

    r1 = Rotation.from_quat(xp.asarray([0.0, 0, 0, 1]))
    r1 = r.concatenate([r1, r])
    assert len(r1) == 1

    r3 = Rotation.from_quat(xp.asarray(Rotation.random(3).as_quat()))
    r3 = r.concatenate([r3, r])
    assert len(r3) == 3

    r4 = Rotation.from_quat(xp.asarray(Rotation.random(4).as_quat()))
    r4 = r.concatenate([r, r4])
    r4 = r.concatenate([r, r4])
    assert len(r4) == 4


def test_zero_rotation_power(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    for pp in [-1.5, -1, 0, 1, 1.5]:
        pow0 = r**pp
        assert len(pow0) == 0


def test_zero_rotation_inverse(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    r_inv = r.inv()
    assert len(r_inv) == 0


def test_zero_rotation_magnitude(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    magnitude = r.magnitude()
    assert magnitude.shape == (0,)


def test_zero_rotation_mean(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    with pytest.raises(ValueError, match="Mean of an empty rotation set is undefined."):
        r.mean()


def test_zero_rotation_approx_equal(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))
    r0 = Rotation.from_quat(xp.zeros((0, 4)))
    assert r.approx_equal(r0).shape == (0,)
    r1 = Rotation.from_quat(xp.asarray([0.0, 0, 0, 1]))
    assert r.approx_equal(r1).shape == (0,)
    r2 = Rotation.from_quat(xp.asarray(Rotation.random().as_quat()))
    assert r2.approx_equal(r).shape == (0,)

    approx_msg = "Expected equal number of rotations"
    r3 = Rotation.from_quat(xp.asarray(Rotation.random(2).as_quat()))
    with pytest.raises(ValueError, match=approx_msg):
        r.approx_equal(r3)

    with pytest.raises(ValueError, match=approx_msg):
        r3.approx_equal(r)


def test_zero_rotation_get_set(xp):
    r = Rotation.from_quat(xp.zeros((0, 4)))

    r_get = r[xp.asarray([], dtype=xp.bool)]
    assert len(r_get) == 0

    r_slice = r[:0]
    assert len(r_slice) == 0

    with pytest.raises(IndexError):
        r[xp.asarray([0])]

    with pytest.raises(IndexError):
        r[xp.asarray([True])]

    with pytest.raises(IndexError):
        r[0] = Rotation.from_quat(xp.asarray([0, 0, 0, 1]))


def test_boolean_indexes(xp):
    r = Rotation.from_quat(xp.asarray(Rotation.random(3).as_quat()))

    r0 = r[xp.asarray([False, False, False])]
    assert len(r0) == 0

    r1 = r[xp.asarray([False, True, False])]
    assert len(r1) == 1

    r3 = r[xp.asarray([True, True, True])]
    assert len(r3) == 3

    with pytest.raises(IndexError):
        r[xp.asarray([True, True])]

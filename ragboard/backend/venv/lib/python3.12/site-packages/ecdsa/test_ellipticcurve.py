import pytest

try:
    import unittest2 as unittest
except ImportError:
    import unittest
from hypothesis import given, settings
import hypothesis.strategies as st

try:
    from hypothesis import HealthCheck

    HC_PRESENT = True
except ImportError:  # pragma: no cover
    HC_PRESENT = False
from .numbertheory import inverse_mod
from .ellipticcurve import CurveFp, INFINITY, Point, CurveEdTw


HYP_SETTINGS = {}
if HC_PRESENT:  # pragma: no branch
    HYP_SETTINGS["suppress_health_check"] = [HealthCheck.too_slow]
    HYP_SETTINGS["deadline"] = 5000


# NIST Curve P-192:
p = 6277101735386680763835789423207666416083908700390324961279
r = 6277101735386680763835789423176059013767194773182842284081
# s = 0x3045ae6fc8422f64ed579528d38120eae12196d5
# c = 0x3099d2bbbfcb2538542dcd5fb078b6ef5f3d6fe2c745de65
b = 0x64210519E59C80E70FA7E9AB72243049FEB8DEECC146B9B1
Gx = 0x188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012
Gy = 0x07192B95FFC8DA78631011ED6B24CDD573F977A11E794811

c192 = CurveFp(p, -3, b)
p192 = Point(c192, Gx, Gy, r)

c_23 = CurveFp(23, 1, 1)
g_23 = Point(c_23, 13, 7, 7)


HYP_SLOW_SETTINGS = dict(HYP_SETTINGS)
HYP_SLOW_SETTINGS["max_examples"] = 2


@settings(**HYP_SLOW_SETTINGS)
@given(st.integers(min_value=1, max_value=r - 1))
def test_p192_mult_tests(multiple):
    inv_m = inverse_mod(multiple, r)

    p1 = p192 * multiple
    assert p1 * inv_m == p192


def add_n_times(point, n):
    ret = INFINITY
    i = 0
    while i <= n:
        yield ret
        ret = ret + point
        i += 1


# From X9.62 I.1 (p. 96):
@pytest.mark.parametrize(
    "p, m, check",
    [(g_23, n, exp) for n, exp in enumerate(add_n_times(g_23, 8))],
    ids=["g_23 test with mult {0}".format(i) for i in range(9)],
)
def test_add_and_mult_equivalence(p, m, check):
    assert p * m == check


class TestCurve(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c_23 = CurveFp(23, 1, 1)

    def test_equality_curves(self):
        self.assertEqual(self.c_23, CurveFp(23, 1, 1))

    def test_inequality_curves(self):
        c192 = CurveFp(p, -3, b)
        self.assertNotEqual(self.c_23, c192)

    def test_inequality_curves_by_b_only(self):
        a = CurveFp(23, 1, 0)
        b = CurveFp(23, 1, 1)
        self.assertNotEqual(a, b)

    def test_usability_in_a_hashed_collection_curves(self):
        {self.c_23: None}

    def test_hashability_curves(self):
        hash(self.c_23)

    def test_conflation_curves(self):
        ne1, ne2, ne3 = CurveFp(24, 1, 1), CurveFp(23, 2, 1), CurveFp(23, 1, 2)
        eq1, eq2, eq3 = CurveFp(23, 1, 1), CurveFp(23, 1, 1), self.c_23
        self.assertEqual(len(set((c_23, eq1, eq2, eq3))), 1)
        self.assertEqual(len(set((c_23, ne1, ne2, ne3))), 4)
        self.assertDictEqual({c_23: None}, {eq1: None})
        self.assertIn(eq2, {eq3: None})

    def test___str__(self):
        self.assertEqual(str(self.c_23), "CurveFp(p=23, a=1, b=1)")

    def test___str___with_cofactor(self):
        c = CurveFp(23, 1, 1, 4)
        self.assertEqual(str(c), "CurveFp(p=23, a=1, b=1, h=4)")


class TestCurveEdTw(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c_23 = CurveEdTw(23, 1, 1)

    def test___str__(self):
        self.assertEqual(str(self.c_23), "CurveEdTw(p=23, a=1, d=1)")

    def test___str___with_cofactor(self):
        c = CurveEdTw(23, 1, 1, 4)
        self.assertEqual(str(c), "CurveEdTw(p=23, a=1, d=1, h=4)")

    def test_usability_in_a_hashed_collection_curves(self):
        {self.c_23: None}

    def test_hashability_curves(self):
        hash(self.c_23)


class TestPoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c_23 = CurveFp(23, 1, 1)
        cls.g_23 = Point(cls.c_23, 13, 7, 7)

        p = 6277101735386680763835789423207666416083908700390324961279
        r = 6277101735386680763835789423176059013767194773182842284081
        # s = 0x3045ae6fc8422f64ed579528d38120eae12196d5
        # c = 0x3099d2bbbfcb2538542dcd5fb078b6ef5f3d6fe2c745de65
        b = 0x64210519E59C80E70FA7E9AB72243049FEB8DEECC146B9B1
        Gx = 0x188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012
        Gy = 0x07192B95FFC8DA78631011ED6B24CDD573F977A11E794811

        cls.c192 = CurveFp(p, -3, b)
        cls.p192 = Point(cls.c192, Gx, Gy, r)

    def test_p192(self):
        # Checking against some sample computations presented
        # in X9.62:
        d = 651056770906015076056810763456358567190100156695615665659
        Q = d * self.p192
        self.assertEqual(
            Q.x(), 0x62B12D60690CDCF330BABAB6E69763B471F994DD702D16A5
        )

        k = 6140507067065001063065065565667405560006161556565665656654
        R = k * self.p192
        self.assertEqual(
            R.x(), 0x885052380FF147B734C330C43D39B2C4A89F29B0F749FEAD
        )
        self.assertEqual(
            R.y(), 0x9CF9FA1CBEFEFB917747A3BB29C072B9289C2547884FD835
        )

        u1 = 2563697409189434185194736134579731015366492496392189760599
        u2 = 6266643813348617967186477710235785849136406323338782220568
        temp = u1 * self.p192 + u2 * Q
        self.assertEqual(
            temp.x(), 0x885052380FF147B734C330C43D39B2C4A89F29B0F749FEAD
        )
        self.assertEqual(
            temp.y(), 0x9CF9FA1CBEFEFB917747A3BB29C072B9289C2547884FD835
        )

    def test_double_infinity(self):
        p1 = INFINITY
        p3 = p1.double()
        self.assertEqual(p1, p3)
        self.assertEqual(p3.x(), p1.x())
        self.assertEqual(p3.y(), p3.y())

    def test_double(self):
        x1, y1, x3, y3 = (3, 10, 7, 12)

        p1 = Point(self.c_23, x1, y1)
        p3 = p1.double()
        self.assertEqual(p3.x(), x3)
        self.assertEqual(p3.y(), y3)

    def test_double_to_infinity(self):
        p1 = Point(self.c_23, 11, 20)
        p2 = p1.double()
        self.assertEqual((p2.x(), p2.y()), (4, 0))
        self.assertNotEqual(p2, INFINITY)
        p3 = p2.double()
        self.assertEqual(p3, INFINITY)
        self.assertIs(p3, INFINITY)

    def test_add_self_to_infinity(self):
        p1 = Point(self.c_23, 11, 20)
        p2 = p1 + p1
        self.assertEqual((p2.x(), p2.y()), (4, 0))
        self.assertNotEqual(p2, INFINITY)
        p3 = p2 + p2
        self.assertEqual(p3, INFINITY)
        self.assertIs(p3, INFINITY)

    def test_mul_to_infinity(self):
        p1 = Point(self.c_23, 11, 20)
        p2 = p1 * 2
        self.assertEqual((p2.x(), p2.y()), (4, 0))
        self.assertNotEqual(p2, INFINITY)
        p3 = p2 * 2
        self.assertEqual(p3, INFINITY)
        self.assertIs(p3, INFINITY)

    def test_multiply(self):
        x1, y1, m, x3, y3 = (3, 10, 2, 7, 12)
        p1 = Point(self.c_23, x1, y1)
        p3 = p1 * m
        self.assertEqual(p3.x(), x3)
        self.assertEqual(p3.y(), y3)

    # Trivial tests from X9.62 B.3:
    def test_add(self):
        """We expect that on curve c, (x1,y1) + (x2, y2 ) = (x3, y3)."""

        x1, y1, x2, y2, x3, y3 = (3, 10, 9, 7, 17, 20)
        p1 = Point(self.c_23, x1, y1)
        p2 = Point(self.c_23, x2, y2)
        p3 = p1 + p2
        self.assertEqual(p3.x(), x3)
        self.assertEqual(p3.y(), y3)

    def test_add_as_double(self):
        """We expect that on curve c, (x1,y1) + (x2, y2 ) = (x3, y3)."""

        x1, y1, x2, y2, x3, y3 = (3, 10, 3, 10, 7, 12)
        p1 = Point(self.c_23, x1, y1)
        p2 = Point(self.c_23, x2, y2)
        p3 = p1 + p2
        self.assertEqual(p3.x(), x3)
        self.assertEqual(p3.y(), y3)

    def test_equality_points(self):
        self.assertEqual(self.g_23, Point(self.c_23, 13, 7, 7))

    def test_inequality_points(self):
        c = CurveFp(100, -3, 100)
        p = Point(c, 100, 100, 100)
        self.assertNotEqual(self.g_23, p)

    def test_inequality_points_diff_types(self):
        c = CurveFp(100, -3, 100)
        self.assertNotEqual(self.g_23, c)

    def test_inequality_diff_y(self):
        p1 = Point(self.c_23, 6, 4)
        p2 = Point(self.c_23, 6, 19)

        self.assertNotEqual(p1, p2)

    def test_to_bytes_from_bytes(self):
        p = Point(self.c_23, 3, 10)

        self.assertEqual(p, Point.from_bytes(self.c_23, p.to_bytes()))

    def test_add_to_neg_self(self):
        p = Point(self.c_23, 3, 10)

        self.assertEqual(INFINITY, p + (-p))

    def test_add_to_infinity(self):
        p = Point(self.c_23, 3, 10)

        self.assertIs(p, p + INFINITY)

    def test_mul_infinity_by_scalar(self):
        self.assertIs(INFINITY, INFINITY * 10)

    def test_mul_by_negative(self):
        p = Point(self.c_23, 3, 10)

        self.assertEqual(p * -5, (-p) * 5)

    def test_str_infinity(self):
        self.assertEqual(str(INFINITY), "infinity")

    def test_str_point(self):
        p = Point(self.c_23, 3, 10)

        self.assertEqual(str(p), "(3,10)")

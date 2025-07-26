import pytest

import scipy.constants as sc
from scipy._lib._array_api_no_0d import xp_assert_equal, xp_assert_close
from scipy._lib._array_api import make_xp_test_case

lazy_xp_modules = [sc]


@make_xp_test_case(sc.convert_temperature)
class TestConvertTemperature:
    def test_convert_temperature(self, xp):
        xp_assert_equal(sc.convert_temperature(xp.asarray(32.), 'f', 'Celsius'),
                        xp.asarray(0.0))
        xp_assert_equal(sc.convert_temperature(xp.asarray([0., 0.]),
                                               'celsius', 'Kelvin'),
                        xp.asarray([273.15, 273.15]))
        xp_assert_equal(sc.convert_temperature(xp.asarray([0., 0.]), 'kelvin', 'c'),
                        xp.asarray([-273.15, -273.15]))
        xp_assert_equal(sc.convert_temperature(xp.asarray([32., 32.]), 'f', 'k'),
                        xp.asarray([273.15, 273.15]))
        xp_assert_equal(sc.convert_temperature(xp.asarray([273.15, 273.15]),
                                               'kelvin', 'F'),
                        xp.asarray([32., 32.]))
        xp_assert_equal(sc.convert_temperature(xp.asarray([0., 0.]), 'C', 'fahrenheit'),
                        xp.asarray([32., 32.]))
        xp_assert_close(sc.convert_temperature(xp.asarray([0., 0.], dtype=xp.float64),
                                               'c', 'r'),
                        xp.asarray([491.67, 491.67], dtype=xp.float64),
                        rtol=0., atol=1e-13)
        xp_assert_close(sc.convert_temperature(xp.asarray([491.67, 491.67],
                                                        dtype=xp.float64),
                                               'Rankine', 'C'),
                        xp.asarray([0., 0.], dtype=xp.float64), rtol=0., atol=1e-13)
        xp_assert_close(sc.convert_temperature(xp.asarray([491.67, 491.67],
                                                        dtype=xp.float64),
                                               'r', 'F'),
                        xp.asarray([32., 32.], dtype=xp.float64), rtol=0., atol=1e-13)
        xp_assert_close(sc.convert_temperature(xp.asarray([32., 32.], dtype=xp.float64),
                                               'fahrenheit', 'R'),
                        xp.asarray([491.67, 491.67], dtype=xp.float64),
                        rtol=0., atol=1e-13)
        xp_assert_close(sc.convert_temperature(xp.asarray([273.15, 273.15],
                                                        dtype=xp.float64),
                                               'K', 'R'),
                        xp.asarray([491.67, 491.67], dtype=xp.float64),
                        rtol=0., atol=1e-13)
        xp_assert_close(sc.convert_temperature(xp.asarray([491.67, 0.],
                                                          dtype=xp.float64),
                                               'rankine', 'kelvin'),
                        xp.asarray([273.15, 0.], dtype=xp.float64), rtol=0., atol=1e-13)

    def test_convert_temperature_array_like(self):
        xp_assert_close(sc.convert_temperature([491.67, 0.], 'rankine', 'kelvin'),
                        [273.15, 0.], rtol=0., atol=1e-13)


    def test_convert_temperature_errors(self):
        with pytest.raises(NotImplementedError, match="old_scale="):
            sc.convert_temperature(1, old_scale="cheddar", new_scale="kelvin")
        with pytest.raises(NotImplementedError, match="new_scale="):
            sc.convert_temperature(1, old_scale="kelvin", new_scale="brie")


@make_xp_test_case(sc.lambda2nu)
class TestLambdaToNu:
    def test_lambda_to_nu(self, xp):
        xp_assert_equal(sc.lambda2nu(xp.asarray([sc.speed_of_light, 1])),
                        xp.asarray([1, sc.speed_of_light]))


    def test_lambda_to_nu_array_like(self):
        xp_assert_close(sc.lambda2nu([sc.speed_of_light, 1]), [1, sc.speed_of_light])


@make_xp_test_case(sc.nu2lambda)
class TestNuToLambda:
    def test_nu_to_lambda(self, xp):
        xp_assert_equal(sc.nu2lambda(xp.asarray([sc.speed_of_light, 1])),
                        xp.asarray([1, sc.speed_of_light]))

    def test_nu_to_lambda_array_like(self):
        xp_assert_close(sc.nu2lambda([sc.speed_of_light, 1]), [1, sc.speed_of_light])

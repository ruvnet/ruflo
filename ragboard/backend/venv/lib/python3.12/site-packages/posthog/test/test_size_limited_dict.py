import unittest

from parameterized import parameterized

from posthog import utils


class TestSizeLimitedDict(unittest.TestCase):
    @parameterized.expand([(10, 100), (5, 20), (20, 200)])
    def test_size_limited_dict(self, size: int, iterations: int) -> None:
        values = utils.SizeLimitedDict(size, lambda _: -1)

        for i in range(iterations):
            values[i] = i

            assert values[i] == i
            assert len(values) == i % size + 1

            if i % size == 0:
                # old numbers should've been removed
                self.assertIsNone(values.get(i - 1))
                self.assertIsNone(values.get(i - 3))
                self.assertIsNone(values.get(i - 5))
                self.assertIsNone(values.get(i - 9))

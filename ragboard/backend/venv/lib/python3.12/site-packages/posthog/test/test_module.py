import unittest

from posthog import Posthog


class TestModule(unittest.TestCase):
    posthog = None

    def _assert_enqueue_result(self, result):
        self.assertEqual(type(result[0]), bool)
        self.assertEqual(type(result[1]), dict)

    def failed(self):
        self.failed = True

    def setUp(self):
        self.failed = False
        self.posthog = Posthog(
            "testsecret", host="http://localhost:8000", on_error=self.failed
        )

    def test_no_api_key(self):
        self.posthog.api_key = None
        self.assertRaises(Exception, self.posthog.capture)

    def test_no_host(self):
        self.posthog.host = None
        self.assertRaises(Exception, self.posthog.capture)

    def test_track(self):
        res = self.posthog.capture("distinct_id", "python module event")
        self._assert_enqueue_result(res)
        self.posthog.flush()

    def test_identify(self):
        res = self.posthog.identify("distinct_id", {"email": "user@email.com"})
        self._assert_enqueue_result(res)
        self.posthog.flush()

    def test_alias(self):
        res = self.posthog.alias("previousId", "distinct_id")
        self._assert_enqueue_result(res)
        self.posthog.flush()

    def test_page(self):
        self.posthog.page("distinct_id", "https://posthog.com/contact")
        self.posthog.flush()

    def test_flush(self):
        self.posthog.flush()

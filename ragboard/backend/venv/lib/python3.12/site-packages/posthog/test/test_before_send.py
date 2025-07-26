import unittest

import mock

from posthog.client import Client
from posthog.test.test_utils import FAKE_TEST_API_KEY


class TestClient(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # This ensures no real HTTP POST requests are made
        cls.client_post_patcher = mock.patch("posthog.client.batch_post")
        cls.consumer_post_patcher = mock.patch("posthog.consumer.batch_post")
        cls.client_post_patcher.start()
        cls.consumer_post_patcher.start()

    @classmethod
    def tearDownClass(cls):
        cls.client_post_patcher.stop()
        cls.consumer_post_patcher.stop()

    def set_fail(self, e, batch):
        """Mark the failure handler"""
        print("FAIL", e, batch)  # noqa: T201
        self.failed = True

    def setUp(self):
        self.failed = False
        self.client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail)

    def test_before_send_callback_modifies_event(self):
        """Test that before_send callback can modify events."""
        processed_events = []

        def my_before_send(event):
            processed_events.append(event.copy())
            if "properties" not in event:
                event["properties"] = {}
            event["properties"]["processed_by_before_send"] = True
            return event

        client = Client(
            FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=my_before_send
        )
        success, msg = client.capture("user1", "test_event", {"original": "value"})

        self.assertTrue(success)
        self.assertEqual(msg["properties"]["processed_by_before_send"], True)
        self.assertEqual(msg["properties"]["original"], "value")
        self.assertEqual(len(processed_events), 1)
        self.assertEqual(processed_events[0]["event"], "test_event")

    def test_before_send_callback_drops_event(self):
        """Test that before_send callback can drop events by returning None."""

        def drop_test_events(event):
            if event.get("event") == "test_drop_me":
                return None
            return event

        client = Client(
            FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=drop_test_events
        )

        # Event should be dropped
        success, msg = client.capture("user1", "test_drop_me")
        self.assertTrue(success)
        self.assertIsNone(msg)

        # Event should go through
        success, msg = client.capture("user1", "keep_me")
        self.assertTrue(success)
        self.assertIsNotNone(msg)
        self.assertEqual(msg["event"], "keep_me")

    def test_before_send_callback_handles_exceptions(self):
        """Test that exceptions in before_send don't crash the client."""

        def buggy_before_send(event):
            raise ValueError("Oops!")

        client = Client(
            FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=buggy_before_send
        )
        success, msg = client.capture("user1", "robust_event")

        # Event should still be sent despite the exception
        self.assertTrue(success)
        self.assertIsNotNone(msg)
        self.assertEqual(msg["event"], "robust_event")

    def test_before_send_callback_works_with_all_event_types(self):
        """Test that before_send works with capture, identify, set, etc."""

        def add_marker(event):
            if "properties" not in event:
                event["properties"] = {}
            event["properties"]["marked"] = True
            return event

        client = Client(
            FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=add_marker
        )

        # Test capture
        success, msg = client.capture("user1", "event")
        self.assertTrue(success)
        self.assertTrue(msg["properties"]["marked"])

        # Test identify
        success, msg = client.identify("user1", {"trait": "value"})
        self.assertTrue(success)
        self.assertTrue(msg["properties"]["marked"])

        # Test set
        success, msg = client.set("user1", {"prop": "value"})
        self.assertTrue(success)
        self.assertTrue(msg["properties"]["marked"])

        # Test page
        success, msg = client.page("user1", "https://example.com")
        self.assertTrue(success)
        self.assertTrue(msg["properties"]["marked"])

    def test_before_send_callback_disabled_when_none(self):
        """Test that client works normally when before_send is None."""
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=None)
        success, msg = client.capture("user1", "normal_event")

        self.assertTrue(success)
        self.assertIsNotNone(msg)
        self.assertEqual(msg["event"], "normal_event")

    def test_before_send_callback_pii_scrubbing_example(self):
        """Test a realistic PII scrubbing use case."""

        def scrub_pii(event):
            properties = event.get("properties", {})

            # Mask email but keep domain
            if "email" in properties:
                email = properties["email"]
                if "@" in email:
                    domain = email.split("@")[1]
                    properties["email"] = f"***@{domain}"
                else:
                    properties["email"] = "***"

            # Remove credit card
            properties.pop("credit_card", None)

            return event

        client = Client(
            FAKE_TEST_API_KEY, on_error=self.set_fail, before_send=scrub_pii
        )
        success, msg = client.capture(
            "user1",
            "form_submit",
            {
                "email": "user@example.com",
                "credit_card": "1234-5678-9012-3456",
                "form_name": "contact",
            },
        )

        self.assertTrue(success)
        self.assertEqual(msg["properties"]["email"], "***@example.com")
        self.assertNotIn("credit_card", msg["properties"])
        self.assertEqual(msg["properties"]["form_name"], "contact")

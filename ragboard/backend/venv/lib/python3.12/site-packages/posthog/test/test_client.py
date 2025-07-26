import time
import unittest
from datetime import datetime
from uuid import uuid4
from posthog.scopes import get_context_session_id, set_context_session, new_context

import mock
import six
from parameterized import parameterized

from posthog.client import Client
from posthog.request import APIError
from posthog.test.test_utils import FAKE_TEST_API_KEY
from posthog.types import FeatureFlag, LegacyFlagMetadata
from posthog.version import VERSION


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

    def test_requires_api_key(self):
        self.assertRaises(AssertionError, Client)

    def test_empty_flush(self):
        self.client.flush()

    def test_basic_capture(self):
        client = self.client
        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        # these will change between platforms so just asssert on presence here
        assert msg["properties"]["$python_runtime"] == mock.ANY
        assert msg["properties"]["$python_version"] == mock.ANY
        assert msg["properties"]["$os"] == mock.ANY
        assert msg["properties"]["$os_version"] == mock.ANY

    def test_basic_capture_with_uuid(self):
        client = self.client
        uuid = str(uuid4())
        success, msg = client.capture("distinct_id", "python test event", uuid=uuid)
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertEqual(msg["uuid"], uuid)
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)

    def test_basic_capture_with_project_api_key(self):
        client = Client(project_api_key=FAKE_TEST_API_KEY, on_error=self.set_fail)

        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)

    def test_basic_super_properties(self):
        client = Client(FAKE_TEST_API_KEY, super_properties={"source": "repo-name"})

        _, msg = client.capture("distinct_id", "python test event")
        client.flush()

        self.assertEqual(msg["event"], "python test event")
        self.assertEqual(msg["properties"]["source"], "repo-name")

        _, msg = client.identify("distinct_id", {"trait": "value"})
        client.flush()

        self.assertEqual(msg["$set"]["trait"], "value")
        self.assertEqual(msg["properties"]["source"], "repo-name")

    def test_basic_capture_exception(self):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            client = self.client
            exception = Exception("test exception")
            client.capture_exception(exception, distinct_id="distinct_id")

            self.assertTrue(patch_capture.called)
            capture_call = patch_capture.call_args[0]
            self.assertEqual(capture_call[0], "distinct_id")
            self.assertEqual(capture_call[1], "$exception")

    def test_basic_capture_exception_with_distinct_id(self):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            client = self.client
            exception = Exception("test exception")
            client.capture_exception(exception, "distinct_id")

            self.assertTrue(patch_capture.called)
            capture_call = patch_capture.call_args[0]
            self.assertEqual(capture_call[0], "distinct_id")
            self.assertEqual(capture_call[1], "$exception")

    def test_basic_capture_exception_with_correct_host_generation(self):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            client = Client(
                FAKE_TEST_API_KEY, on_error=self.set_fail, host="https://aloha.com"
            )
            exception = Exception("test exception")
            client.capture_exception(exception, "distinct_id")

            self.assertTrue(patch_capture.called)
            capture_call = patch_capture.call_args[0]
            self.assertEqual(capture_call[0], "distinct_id")
            self.assertEqual(capture_call[1], "$exception")

    def test_basic_capture_exception_with_correct_host_generation_for_server_hosts(
        self,
    ):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            client = Client(
                FAKE_TEST_API_KEY,
                on_error=self.set_fail,
                host="https://app.posthog.com",
            )
            exception = Exception("test exception")
            client.capture_exception(exception, "distinct_id")

            self.assertTrue(patch_capture.called)
            capture_call = patch_capture.call_args[0]
            self.assertEqual(capture_call[0], "distinct_id")
            self.assertEqual(capture_call[1], "$exception")

    def test_basic_capture_exception_with_no_exception_given(self):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            client = self.client
            try:
                raise Exception("test exception")
            except Exception:
                client.capture_exception(distinct_id="distinct_id")

            self.assertTrue(patch_capture.called)
            capture_call = patch_capture.call_args[0]
            self.assertEqual(capture_call[0], "distinct_id")
            self.assertEqual(capture_call[1], "$exception")
            self.assertEqual(capture_call[2]["$exception_type"], "Exception")
            self.assertEqual(capture_call[2]["$exception_message"], "test exception")
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["mechanism"]["type"], "generic"
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["mechanism"]["handled"], True
            )
            self.assertEqual(capture_call[2]["$exception_list"][0]["module"], None)
            self.assertEqual(capture_call[2]["$exception_list"][0]["type"], "Exception")
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["value"], "test exception"
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["stacktrace"]["type"],
                "raw",
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["stacktrace"]["frames"][0][
                    "filename"
                ],
                "posthog/test/test_client.py",
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["stacktrace"]["frames"][0][
                    "function"
                ],
                "test_basic_capture_exception_with_no_exception_given",
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["stacktrace"]["frames"][0][
                    "module"
                ],
                "posthog.test.test_client",
            )
            self.assertEqual(
                capture_call[2]["$exception_list"][0]["stacktrace"]["frames"][0][
                    "in_app"
                ],
                True,
            )

    def test_basic_capture_exception_with_no_exception_happening(self):
        with mock.patch.object(Client, "capture", return_value=None) as patch_capture:
            with self.assertLogs("posthog", level="WARNING") as logs:
                client = self.client
                client.capture_exception()

                self.assertFalse(patch_capture.called)
                self.assertEqual(
                    logs.output[0],
                    "WARNING:posthog:No exception information available",
                )

    def test_capture_exception_logs_when_enabled(self):
        client = Client(FAKE_TEST_API_KEY, log_captured_exceptions=True)
        with self.assertLogs("posthog", level="ERROR") as logs:
            client.capture_exception(
                Exception("test exception"), "distinct_id", path="one/two/three"
            )
            self.assertEqual(
                logs.output[0], "ERROR:posthog:test exception\nNoneType: None"
            )
            self.assertEqual(getattr(logs.records[0], "path"), "one/two/three")

    @mock.patch("posthog.client.flags")
    def test_basic_capture_with_feature_flags(self, patch_flags):
        patch_flags.return_value = {"featureFlags": {"beta-feature": "random-variant"}}

        client = Client(
            FAKE_TEST_API_KEY,
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
        )
        success, msg = client.capture(
            "distinct_id", "python test event", send_feature_flags=True
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(msg["properties"]["$feature/beta-feature"], "random-variant")
        self.assertEqual(msg["properties"]["$active_feature_flags"], ["beta-feature"])

        self.assertEqual(patch_flags.call_count, 1)

    @mock.patch("posthog.client.flags")
    def test_basic_capture_with_locally_evaluated_feature_flags(self, patch_flags):
        patch_flags.return_value = {"featureFlags": {"beta-feature": "random-variant"}}
        client = Client(
            FAKE_TEST_API_KEY,
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
        )

        multivariate_flag = {
            "id": 1,
            "name": "Beta Feature",
            "key": "beta-feature-local",
            "active": True,
            "rollout_percentage": 100,
            "filters": {
                "groups": [
                    {
                        "properties": [
                            {
                                "key": "email",
                                "type": "person",
                                "value": "test@posthog.com",
                                "operator": "exact",
                            }
                        ],
                        "rollout_percentage": 100,
                    },
                    {
                        "rollout_percentage": 50,
                    },
                ],
                "multivariate": {
                    "variants": [
                        {
                            "key": "first-variant",
                            "name": "First Variant",
                            "rollout_percentage": 50,
                        },
                        {
                            "key": "second-variant",
                            "name": "Second Variant",
                            "rollout_percentage": 25,
                        },
                        {
                            "key": "third-variant",
                            "name": "Third Variant",
                            "rollout_percentage": 25,
                        },
                    ]
                },
                "payloads": {
                    "first-variant": "some-payload",
                    "third-variant": {"a": "json"},
                },
            },
        }
        basic_flag = {
            "id": 1,
            "name": "Beta Feature",
            "key": "person-flag",
            "active": True,
            "filters": {
                "groups": [
                    {
                        "properties": [
                            {
                                "key": "region",
                                "operator": "exact",
                                "value": ["USA"],
                                "type": "person",
                            }
                        ],
                        "rollout_percentage": 100,
                    }
                ],
                "payloads": {"true": 300},
            },
        }
        false_flag = {
            "id": 1,
            "name": "Beta Feature",
            "key": "false-flag",
            "active": True,
            "filters": {
                "groups": [
                    {
                        "properties": [],
                        "rollout_percentage": 0,
                    }
                ],
                "payloads": {"true": 300},
            },
        }
        client.feature_flags = [multivariate_flag, basic_flag, false_flag]

        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(
            msg["properties"]["$feature/beta-feature-local"], "third-variant"
        )
        self.assertEqual(msg["properties"]["$feature/false-flag"], False)
        self.assertEqual(
            msg["properties"]["$active_feature_flags"], ["beta-feature-local"]
        )
        assert "$feature/beta-feature" not in msg["properties"]

        self.assertEqual(patch_flags.call_count, 0)

        # test that flags are not evaluated without local evaluation
        client.feature_flags = []
        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)
        assert "$feature/beta-feature" not in msg["properties"]
        assert "$feature/beta-feature-local" not in msg["properties"]
        assert "$feature/false-flag" not in msg["properties"]
        assert "$active_feature_flags" not in msg["properties"]

    @mock.patch("posthog.client.get")
    def test_load_feature_flags_quota_limited(self, patch_get):
        mock_response = {
            "type": "quota_limited",
            "detail": "You have exceeded your feature flag request quota",
            "code": "payment_required",
        }
        patch_get.side_effect = APIError(402, mock_response["detail"])

        client = Client(FAKE_TEST_API_KEY, personal_api_key="test")
        with self.assertLogs("posthog", level="WARNING") as logs:
            client._load_feature_flags()

            self.assertEqual(client.feature_flags, [])
            self.assertEqual(client.feature_flags_by_key, {})
            self.assertEqual(client.group_type_mapping, {})
            self.assertEqual(client.cohorts, {})
            self.assertIn("PostHog feature flags quota limited", logs.output[0])

    @mock.patch("posthog.client.flags")
    def test_dont_override_capture_with_local_flags(self, patch_flags):
        patch_flags.return_value = {"featureFlags": {"beta-feature": "random-variant"}}
        client = Client(
            FAKE_TEST_API_KEY,
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
        )

        multivariate_flag = {
            "id": 1,
            "name": "Beta Feature",
            "key": "beta-feature-local",
            "active": True,
            "rollout_percentage": 100,
            "filters": {
                "groups": [
                    {
                        "properties": [
                            {
                                "key": "email",
                                "type": "person",
                                "value": "test@posthog.com",
                                "operator": "exact",
                            }
                        ],
                        "rollout_percentage": 100,
                    },
                    {
                        "rollout_percentage": 50,
                    },
                ],
                "multivariate": {
                    "variants": [
                        {
                            "key": "first-variant",
                            "name": "First Variant",
                            "rollout_percentage": 50,
                        },
                        {
                            "key": "second-variant",
                            "name": "Second Variant",
                            "rollout_percentage": 25,
                        },
                        {
                            "key": "third-variant",
                            "name": "Third Variant",
                            "rollout_percentage": 25,
                        },
                    ]
                },
                "payloads": {
                    "first-variant": "some-payload",
                    "third-variant": {"a": "json"},
                },
            },
        }
        basic_flag = {
            "id": 1,
            "name": "Beta Feature",
            "key": "person-flag",
            "active": True,
            "filters": {
                "groups": [
                    {
                        "properties": [
                            {
                                "key": "region",
                                "operator": "exact",
                                "value": ["USA"],
                                "type": "person",
                            }
                        ],
                        "rollout_percentage": 100,
                    }
                ],
                "payloads": {"true": 300},
            },
        }
        client.feature_flags = [multivariate_flag, basic_flag]

        success, msg = client.capture(
            "distinct_id",
            "python test event",
            {"$feature/beta-feature-local": "my-custom-variant"},
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(
            msg["properties"]["$feature/beta-feature-local"], "my-custom-variant"
        )
        self.assertEqual(
            msg["properties"]["$active_feature_flags"], ["beta-feature-local"]
        )
        assert "$feature/beta-feature" not in msg["properties"]
        assert "$feature/person-flag" not in msg["properties"]

        self.assertEqual(patch_flags.call_count, 0)

    @mock.patch("posthog.client.flags")
    def test_basic_capture_with_feature_flags_returns_active_only(self, patch_flags):
        patch_flags.return_value = {
            "featureFlags": {
                "beta-feature": "random-variant",
                "alpha-feature": True,
                "off-feature": False,
            }
        }

        client = Client(
            FAKE_TEST_API_KEY,
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
        )
        success, msg = client.capture(
            "distinct_id", "python test event", send_feature_flags=True
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertTrue(msg["properties"]["$geoip_disable"])
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(msg["properties"]["$feature/beta-feature"], "random-variant")
        self.assertEqual(msg["properties"]["$feature/alpha-feature"], True)
        self.assertEqual(
            msg["properties"]["$active_feature_flags"],
            ["beta-feature", "alpha-feature"],
        )

        self.assertEqual(patch_flags.call_count, 1)
        patch_flags.assert_called_with(
            "random_key",
            "https://us.i.posthog.com",
            timeout=3,
            distinct_id="distinct_id",
            groups={},
            person_properties=None,
            group_properties=None,
            geoip_disable=True,
        )

    @mock.patch("posthog.client.flags")
    def test_basic_capture_with_feature_flags_and_disable_geoip_returns_correctly(
        self, patch_flags
    ):
        patch_flags.return_value = {
            "featureFlags": {
                "beta-feature": "random-variant",
                "alpha-feature": True,
                "off-feature": False,
            }
        }

        client = Client(
            FAKE_TEST_API_KEY,
            host="https://app.posthog.com",
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
            disable_geoip=True,
            feature_flags_request_timeout_seconds=12,
        )
        success, msg = client.capture(
            "distinct_id",
            "python test event",
            send_feature_flags=True,
            disable_geoip=False,
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertTrue("$geoip_disable" not in msg["properties"])
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(msg["properties"]["$feature/beta-feature"], "random-variant")
        self.assertEqual(msg["properties"]["$feature/alpha-feature"], True)
        self.assertEqual(
            msg["properties"]["$active_feature_flags"],
            ["beta-feature", "alpha-feature"],
        )

        self.assertEqual(patch_flags.call_count, 1)
        patch_flags.assert_called_with(
            "random_key",
            "https://us.i.posthog.com",
            timeout=12,
            distinct_id="distinct_id",
            groups={},
            person_properties=None,
            group_properties=None,
            geoip_disable=False,
        )

    @mock.patch("posthog.client.flags")
    def test_basic_capture_with_feature_flags_switched_off_doesnt_send_them(
        self, patch_flags
    ):
        patch_flags.return_value = {"featureFlags": {"beta-feature": "random-variant"}}

        client = Client(
            FAKE_TEST_API_KEY,
            on_error=self.set_fail,
            personal_api_key=FAKE_TEST_API_KEY,
        )
        success, msg = client.capture(
            "distinct_id", "python test event", send_feature_flags=False
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["event"], "python test event")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertTrue("$feature/beta-feature" not in msg["properties"])
        self.assertTrue("$active_feature_flags" not in msg["properties"])

        self.assertEqual(patch_flags.call_count, 0)

    def test_stringifies_distinct_id(self):
        # A large number that loses precision in node:
        # node -e "console.log(157963456373623802 + 1)" > 157963456373623800
        client = self.client
        success, msg = client.capture(
            distinct_id=157963456373623802, event="python test event"
        )
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["distinct_id"], "157963456373623802")

    def test_advanced_capture(self):
        client = self.client
        success, msg = client.capture(
            "distinct_id",
            "python test event",
            {"property": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)

        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")
        self.assertEqual(msg["properties"]["property"], "value")
        self.assertEqual(msg["event"], "python test event")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertEqual(msg["uuid"], "new-uuid")
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertTrue("$groups" not in msg["properties"])

    def test_groups_capture(self):
        success, msg = self.client.capture(
            "distinct_id",
            "test_event",
            groups={"company": "id:5", "instance": "app.posthog.com"},
        )

        self.assertTrue(success)
        self.assertEqual(
            msg["properties"]["$groups"],
            {"company": "id:5", "instance": "app.posthog.com"},
        )

    def test_basic_identify(self):
        client = self.client
        success, msg = client.identify("distinct_id", {"trait": "value"})
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["$set"]["trait"], "value")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_advanced_identify(self):
        client = self.client
        success, msg = client.identify(
            "distinct_id",
            {"trait": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)

        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")
        self.assertEqual(msg["$set"]["trait"], "value")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertEqual(msg["uuid"], "new-uuid")
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_basic_set(self):
        client = self.client
        success, msg = client.set("distinct_id", {"trait": "value"})
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["$set"]["trait"], "value")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_advanced_set(self):
        client = self.client
        success, msg = client.set(
            "distinct_id",
            {"trait": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)

        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")
        self.assertEqual(msg["$set"]["trait"], "value")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertEqual(msg["uuid"], "new-uuid")
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_basic_set_once(self):
        client = self.client
        success, msg = client.set_once("distinct_id", {"trait": "value"})
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg["$set_once"]["trait"], "value")
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_advanced_set_once(self):
        client = self.client
        success, msg = client.set_once(
            "distinct_id",
            {"trait": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)

        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")
        self.assertEqual(msg["$set_once"]["trait"], "value")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertEqual(msg["uuid"], "new-uuid")
        self.assertEqual(msg["distinct_id"], "distinct_id")

    def test_basic_group_identify(self):
        success, msg = self.client.group_identify("organization", "id:5")

        self.assertTrue(success)
        self.assertEqual(msg["event"], "$groupidentify")
        self.assertEqual(msg["distinct_id"], "$organization_id:5")
        self.assertEqual(
            msg["properties"],
            {
                "$group_type": "organization",
                "$group_key": "id:5",
                "$group_set": {},
                "$lib": "posthog-python",
                "$lib_version": VERSION,
                "$geoip_disable": True,
            },
        )
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))

    def test_basic_group_identify_with_distinct_id(self):
        success, msg = self.client.group_identify(
            "organization", "id:5", distinct_id="distinct_id"
        )
        self.assertTrue(success)
        self.assertEqual(msg["event"], "$groupidentify")
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(
            msg["properties"],
            {
                "$group_type": "organization",
                "$group_key": "id:5",
                "$group_set": {},
                "$lib": "posthog-python",
                "$lib_version": VERSION,
                "$geoip_disable": True,
            },
        )
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertIsNone(msg.get("uuid"))

    def test_advanced_group_identify(self):
        success, msg = self.client.group_identify(
            "organization",
            "id:5",
            {"trait": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)
        self.assertEqual(msg["event"], "$groupidentify")
        self.assertEqual(msg["distinct_id"], "$organization_id:5")
        self.assertEqual(
            msg["properties"],
            {
                "$group_type": "organization",
                "$group_key": "id:5",
                "$group_set": {"trait": "value"},
                "$lib": "posthog-python",
                "$lib_version": VERSION,
                "$geoip_disable": True,
            },
        )
        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")

    def test_advanced_group_identify_with_distinct_id(self):
        success, msg = self.client.group_identify(
            "organization",
            "id:5",
            {"trait": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
            distinct_id="distinct_id",
        )

        self.assertTrue(success)
        self.assertEqual(msg["event"], "$groupidentify")
        self.assertEqual(msg["distinct_id"], "distinct_id")

        self.assertEqual(
            msg["properties"],
            {
                "$group_type": "organization",
                "$group_key": "id:5",
                "$group_set": {"trait": "value"},
                "$lib": "posthog-python",
                "$lib_version": VERSION,
                "$geoip_disable": True,
            },
        )
        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")

    def test_basic_alias(self):
        client = self.client
        success, msg = client.alias("previousId", "distinct_id")
        client.flush()
        self.assertTrue(success)
        self.assertFalse(self.failed)
        self.assertEqual(msg["properties"]["distinct_id"], "previousId")
        self.assertEqual(msg["properties"]["alias"], "distinct_id")

    def test_basic_page(self):
        client = self.client
        success, msg = client.page("distinct_id", url="https://posthog.com/contact")
        self.assertFalse(self.failed)
        client.flush()
        self.assertTrue(success)
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(
            msg["properties"]["$current_url"], "https://posthog.com/contact"
        )

    def test_basic_page_distinct_uuid(self):
        client = self.client
        distinct_id = uuid4()
        success, msg = client.page(distinct_id, url="https://posthog.com/contact")
        self.assertFalse(self.failed)
        client.flush()
        self.assertTrue(success)
        self.assertEqual(msg["distinct_id"], str(distinct_id))
        self.assertEqual(
            msg["properties"]["$current_url"], "https://posthog.com/contact"
        )

    def test_advanced_page(self):
        client = self.client
        success, msg = client.page(
            "distinct_id",
            "https://posthog.com/contact",
            {"property": "value"},
            timestamp=datetime(2014, 9, 3),
            uuid="new-uuid",
        )

        self.assertTrue(success)

        self.assertEqual(msg["timestamp"], "2014-09-03T00:00:00+00:00")
        self.assertEqual(
            msg["properties"]["$current_url"], "https://posthog.com/contact"
        )
        self.assertEqual(msg["properties"]["property"], "value")
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)
        self.assertTrue(isinstance(msg["timestamp"], str))
        self.assertEqual(msg["uuid"], "new-uuid")
        self.assertEqual(msg["distinct_id"], "distinct_id")

    @parameterized.expand(
        [
            # test_name, session_id, additional_properties, expected_properties
            ("basic_session_id", "test-session-123", {}, {}),
            (
                "session_id_with_other_properties",
                "test-session-456",
                {
                    "custom_prop": "custom_value",
                    "$process_person_profile": False,
                    "$current_url": "https://example.com",
                },
                {
                    "custom_prop": "custom_value",
                    "$process_person_profile": False,
                    "$current_url": "https://example.com",
                },
            ),
            ("session_id_uuid_format", str(uuid4()), {}, {}),
            ("session_id_numeric_string", "1234567890", {}, {}),
            ("session_id_empty_string", "", {}, {}),
            ("session_id_with_special_chars", "session-123_test.id", {}, {}),
        ]
    )
    def test_capture_with_session_id_variations(
        self, test_name, session_id, additional_properties, expected_properties
    ):
        client = self.client

        properties = {"$session_id": session_id, **additional_properties}
        success, msg = client.capture(
            "distinct_id", "python test event", properties=properties
        )
        client.flush()

        self.assertTrue(success)
        self.assertFalse(self.failed)
        self.assertEqual(msg["event"], "python test event")
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$session_id"], session_id)
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)

        # Check additional expected properties
        for key, value in expected_properties.items():
            self.assertEqual(msg["properties"][key], value)

    def test_session_id_preserved_with_groups(self):
        client = self.client
        session_id = "group-session-101"

        success, msg = client.capture(
            "distinct_id",
            "test_event",
            properties={"$session_id": session_id},
            groups={"company": "id:5", "instance": "app.posthog.com"},
        )
        client.flush()

        self.assertTrue(success)
        self.assertEqual(msg["properties"]["$session_id"], session_id)
        self.assertEqual(
            msg["properties"]["$groups"],
            {"company": "id:5", "instance": "app.posthog.com"},
        )

    def test_session_id_with_anonymous_event(self):
        client = self.client
        session_id = "anonymous-session-202"

        success, msg = client.capture(
            "distinct_id",
            "anonymous_event",
            properties={"$session_id": session_id, "$process_person_profile": False},
        )
        client.flush()

        self.assertTrue(success)
        self.assertEqual(msg["properties"]["$session_id"], session_id)
        self.assertEqual(msg["properties"]["$process_person_profile"], False)

    def test_page_with_session_id(self):
        client = self.client
        session_id = "page-session-303"

        success, msg = client.page(
            "distinct_id",
            "https://posthog.com/contact",
            properties={"$session_id": session_id, "page_type": "contact"},
        )
        client.flush()

        self.assertTrue(success)
        self.assertFalse(self.failed)
        self.assertEqual(msg["event"], "$pageview")
        self.assertEqual(msg["distinct_id"], "distinct_id")
        self.assertEqual(msg["properties"]["$session_id"], session_id)
        self.assertEqual(
            msg["properties"]["$current_url"], "https://posthog.com/contact"
        )
        self.assertEqual(msg["properties"]["page_type"], "contact")

    @parameterized.expand(
        [
            # test_name, event_name, session_id, additional_properties, expected_additional_properties
            (
                "screen_event",
                "$screen",
                "special-session-505",
                {"$screen_name": "HomeScreen"},
                {"$screen_name": "HomeScreen"},
            ),
            (
                "survey_event",
                "survey sent",
                "survey-session-606",
                {
                    "$survey_id": "survey_123",
                    "$survey_questions": [
                        {"id": "q1", "question": "How likely are you to recommend us?"}
                    ],
                },
                {"$survey_id": "survey_123"},
            ),
            (
                "complex_properties_event",
                "complex_event",
                "mixed-session-707",
                {
                    "$current_url": "https://example.com/page",
                    "$process_person_profile": True,
                    "custom_property": "custom_value",
                    "numeric_property": 42,
                    "boolean_property": True,
                },
                {
                    "$current_url": "https://example.com/page",
                    "$process_person_profile": True,
                    "custom_property": "custom_value",
                    "numeric_property": 42,
                    "boolean_property": True,
                },
            ),
            (
                "csp_violation",
                "$csp_violation",
                "csp-session-789",
                {
                    "$csp_version": "1.0",
                    "$current_url": "https://example.com/page",
                    "$process_person_profile": False,
                    "$raw_user_agent": "Mozilla/5.0 Test Agent",
                    "$csp_document_url": "https://example.com/page",
                    "$csp_blocked_url": "https://malicious.com/script.js",
                    "$csp_violated_directive": "script-src",
                },
                {
                    "$csp_version": "1.0",
                    "$current_url": "https://example.com/page",
                    "$process_person_profile": False,
                    "$raw_user_agent": "Mozilla/5.0 Test Agent",
                    "$csp_document_url": "https://example.com/page",
                    "$csp_blocked_url": "https://malicious.com/script.js",
                    "$csp_violated_directive": "script-src",
                },
            ),
        ]
    )
    def test_session_id_with_different_event_types(
        self,
        test_name,
        event_name,
        session_id,
        additional_properties,
        expected_additional_properties,
    ):
        client = self.client

        properties = {"$session_id": session_id, **additional_properties}
        success, msg = client.capture("distinct_id", event_name, properties=properties)
        client.flush()

        self.assertTrue(success)
        self.assertEqual(msg["event"], event_name)
        self.assertEqual(msg["properties"]["$session_id"], session_id)

        # Check additional expected properties
        for key, value in expected_additional_properties.items():
            self.assertEqual(msg["properties"][key], value)

        # Verify system properties are still added
        self.assertEqual(msg["properties"]["$lib"], "posthog-python")
        self.assertEqual(msg["properties"]["$lib_version"], VERSION)

    @parameterized.expand(
        [
            # test_name, super_properties, event_session_id, expected_session_id, expected_super_props
            (
                "super_properties_override_session_id",
                {"$session_id": "super-session", "source": "test"},
                "event-session-808",
                "super-session",
                {"source": "test"},
            ),
            (
                "no_super_properties_conflict",
                {"source": "test", "version": "1.0"},
                "event-session-909",
                "event-session-909",
                {"source": "test", "version": "1.0"},
            ),
            (
                "empty_super_properties",
                {},
                "event-session-111",
                "event-session-111",
                {},
            ),
            (
                "super_properties_with_other_dollar_props",
                {"$current_url": "https://super.com", "source": "test"},
                "event-session-222",
                "event-session-222",
                {"$current_url": "https://super.com", "source": "test"},
            ),
        ]
    )
    def test_session_id_with_super_properties_variations(
        self,
        test_name,
        super_properties,
        event_session_id,
        expected_session_id,
        expected_super_props,
    ):
        client = Client(FAKE_TEST_API_KEY, super_properties=super_properties)

        success, msg = client.capture(
            "distinct_id", "test_event", properties={"$session_id": event_session_id}
        )
        client.flush()

        self.assertTrue(success)
        self.assertEqual(msg["properties"]["$session_id"], expected_session_id)

        # Check expected super properties are present
        for key, value in expected_super_props.items():
            self.assertEqual(msg["properties"][key], value)

    def test_flush(self):
        client = self.client
        # set up the consumer with more requests than a single batch will allow
        for i in range(1000):
            success, msg = client.identify("distinct_id", {"trait": "value"})
        # We can't reliably assert that the queue is non-empty here; that's
        # a race condition. We do our best to load it up though.
        client.flush()
        # Make sure that the client queue is empty after flushing
        self.assertTrue(client.queue.empty())

    def test_shutdown(self):
        client = self.client
        # set up the consumer with more requests than a single batch will allow
        for i in range(1000):
            success, msg = client.identify("distinct_id", {"trait": "value"})
        client.shutdown()
        # we expect two things after shutdown:
        # 1. client queue is empty
        # 2. consumer thread has stopped
        self.assertTrue(client.queue.empty())
        for consumer in client.consumers:
            self.assertFalse(consumer.is_alive())

    def test_synchronous(self):
        client = Client(FAKE_TEST_API_KEY, sync_mode=True)

        success, message = client.identify("distinct_id")
        self.assertFalse(client.consumers)
        self.assertTrue(client.queue.empty())
        self.assertTrue(success)

    def test_overflow(self):
        client = Client(FAKE_TEST_API_KEY, max_queue_size=1)
        # Ensure consumer thread is no longer uploading
        client.join()

        for i in range(10):
            client.identify("distinct_id")

        success, msg = client.identify("distinct_id")
        # Make sure we are informed that the queue is at capacity
        self.assertFalse(success)

    def test_unicode(self):
        Client(six.u("unicode_key"))

    def test_numeric_distinct_id(self):
        self.client.capture(1234, "python event")
        self.client.flush()
        self.assertFalse(self.failed)

    def test_debug(self):
        Client("bad_key", debug=True)

    def test_gzip(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.fail, gzip=True)
        for _ in range(10):
            client.identify("distinct_id", {"trait": "value"})
        client.flush()
        self.assertFalse(self.failed)

    def test_user_defined_flush_at(self):
        client = Client(
            FAKE_TEST_API_KEY, on_error=self.fail, flush_at=10, flush_interval=3
        )

        def mock_post_fn(*args, **kwargs):
            self.assertEqual(len(kwargs["batch"]), 10)

        # the post function should be called 2 times, with a batch size of 10
        # each time.
        with mock.patch(
            "posthog.consumer.batch_post", side_effect=mock_post_fn
        ) as mock_post:
            for _ in range(20):
                client.identify("distinct_id", {"trait": "value"})
            time.sleep(1)
            self.assertEqual(mock_post.call_count, 2)

    def test_user_defined_timeout(self):
        client = Client(FAKE_TEST_API_KEY, timeout=10)
        for consumer in client.consumers:
            self.assertEqual(consumer.timeout, 10)

    def test_default_timeout_15(self):
        client = Client(FAKE_TEST_API_KEY)
        for consumer in client.consumers:
            self.assertEqual(consumer.timeout, 15)

    def test_disabled(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disabled=True)
        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertFalse(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg, "disabled")

    @mock.patch("posthog.client.flags")
    def test_disabled_with_feature_flags(self, patch_flags):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disabled=True)

        response = client.get_feature_flag("beta-feature", "12345")
        self.assertIsNone(response)
        patch_flags.assert_not_called()

        response = client.feature_enabled("beta-feature", "12345")
        self.assertIsNone(response)
        patch_flags.assert_not_called()

        response = client.get_all_flags("12345")
        self.assertIsNone(response)
        patch_flags.assert_not_called()

        response = client.get_feature_flag_payload("key", "12345")
        self.assertIsNone(response)
        patch_flags.assert_not_called()

        response = client.get_all_flags_and_payloads("12345")
        self.assertEqual(response, {"featureFlags": None, "featureFlagPayloads": None})
        patch_flags.assert_not_called()

        # no capture calls
        self.assertTrue(client.queue.empty())

    def test_enabled_to_disabled(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disabled=False)
        success, msg = client.capture("distinct_id", "python test event")
        client.flush()

        self.assertTrue(success)
        self.assertFalse(self.failed)
        self.assertEqual(msg["event"], "python test event")

        client.disabled = True
        success, msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertFalse(success)
        self.assertFalse(self.failed)

        self.assertEqual(msg, "disabled")

    def test_disable_geoip_default_on_events(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disable_geoip=True)
        _, capture_msg = client.capture("distinct_id", "python test event")
        client.flush()
        self.assertEqual(capture_msg["properties"]["$geoip_disable"], True)

        _, identify_msg = client.identify("distinct_id", {"trait": "value"})
        client.flush()
        self.assertEqual(identify_msg["properties"]["$geoip_disable"], True)

    def test_disable_geoip_override_on_events(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disable_geoip=False)
        _, capture_msg = client.set(
            "distinct_id", {"a": "b", "c": "d"}, disable_geoip=True
        )
        client.flush()
        self.assertEqual(capture_msg["properties"]["$geoip_disable"], True)

        _, identify_msg = client.page(
            "distinct_id", "http://a.com", {"trait": "value"}, disable_geoip=False
        )
        client.flush()
        self.assertEqual("$geoip_disable" not in identify_msg["properties"], True)

    def test_disable_geoip_method_overrides_init_on_events(self):
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disable_geoip=True)
        _, msg = client.capture("distinct_id", "python test event", disable_geoip=False)
        client.flush()
        self.assertTrue("$geoip_disable" not in msg["properties"])

    @mock.patch("posthog.client.flags")
    def test_disable_geoip_default_on_decide(self, patch_flags):
        patch_flags.return_value = {
            "featureFlags": {
                "beta-feature": "random-variant",
                "alpha-feature": True,
                "off-feature": False,
            }
        }
        client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail, disable_geoip=False)
        client.get_feature_flag("random_key", "some_id", disable_geoip=True)
        patch_flags.assert_called_with(
            "random_key",
            "https://us.i.posthog.com",
            timeout=3,
            distinct_id="some_id",
            groups={},
            person_properties={"distinct_id": "some_id"},
            group_properties={},
            geoip_disable=True,
        )
        patch_flags.reset_mock()
        client.feature_enabled(
            "random_key", "feature_enabled_distinct_id", disable_geoip=True
        )
        patch_flags.assert_called_with(
            "random_key",
            "https://us.i.posthog.com",
            timeout=3,
            distinct_id="feature_enabled_distinct_id",
            groups={},
            person_properties={"distinct_id": "feature_enabled_distinct_id"},
            group_properties={},
            geoip_disable=True,
        )
        patch_flags.reset_mock()
        client.get_all_flags_and_payloads("all_flags_payloads_id")
        patch_flags.assert_called_with(
            "random_key",
            "https://us.i.posthog.com",
            timeout=3,
            distinct_id="all_flags_payloads_id",
            groups={},
            person_properties={"distinct_id": "all_flags_payloads_id"},
            group_properties={},
            geoip_disable=False,
        )

    @mock.patch("posthog.client.Poller")
    @mock.patch("posthog.client.get")
    def test_call_identify_fails(self, patch_get, patch_poll):
        def raise_effect():
            raise Exception("http exception")

        patch_get.return_value.raiseError.side_effect = raise_effect
        client = Client(FAKE_TEST_API_KEY, personal_api_key="test")
        client.feature_flags = [{"key": "example"}]

        self.assertFalse(client.feature_enabled("example", "distinct_id"))

    @mock.patch("posthog.client.flags")
    def test_default_properties_get_added_properly(self, patch_flags):
        patch_flags.return_value = {
            "featureFlags": {
                "beta-feature": "random-variant",
                "alpha-feature": True,
                "off-feature": False,
            }
        }
        client = Client(
            FAKE_TEST_API_KEY,
            host="http://app2.posthog.com",
            on_error=self.set_fail,
            disable_geoip=False,
        )
        client.get_feature_flag(
            "random_key",
            "some_id",
            groups={"company": "id:5", "instance": "app.posthog.com"},
            person_properties={"x1": "y1"},
            group_properties={"company": {"x": "y"}},
        )
        patch_flags.assert_called_with(
            "random_key",
            "http://app2.posthog.com",
            timeout=3,
            distinct_id="some_id",
            groups={"company": "id:5", "instance": "app.posthog.com"},
            person_properties={"distinct_id": "some_id", "x1": "y1"},
            group_properties={
                "company": {"$group_key": "id:5", "x": "y"},
                "instance": {"$group_key": "app.posthog.com"},
            },
            geoip_disable=False,
        )

        patch_flags.reset_mock()
        client.get_feature_flag(
            "random_key",
            "some_id",
            groups={"company": "id:5", "instance": "app.posthog.com"},
            person_properties={"distinct_id": "override"},
            group_properties={
                "company": {
                    "$group_key": "group_override",
                }
            },
        )
        patch_flags.assert_called_with(
            "random_key",
            "http://app2.posthog.com",
            timeout=3,
            distinct_id="some_id",
            groups={"company": "id:5", "instance": "app.posthog.com"},
            person_properties={"distinct_id": "override"},
            group_properties={
                "company": {"$group_key": "group_override"},
                "instance": {"$group_key": "app.posthog.com"},
            },
            geoip_disable=False,
        )

        patch_flags.reset_mock()
        # test nones
        client.get_all_flags_and_payloads(
            "some_id", groups={}, person_properties=None, group_properties=None
        )
        patch_flags.assert_called_with(
            "random_key",
            "http://app2.posthog.com",
            timeout=3,
            distinct_id="some_id",
            groups={},
            person_properties={"distinct_id": "some_id"},
            group_properties={},
            geoip_disable=False,
        )

    @parameterized.expand(
        [
            # name, sys_platform, version_info, expected_runtime, expected_version, expected_os, expected_os_version, platform_method, platform_return, distro_info
            (
                "macOS",
                "darwin",
                (3, 8, 10),
                "MockPython",
                "3.8.10",
                "Mac OS X",
                "10.15.7",
                "mac_ver",
                ("10.15.7", "", ""),
                None,
            ),
            (
                "Windows",
                "win32",
                (3, 8, 10),
                "MockPython",
                "3.8.10",
                "Windows",
                "10",
                "win32_ver",
                ("10", "", "", ""),
                None,
            ),
            (
                "Linux",
                "linux",
                (3, 8, 10),
                "MockPython",
                "3.8.10",
                "Linux",
                "20.04",
                None,
                None,
                {"version": "20.04"},
            ),
        ]
    )
    def test_mock_system_context(
        self,
        _name,
        sys_platform,
        version_info,
        expected_runtime,
        expected_version,
        expected_os,
        expected_os_version,
        platform_method,
        platform_return,
        distro_info,
    ):
        """Test that we can mock platform and sys for testing system_context"""
        with mock.patch("posthog.client.platform") as mock_platform:
            with mock.patch("posthog.client.sys") as mock_sys:
                # Set up common mocks
                mock_platform.python_implementation.return_value = expected_runtime
                mock_sys.version_info = version_info
                mock_sys.platform = sys_platform

                # Set up platform-specific mocks
                if platform_method:
                    getattr(
                        mock_platform, platform_method
                    ).return_value = platform_return

                # Special handling for Linux which uses distro module
                if sys_platform == "linux":
                    # Directly patch the get_os_info function to return our expected values
                    with mock.patch(
                        "posthog.client.get_os_info",
                        return_value=(expected_os, expected_os_version),
                    ):
                        from posthog.client import system_context

                        context = system_context()
                else:
                    # Get system context for non-Linux platforms
                    from posthog.client import system_context

                    context = system_context()

                # Verify results
                expected_context = {
                    "$python_runtime": expected_runtime,
                    "$python_version": expected_version,
                    "$os": expected_os,
                    "$os_version": expected_os_version,
                }

                assert context == expected_context

    @mock.patch("posthog.client.flags")
    def test_get_decide_returns_normalized_decide_response(self, patch_flags):
        patch_flags.return_value = {
            "featureFlags": {
                "beta-feature": "random-variant",
                "alpha-feature": True,
                "off-feature": False,
            },
            "featureFlagPayloads": {"beta-feature": '{"some": "data"}'},
            "errorsWhileComputingFlags": False,
            "requestId": "test-id",
        }

        client = Client(FAKE_TEST_API_KEY)
        distinct_id = "test_distinct_id"
        groups = {"test_group_type": "test_group_id"}
        person_properties = {"test_property": "test_value"}

        response = client.get_flags_decision(distinct_id, groups, person_properties)

        assert response == {
            "flags": {
                "beta-feature": FeatureFlag(
                    key="beta-feature",
                    enabled=True,
                    variant="random-variant",
                    reason=None,
                    metadata=LegacyFlagMetadata(
                        payload='{"some": "data"}',
                    ),
                ),
                "alpha-feature": FeatureFlag(
                    key="alpha-feature",
                    enabled=True,
                    variant=None,
                    reason=None,
                    metadata=LegacyFlagMetadata(
                        payload=None,
                    ),
                ),
                "off-feature": FeatureFlag(
                    key="off-feature",
                    enabled=False,
                    variant=None,
                    reason=None,
                    metadata=LegacyFlagMetadata(
                        payload=None,
                    ),
                ),
            },
            "errorsWhileComputingFlags": False,
            "requestId": "test-id",
        }

    def test_set_context_session_with_capture(self):
        with new_context():
            set_context_session("context-session-123")

            success, msg = self.client.capture(
                "distinct_id", "test_event", {"custom_prop": "value"}
            )
            self.client.flush()

            self.assertTrue(success)
            self.assertEqual(msg["properties"]["$session_id"], "context-session-123")

    def test_set_context_session_with_page(self):
        with new_context():
            set_context_session("page-context-session-456")

            success, msg = self.client.page("distinct_id", "https://example.com/page")
            self.client.flush()

            self.assertTrue(success)
            self.assertEqual(
                msg["properties"]["$session_id"], "page-context-session-456"
            )

    def test_set_context_session_with_page_explicit_properties(self):
        with new_context():
            set_context_session("page-explicit-session-789")

            properties = {
                "$session_id": get_context_session_id(),
                "page_type": "landing",
            }
            success, msg = self.client.page(
                "distinct_id", "https://example.com/landing", properties
            )
            self.client.flush()

            self.assertTrue(success)
            self.assertEqual(
                msg["properties"]["$session_id"], "page-explicit-session-789"
            )

    def test_set_context_session_override_in_capture(self):
        """Test that explicit session ID overrides context session ID in capture"""
        from posthog.scopes import set_context_session, new_context

        with new_context():
            set_context_session("context-session-override")

            success, msg = self.client.capture(
                "distinct_id",
                "test_event",
                {"$session_id": "explicit-session-override", "custom_prop": "value"},
            )
            self.client.flush()

            self.assertTrue(success)
            self.assertEqual(
                msg["properties"]["$session_id"], "explicit-session-override"
            )

    def test_set_context_session_with_identify(self):
        with new_context(capture_exceptions=False):
            set_context_session("identify-session-555")

            success, msg = self.client.identify("distinct_id", {"trait": "value"})
            self.client.flush()

            self.assertTrue(success)
            # In identify, the session ID is added to the $set payload
            self.assertEqual(msg["$set"]["$session_id"], "identify-session-555")

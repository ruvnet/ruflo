import unittest

import mock

from posthog.client import Client
from posthog.test.test_utils import FAKE_TEST_API_KEY
from posthog.types import FeatureFlag, FeatureFlagResult, FlagMetadata, FlagReason


class TestFeatureFlagResult(unittest.TestCase):
    def test_from_bool_value_and_payload(self):
        result = FeatureFlagResult.from_value_and_payload(
            "test-flag", True, "[1, 2, 3]"
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, None)
        self.assertEqual(result.payload, [1, 2, 3])

    def test_from_false_value_and_payload(self):
        result = FeatureFlagResult.from_value_and_payload(
            "test-flag", False, '{"some": "value"}'
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, False)
        self.assertEqual(result.variant, None)
        self.assertEqual(result.payload, {"some": "value"})

    def test_from_variant_value_and_payload(self):
        result = FeatureFlagResult.from_value_and_payload(
            "test-flag", "control", "true"
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, "control")
        self.assertEqual(result.payload, True)

    def test_from_none_value_and_payload(self):
        result = FeatureFlagResult.from_value_and_payload(
            "test-flag", None, '{"some": "value"}'
        )
        self.assertIsNone(result)

    def test_from_boolean_flag_details(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant=None,
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload='"Some string"'
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(flag_details)

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, None)
        self.assertEqual(result.payload, "Some string")

    def test_from_boolean_flag_details_with_override_variant_match_value(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant=None,
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload='"Some string"'
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(
            flag_details, override_match_value="control"
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, "control")
        self.assertEqual(result.payload, "Some string")

    def test_from_boolean_flag_details_with_override_boolean_match_value(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant="control",
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload='{"some": "value"}'
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(
            flag_details, override_match_value=True
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, None)
        self.assertEqual(result.payload, {"some": "value"})

    def test_from_boolean_flag_details_with_override_false_match_value(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant="control",
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload='{"some": "value"}'
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(
            flag_details, override_match_value=False
        )

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, False)
        self.assertEqual(result.variant, None)
        self.assertEqual(result.payload, {"some": "value"})

    def test_from_variant_flag_details(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant="control",
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload='{"some": "value"}'
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(flag_details)

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, "control")
        self.assertEqual(result.payload, {"some": "value"})

    def test_from_none_flag_details(self):
        result = FeatureFlagResult.from_flag_details(None)

        self.assertIsNone(result)

    def test_from_flag_details_with_none_payload(self):
        flag_details = FeatureFlag(
            key="test-flag",
            enabled=True,
            variant=None,
            metadata=FlagMetadata(
                id=1, version=1, description="test-flag", payload=None
            ),
            reason=FlagReason(
                code="test-reason", description="test-reason", condition_index=0
            ),
        )

        result = FeatureFlagResult.from_flag_details(flag_details)

        self.assertEqual(result.key, "test-flag")
        self.assertEqual(result.enabled, True)
        self.assertEqual(result.variant, None)
        self.assertIsNone(result.payload)


class TestGetFeatureFlagResult(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # This ensures no real HTTP POST requests are made
        cls.capture_patch = mock.patch.object(Client, "capture")
        cls.capture_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls.capture_patch.stop()

    def set_fail(self, e, batch):
        """Mark the failure handler"""
        print("FAIL", e, batch)  # noqa: T201
        self.failed = True

    def setUp(self):
        self.failed = False
        self.client = Client(FAKE_TEST_API_KEY, on_error=self.set_fail)

    @mock.patch.object(Client, "capture")
    def test_get_feature_flag_result_boolean_local_evaluation(self, patch_capture):
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
                "payloads": {"true": "300"},
            },
        }
        self.client.feature_flags = [basic_flag]

        flag_result = self.client.get_feature_flag_result(
            "person-flag", "some-distinct-id", person_properties={"region": "USA"}
        )
        self.assertEqual(flag_result.enabled, True)
        self.assertEqual(flag_result.variant, None)
        self.assertEqual(flag_result.payload, 300)
        patch_capture.assert_called_with(
            "some-distinct-id",
            "$feature_flag_called",
            {
                "$feature_flag": "person-flag",
                "$feature_flag_response": True,
                "locally_evaluated": True,
                "$feature/person-flag": True,
                "$feature_flag_payload": 300,
            },
            groups={},
            disable_geoip=None,
        )

    @mock.patch.object(Client, "capture")
    def test_get_feature_flag_result_variant_local_evaluation(self, patch_capture):
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
                "multivariate": {
                    "variants": [
                        {"key": "variant-1", "rollout_percentage": 50},
                        {"key": "variant-2", "rollout_percentage": 50},
                    ]
                },
                "payloads": {"variant-1": '{"some": "value"}'},
            },
        }
        self.client.feature_flags = [basic_flag]

        flag_result = self.client.get_feature_flag_result(
            "person-flag", "distinct_id", person_properties={"region": "USA"}
        )
        self.assertEqual(flag_result.enabled, True)
        self.assertEqual(flag_result.variant, "variant-1")
        self.assertEqual(flag_result.get_value(), "variant-1")
        self.assertEqual(flag_result.payload, {"some": "value"})

        patch_capture.assert_called_with(
            "distinct_id",
            "$feature_flag_called",
            {
                "$feature_flag": "person-flag",
                "$feature_flag_response": "variant-1",
                "locally_evaluated": True,
                "$feature/person-flag": "variant-1",
                "$feature_flag_payload": {"some": "value"},
            },
            groups={},
            disable_geoip=None,
        )

        another_flag_result = self.client.get_feature_flag_result(
            "person-flag", "another-distinct-id", person_properties={"region": "USA"}
        )
        self.assertEqual(another_flag_result.enabled, True)
        self.assertEqual(another_flag_result.variant, "variant-2")
        self.assertEqual(another_flag_result.get_value(), "variant-2")
        self.assertIsNone(another_flag_result.payload)

        patch_capture.assert_called_with(
            "another-distinct-id",
            "$feature_flag_called",
            {
                "$feature_flag": "person-flag",
                "$feature_flag_response": "variant-2",
                "locally_evaluated": True,
                "$feature/person-flag": "variant-2",
            },
            groups={},
            disable_geoip=None,
        )

    @mock.patch("posthog.client.flags")
    @mock.patch.object(Client, "capture")
    def test_get_feature_flag_result_boolean_decide(self, patch_capture, patch_flags):
        patch_flags.return_value = {
            "flags": {
                "person-flag": {
                    "key": "person-flag",
                    "enabled": True,
                    "variant": None,
                    "reason": {
                        "description": "Matched condition set 1",
                    },
                    "metadata": {
                        "id": 23,
                        "version": 42,
                        "payload": "300",
                    },
                },
            },
        }

        flag_result = self.client.get_feature_flag_result(
            "person-flag", "some-distinct-id"
        )
        self.assertEqual(flag_result.enabled, True)
        self.assertEqual(flag_result.variant, None)
        self.assertEqual(flag_result.payload, 300)
        patch_capture.assert_called_with(
            "some-distinct-id",
            "$feature_flag_called",
            {
                "$feature_flag": "person-flag",
                "$feature_flag_response": True,
                "locally_evaluated": False,
                "$feature/person-flag": True,
                "$feature_flag_reason": "Matched condition set 1",
                "$feature_flag_id": 23,
                "$feature_flag_version": 42,
                "$feature_flag_payload": 300,
            },
            groups={},
            disable_geoip=None,
        )

    @mock.patch("posthog.client.flags")
    @mock.patch.object(Client, "capture")
    def test_get_feature_flag_result_variant_decide(self, patch_capture, patch_flags):
        patch_flags.return_value = {
            "flags": {
                "person-flag": {
                    "key": "person-flag",
                    "enabled": True,
                    "variant": "variant-1",
                    "reason": {
                        "description": "Matched condition set 1",
                    },
                    "metadata": {
                        "id": 1,
                        "version": 2,
                        "payload": "[1, 2, 3]",
                    },
                },
            },
        }

        flag_result = self.client.get_feature_flag_result("person-flag", "distinct_id")
        self.assertEqual(flag_result.enabled, True)
        self.assertEqual(flag_result.variant, "variant-1")
        self.assertEqual(flag_result.get_value(), "variant-1")
        self.assertEqual(flag_result.payload, [1, 2, 3])
        patch_capture.assert_called_with(
            "distinct_id",
            "$feature_flag_called",
            {
                "$feature_flag": "person-flag",
                "$feature_flag_response": "variant-1",
                "locally_evaluated": False,
                "$feature/person-flag": "variant-1",
                "$feature_flag_reason": "Matched condition set 1",
                "$feature_flag_id": 1,
                "$feature_flag_version": 2,
                "$feature_flag_payload": [1, 2, 3],
            },
            groups={},
            disable_geoip=None,
        )

    @mock.patch("posthog.client.flags")
    @mock.patch.object(Client, "capture")
    def test_get_feature_flag_result_unknown_flag(self, patch_capture, patch_flags):
        patch_flags.return_value = {
            "flags": {
                "person-flag": {
                    "key": "person-flag",
                    "enabled": True,
                    "variant": None,
                    "reason": {
                        "description": "Matched condition set 1",
                    },
                    "metadata": {
                        "id": 23,
                        "version": 42,
                        "payload": "300",
                    },
                },
            },
        }

        flag_result = self.client.get_feature_flag_result(
            "no-person-flag", "some-distinct-id"
        )

        self.assertIsNone(flag_result)
        patch_capture.assert_called_with(
            "some-distinct-id",
            "$feature_flag_called",
            {
                "$feature_flag": "no-person-flag",
                "$feature_flag_response": None,
                "locally_evaluated": False,
                "$feature/no-person-flag": None,
            },
            groups={},
            disable_geoip=None,
        )

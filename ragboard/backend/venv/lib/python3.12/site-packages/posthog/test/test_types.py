import unittest

from parameterized import parameterized

from posthog.types import (
    FeatureFlag,
    FlagMetadata,
    FlagReason,
    LegacyFlagMetadata,
    normalize_flags_response,
    to_flags_and_payloads,
)


class TestTypes(unittest.TestCase):
    @parameterized.expand([(True,), (False,)])
    def test_normalize_decide_response_v4(self, has_errors: bool):
        resp = {
            "flags": {
                "my-flag": FeatureFlag(
                    key="my-flag",
                    enabled=True,
                    variant="test-variant",
                    reason=FlagReason(
                        code="matched_condition",
                        condition_index=0,
                        description="Matched condition set 1",
                    ),
                    metadata=FlagMetadata(
                        id=1,
                        payload='{"some": "json"}',
                        version=2,
                        description="test-description",
                    ),
                )
            },
            "errorsWhileComputingFlags": has_errors,
            "requestId": "test-id",
        }

        result = normalize_flags_response(resp)

        flag = result["flags"]["my-flag"]
        self.assertEqual(flag.key, "my-flag")
        self.assertTrue(flag.enabled)
        self.assertEqual(flag.variant, "test-variant")
        self.assertEqual(flag.get_value(), "test-variant")
        self.assertEqual(
            flag.reason,
            FlagReason(
                code="matched_condition",
                condition_index=0,
                description="Matched condition set 1",
            ),
        )
        self.assertEqual(
            flag.metadata,
            FlagMetadata(
                id=1,
                payload='{"some": "json"}',
                version=2,
                description="test-description",
            ),
        )
        self.assertEqual(result["errorsWhileComputingFlags"], has_errors)
        self.assertEqual(result["requestId"], "test-id")

    def test_normalize_decide_response_legacy(self):
        # Test legacy response format with "featureFlags" and "featureFlagPayloads"
        resp = {
            "featureFlags": {"my-flag": "test-variant"},
            "featureFlagPayloads": {"my-flag": '{"some": "json-payload"}'},
            "errorsWhileComputingFlags": False,
            "requestId": "test-id",
        }

        result = normalize_flags_response(resp)

        flag = result["flags"]["my-flag"]
        self.assertEqual(flag.key, "my-flag")
        self.assertTrue(flag.enabled)
        self.assertEqual(flag.variant, "test-variant")
        self.assertEqual(flag.get_value(), "test-variant")
        self.assertIsNone(flag.reason)
        self.assertEqual(
            flag.metadata, LegacyFlagMetadata(payload='{"some": "json-payload"}')
        )
        self.assertFalse(result["errorsWhileComputingFlags"])
        self.assertEqual(result["requestId"], "test-id")
        # Verify legacy fields are removed
        self.assertNotIn("featureFlags", result)
        self.assertNotIn("featureFlagPayloads", result)

    def test_normalize_decide_response_boolean_flag(self):
        # Test legacy response with boolean flag
        resp = {"featureFlags": {"my-flag": True}, "errorsWhileComputingFlags": False}

        result = normalize_flags_response(resp)

        self.assertIn("requestId", result)
        self.assertIsNone(result["requestId"])

        flag = result["flags"]["my-flag"]
        self.assertEqual(flag.key, "my-flag")
        self.assertTrue(flag.enabled)
        self.assertIsNone(flag.variant)
        self.assertIsNone(flag.reason)
        self.assertEqual(flag.metadata, LegacyFlagMetadata(payload=None))
        self.assertFalse(result["errorsWhileComputingFlags"])
        self.assertNotIn("featureFlags", result)
        self.assertNotIn("featureFlagPayloads", result)

    def test_to_flags_and_payloads_v4(self):
        # Test v4 response format
        resp = {
            "flags": {
                "my-variant-flag": FeatureFlag(
                    key="my-variant-flag",
                    enabled=True,
                    variant="test-variant",
                    reason=FlagReason(
                        code="matched_condition",
                        condition_index=0,
                        description="Matched condition set 1",
                    ),
                    metadata=FlagMetadata(
                        id=1,
                        payload='{"some": "json"}',
                        version=2,
                        description="test-description",
                    ),
                ),
                "my-boolean-flag": FeatureFlag(
                    key="my-boolean-flag",
                    enabled=True,
                    variant=None,
                    reason=FlagReason(
                        code="matched_condition",
                        condition_index=0,
                        description="Matched condition set 1",
                    ),
                    metadata=FlagMetadata(
                        id=1, payload=None, version=2, description="test-description"
                    ),
                ),
                "disabled-flag": FeatureFlag(
                    key="disabled-flag",
                    enabled=False,
                    variant=None,
                    reason=None,
                    metadata=LegacyFlagMetadata(payload=None),
                ),
            },
            "errorsWhileComputingFlags": False,
            "requestId": "test-id",
        }

        result = to_flags_and_payloads(resp)

        self.assertEqual(result["featureFlags"]["my-variant-flag"], "test-variant")
        self.assertEqual(result["featureFlags"]["my-boolean-flag"], True)
        self.assertEqual(result["featureFlags"]["disabled-flag"], False)
        self.assertEqual(
            result["featureFlagPayloads"]["my-variant-flag"], '{"some": "json"}'
        )
        self.assertNotIn("my-boolean-flag", result["featureFlagPayloads"])
        self.assertNotIn("disabled-flag", result["featureFlagPayloads"])

    def test_to_flags_and_payloads_empty(self):
        # Test empty response
        resp = {
            "flags": {},
            "errorsWhileComputingFlags": False,
            "requestId": "test-id",
        }

        result = to_flags_and_payloads(resp)

        self.assertEqual(result["featureFlags"], {})
        self.assertEqual(result["featureFlagPayloads"], {})

    def test_to_flags_and_payloads_with_payload(self):
        resp = {
            "flags": {
                "decide-flag": {
                    "key": "decide-flag",
                    "enabled": True,
                    "variant": "decide-variant",
                    "reason": {
                        "code": "matched_condition",
                        "condition_index": 0,
                        "description": "Matched condition set 1",
                    },
                    "metadata": {
                        "id": 23,
                        "version": 42,
                        "payload": '{"foo": "bar"}',
                    },
                }
            },
            "requestId": "18043bf7-9cf6-44cd-b959-9662ee20d371",
        }

        normalized = normalize_flags_response(resp)
        result = to_flags_and_payloads(normalized)

        self.assertEqual(result["featureFlags"]["decide-flag"], "decide-variant")
        self.assertEqual(result["featureFlagPayloads"]["decide-flag"], '{"foo": "bar"}')

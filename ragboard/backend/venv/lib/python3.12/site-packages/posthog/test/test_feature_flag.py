import unittest

from posthog.types import FeatureFlag, FlagMetadata, FlagReason, LegacyFlagMetadata


class TestFeatureFlag(unittest.TestCase):
    def test_feature_flag_from_json(self):
        # Test with full metadata
        resp = {
            "key": "test-flag",
            "enabled": True,
            "variant": "test-variant",
            "reason": {
                "code": "matched_condition",
                "condition_index": 0,
                "description": "Matched condition set 1",
            },
            "metadata": {
                "id": 1,
                "payload": '{"some": "json"}',
                "version": 2,
                "description": "test-description",
            },
        }

        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
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

    def test_feature_flag_from_json_minimal(self):
        # Test with minimal required fields
        resp = {"key": "test-flag", "enabled": True}

        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
        self.assertTrue(flag.enabled)
        self.assertIsNone(flag.variant)
        self.assertEqual(flag.get_value(), True)
        self.assertIsNone(flag.reason)
        self.assertEqual(flag.metadata, LegacyFlagMetadata(payload=None))

    def test_feature_flag_from_json_without_metadata(self):
        # Test with reason but no metadata
        resp = {
            "key": "test-flag",
            "enabled": True,
            "variant": "test-variant",
            "reason": {
                "code": "matched_condition",
                "condition_index": 0,
                "description": "Matched condition set 1",
            },
        }

        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
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
        self.assertEqual(flag.metadata, LegacyFlagMetadata(payload=None))

    def test_flag_reason_from_json(self):
        # Test with complete data
        resp = {
            "code": "user_in_segment",
            "condition_index": 1,
            "description": "User is in segment 'beta_users'",
        }
        reason = FlagReason.from_json(resp)
        self.assertEqual(reason.code, "user_in_segment")
        self.assertEqual(reason.condition_index, 1)
        self.assertEqual(reason.description, "User is in segment 'beta_users'")

        # Test with partial data
        resp = {"code": "user_in_segment"}
        reason = FlagReason.from_json(resp)
        self.assertEqual(reason.code, "user_in_segment")
        self.assertIsNone(reason.condition_index)  # default value
        self.assertEqual(reason.description, "")

        # Test with None
        self.assertIsNone(FlagReason.from_json(None))

    def test_flag_metadata_from_json(self):
        # Test with complete data
        resp = {
            "id": 123,
            "payload": {"key": "value"},
            "version": 1,
            "description": "Test flag",
        }
        metadata = FlagMetadata.from_json(resp)
        self.assertEqual(metadata.id, 123)
        self.assertEqual(metadata.payload, {"key": "value"})
        self.assertEqual(metadata.version, 1)
        self.assertEqual(metadata.description, "Test flag")

        # Test with partial data
        resp = {"id": 123}
        metadata = FlagMetadata.from_json(resp)
        self.assertEqual(metadata.id, 123)
        self.assertIsNone(metadata.payload)
        self.assertEqual(metadata.version, 0)  # default value
        self.assertEqual(metadata.description, "")  # default value

        # Test with None
        self.assertIsInstance(FlagMetadata.from_json(None), LegacyFlagMetadata)

    def test_feature_flag_from_json_complete(self):
        # Test with complete data
        resp = {
            "key": "test-flag",
            "enabled": True,
            "variant": "control",
            "reason": {
                "code": "user_in_segment",
                "condition_index": 1,
                "description": "User is in segment 'beta_users'",
            },
            "metadata": {
                "id": 123,
                "payload": {"key": "value"},
                "version": 1,
                "description": "Test flag",
            },
        }
        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
        self.assertTrue(flag.enabled)
        self.assertEqual(flag.variant, "control")
        self.assertIsInstance(flag.reason, FlagReason)
        self.assertEqual(flag.reason.code, "user_in_segment")
        self.assertIsInstance(flag.metadata, FlagMetadata)
        self.assertEqual(flag.metadata.id, 123)
        self.assertEqual(flag.metadata.payload, {"key": "value"})

    def test_feature_flag_from_json_minimal_data(self):
        # Test with minimal data
        resp = {"key": "test-flag", "enabled": False}
        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
        self.assertFalse(flag.enabled)
        self.assertIsNone(flag.variant)
        self.assertIsNone(flag.reason)
        self.assertIsInstance(flag.metadata, LegacyFlagMetadata)
        self.assertIsNone(flag.metadata.payload)

    def test_feature_flag_from_json_with_reason(self):
        # Test with reason but no metadata
        resp = {
            "key": "test-flag",
            "enabled": True,
            "reason": {"code": "user_in_segment"},
        }
        flag = FeatureFlag.from_json(resp)
        self.assertEqual(flag.key, "test-flag")
        self.assertTrue(flag.enabled)
        self.assertIsNone(flag.variant)
        self.assertIsInstance(flag.reason, FlagReason)
        self.assertEqual(flag.reason.code, "user_in_segment")
        self.assertIsInstance(flag.metadata, LegacyFlagMetadata)
        self.assertIsNone(flag.metadata.payload)

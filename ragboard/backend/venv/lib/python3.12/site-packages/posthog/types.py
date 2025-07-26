import json
from dataclasses import dataclass
from typing import Any, Callable, List, Optional, TypedDict, Union, cast

FlagValue = Union[bool, str]

# Type alias for the before_send callback function
# Takes an event dictionary and returns the modified event or None to drop it
BeforeSendCallback = Callable[[dict[str, Any]], Optional[dict[str, Any]]]


@dataclass(frozen=True)
class FlagReason:
    code: str
    condition_index: Optional[int]
    description: str

    @classmethod
    def from_json(cls, resp: Any) -> Optional["FlagReason"]:
        if not resp:
            return None
        return cls(
            code=resp.get("code", ""),
            condition_index=resp.get("condition_index"),
            description=resp.get("description", ""),
        )


@dataclass(frozen=True)
class LegacyFlagMetadata:
    payload: Any


@dataclass(frozen=True)
class FlagMetadata:
    id: int
    payload: Optional[str]
    version: int
    description: str

    @classmethod
    def from_json(cls, resp: Any) -> Union["FlagMetadata", LegacyFlagMetadata]:
        if not resp:
            return LegacyFlagMetadata(payload=None)
        return cls(
            id=resp.get("id", 0),
            payload=resp.get("payload"),
            version=resp.get("version", 0),
            description=resp.get("description", ""),
        )


@dataclass(frozen=True)
class FeatureFlag:
    key: str
    enabled: bool
    variant: Optional[str]
    reason: Optional[FlagReason]
    metadata: Union[FlagMetadata, LegacyFlagMetadata]

    def get_value(self) -> FlagValue:
        return self.variant or self.enabled

    @classmethod
    def from_json(cls, resp: Any) -> "FeatureFlag":
        reason = None
        if resp.get("reason"):
            reason = FlagReason.from_json(resp.get("reason"))

        metadata = None
        if resp.get("metadata"):
            metadata = FlagMetadata.from_json(resp.get("metadata"))
        else:
            metadata = LegacyFlagMetadata(payload=None)

        return cls(
            key=resp.get("key"),
            enabled=resp.get("enabled"),
            variant=resp.get("variant"),
            reason=reason,
            metadata=metadata,
        )

    @classmethod
    def from_value_and_payload(
        cls, key: str, value: FlagValue, payload: Any
    ) -> "FeatureFlag":
        enabled, variant = (True, value) if isinstance(value, str) else (value, None)
        return cls(
            key=key,
            enabled=enabled,
            variant=variant,
            reason=None,
            metadata=LegacyFlagMetadata(
                payload=payload if payload else None,
            ),
        )


class FlagsResponse(TypedDict, total=False):
    flags: dict[str, FeatureFlag]
    errorsWhileComputingFlags: bool
    requestId: str
    quotaLimit: Optional[List[str]]


class FlagsAndPayloads(TypedDict, total=True):
    featureFlags: Optional[dict[str, FlagValue]]
    featureFlagPayloads: Optional[dict[str, Any]]


@dataclass(frozen=True)
class FeatureFlagResult:
    """
    The result of calling a feature flag which includes the flag result, variant, and payload.

    Attributes:
        key (str): The unique identifier of the feature flag.
        enabled (bool): Whether the feature flag is enabled for the current context.
        variant (Optional[str]): The variant value if the flag is enabled and has variants, None otherwise.
        payload (Optional[Any]): Additional data associated with the feature flag, if any.
        reason (Optional[str]): A description of why the flag was enabled or disabled, if available.
    """

    key: str
    enabled: bool
    variant: Optional[str]
    payload: Optional[Any]
    reason: Optional[str]

    def get_value(self) -> FlagValue:
        """
        Returns the value of the flag. This is the variant if it exists, otherwise the enabled value.
        This is the value we report as `$feature_flag_response` in the `$feature_flag_called` event.

        Returns:
            FlagValue: Either a string variant or boolean value representing the flag's state.
        """
        return self.variant or self.enabled

    @classmethod
    def from_value_and_payload(
        cls, key: str, value: Union[FlagValue, None], payload: Any
    ) -> Union["FeatureFlagResult", None]:
        """
        Creates a FeatureFlagResult from a flag value and payload.

        Args:
            key (str): The unique identifier of the feature flag.
            value (Union[FlagValue, None]): The value of the flag (string variant or boolean).
            payload (Any): Additional data associated with the feature flag.

        Returns:
            Union[FeatureFlagResult, None]: A new FeatureFlagResult instance, or None if value is None.
        """
        if value is None:
            return None
        enabled, variant = (True, value) if isinstance(value, str) else (value, None)
        return cls(
            key=key,
            enabled=enabled,
            variant=variant,
            payload=json.loads(payload) if isinstance(payload, str) else payload,
            reason=None,
        )

    @classmethod
    def from_flag_details(
        cls,
        details: Union[FeatureFlag, None],
        override_match_value: Optional[FlagValue] = None,
    ) -> "FeatureFlagResult | None":
        """
        Create a FeatureFlagResult from a FeatureFlag object.

        Args:
            details (Union[FeatureFlag, None]): The FeatureFlag object to convert.
            override_match_value (Optional[FlagValue]): If provided, this value will be used to populate
                the enabled and variant fields instead of the values from the FeatureFlag.

        Returns:
            FeatureFlagResult | None: A new FeatureFlagResult instance, or None if details is None.
        """

        if details is None:
            return None

        if override_match_value is not None:
            enabled, variant = (
                (True, override_match_value)
                if isinstance(override_match_value, str)
                else (override_match_value, None)
            )
        else:
            enabled, variant = (details.enabled, details.variant)

        return cls(
            key=details.key,
            enabled=enabled,
            variant=variant,
            payload=(
                json.loads(details.metadata.payload)
                if isinstance(details.metadata.payload, str)
                else details.metadata.payload
            ),
            reason=details.reason.description if details.reason else None,
        )


def normalize_flags_response(resp: Any) -> FlagsResponse:
    """
    Normalize the response from the decide or flags API endpoint into a FlagsResponse.

    Args:
        resp: A v3 or v4 response from the decide (or a v1 or v2 response from the flags) API endpoint.

    Returns:
        A FlagsResponse containing feature flags and their details.
    """
    if "requestId" not in resp:
        resp["requestId"] = None
    if "flags" in resp:
        flags = resp["flags"]
        # For each flag, create a FeatureFlag object
        for key, value in flags.items():
            if isinstance(value, FeatureFlag):
                continue
            value["key"] = key
            flags[key] = FeatureFlag.from_json(value)
    else:
        # Handle legacy format
        featureFlags = resp.get("featureFlags", {})
        featureFlagPayloads = resp.get("featureFlagPayloads", {})
        resp.pop("featureFlags", None)
        resp.pop("featureFlagPayloads", None)
        # look at each key in featureFlags and create a FeatureFlag object
        flags = {}
        for key, value in featureFlags.items():
            flags[key] = FeatureFlag.from_value_and_payload(
                key, value, featureFlagPayloads.get(key, None)
            )
        resp["flags"] = flags
    return cast(FlagsResponse, resp)


def to_flags_and_payloads(resp: FlagsResponse) -> FlagsAndPayloads:
    """
    Convert a FlagsResponse into a FlagsAndPayloads object which is a
    dict of feature flags and their payloads. This is needed by certain
    functions in the client.
    Args:
        resp: A FlagsResponse containing feature flags and their payloads.

    Returns:
        A tuple containing:
            - A dictionary mapping flag keys to their values (bool or str)
            - A dictionary mapping flag keys to their payloads
    """
    return {"featureFlags": to_values(resp), "featureFlagPayloads": to_payloads(resp)}


def to_values(response: FlagsResponse) -> Optional[dict[str, FlagValue]]:
    if "flags" not in response:
        return None

    flags = response.get("flags", {})
    return {
        key: value.get_value()
        for key, value in flags.items()
        if isinstance(value, FeatureFlag)
    }


def to_payloads(response: FlagsResponse) -> Optional[dict[str, str]]:
    if "flags" not in response:
        return None

    return {
        key: value.metadata.payload
        for key, value in response.get("flags", {}).items()
        if isinstance(value, FeatureFlag) and value.enabled and value.metadata.payload
    }

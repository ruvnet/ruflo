import atexit
import logging
import numbers
import os
import platform
import sys
import warnings
from datetime import datetime, timedelta
from typing import Any, Optional, Union
from uuid import UUID, uuid4

import distro  # For Linux OS detection
from dateutil.tz import tzutc
from six import string_types

from posthog.consumer import Consumer
from posthog.exception_capture import ExceptionCapture
from posthog.exception_utils import (
    exc_info_from_error,
    exceptions_from_error_tuple,
    handle_in_app,
    exception_is_already_captured,
    mark_exception_as_captured,
)
from posthog.feature_flags import InconclusiveMatchError, match_feature_flag_properties
from posthog.poller import Poller
from posthog.request import (
    DEFAULT_HOST,
    APIError,
    batch_post,
    determine_server_host,
    flags,
    get,
    remote_config,
)
from posthog.scopes import (
    _get_current_context,
    get_context_distinct_id,
    get_context_session_id,
)
from posthog.types import (
    FeatureFlag,
    FeatureFlagResult,
    FlagMetadata,
    FlagsAndPayloads,
    FlagsResponse,
    FlagValue,
    normalize_flags_response,
    to_flags_and_payloads,
    to_payloads,
    to_values,
)
from posthog.utils import SizeLimitedDict, clean, guess_timezone, remove_trailing_slash
from posthog.version import VERSION

try:
    import queue
except ImportError:
    import Queue as queue


ID_TYPES = (numbers.Number, string_types, UUID)
MAX_DICT_SIZE = 50_000


def get_os_info():
    """
    Returns standardized OS name and version information.
    Similar to how user agent parsing works in JS.
    """
    os_name = ""
    os_version = ""

    platform_name = sys.platform

    if platform_name.startswith("win"):
        os_name = "Windows"
        if hasattr(platform, "win32_ver"):
            win_version = platform.win32_ver()[0]
            if win_version:
                os_version = win_version

    elif platform_name == "darwin":
        os_name = "Mac OS X"
        if hasattr(platform, "mac_ver"):
            mac_version = platform.mac_ver()[0]
            if mac_version:
                os_version = mac_version

    elif platform_name.startswith("linux"):
        os_name = "Linux"
        linux_info = distro.info()
        if linux_info["version"]:
            os_version = linux_info["version"]

    elif platform_name.startswith("freebsd"):
        os_name = "FreeBSD"
        if hasattr(platform, "release"):
            os_version = platform.release()

    else:
        os_name = platform_name
        if hasattr(platform, "release"):
            os_version = platform.release()

    return os_name, os_version


def system_context() -> dict[str, Any]:
    os_name, os_version = get_os_info()

    return {
        "$python_runtime": platform.python_implementation(),
        "$python_version": "%s.%s.%s" % (sys.version_info[:3]),
        "$os": os_name,
        "$os_version": os_version,
    }


class Client(object):
    """Create a new PostHog client."""

    log = logging.getLogger("posthog")

    def __init__(
        self,
        api_key=None,
        host=None,
        debug=False,
        max_queue_size=10000,
        send=True,
        on_error=None,
        flush_at=100,
        flush_interval=0.5,
        gzip=False,
        max_retries=3,
        sync_mode=False,
        timeout=15,
        thread=1,
        poll_interval=30,
        personal_api_key=None,
        project_api_key=None,
        disabled=False,
        disable_geoip=True,
        historical_migration=False,
        feature_flags_request_timeout_seconds=3,
        super_properties=None,
        enable_exception_autocapture=False,
        log_captured_exceptions=False,
        exception_autocapture_integrations=None,
        project_root=None,
        privacy_mode=False,
        before_send=None,
    ):
        self.queue = queue.Queue(max_queue_size)

        # api_key: This should be the Team API Key (token), public
        self.api_key = project_api_key or api_key

        require("api_key", self.api_key, string_types)

        self.on_error = on_error
        self.debug = debug
        self.send = send
        self.sync_mode = sync_mode
        # Used for session replay URL generation - we don't want the server host here.
        self.raw_host = host or DEFAULT_HOST
        self.host = determine_server_host(host)
        self.gzip = gzip
        self.timeout = timeout
        self._feature_flags = None  # private variable to store flags
        self.feature_flags_by_key = None
        self.group_type_mapping = None
        self.cohorts = None
        self.poll_interval = poll_interval
        self.feature_flags_request_timeout_seconds = (
            feature_flags_request_timeout_seconds
        )
        self.poller = None
        self.distinct_ids_feature_flags_reported = SizeLimitedDict(MAX_DICT_SIZE, set)
        self.disabled = disabled
        self.disable_geoip = disable_geoip
        self.historical_migration = historical_migration
        self.super_properties = super_properties
        self.enable_exception_autocapture = enable_exception_autocapture
        self.log_captured_exceptions = log_captured_exceptions
        self.exception_autocapture_integrations = exception_autocapture_integrations
        self.exception_capture = None
        self.privacy_mode = privacy_mode

        if project_root is None:
            try:
                project_root = os.getcwd()
            except Exception:
                project_root = None

        self.project_root = project_root

        # personal_api_key: This should be a generated Personal API Key, private
        self.personal_api_key = personal_api_key
        if debug:
            # Ensures that debug level messages are logged when debug mode is on.
            # Otherwise, defaults to WARNING level. See https://docs.python.org/3/howto/logging.html#what-happens-if-no-configuration-is-provided
            logging.basicConfig()
            self.log.setLevel(logging.DEBUG)
        else:
            self.log.setLevel(logging.WARNING)

        if before_send is not None:
            if callable(before_send):
                self.before_send = before_send
            else:
                self.log.warning("before_send is not callable, it will be ignored")
                self.before_send = None
        else:
            self.before_send = None

        if self.enable_exception_autocapture:
            self.exception_capture = ExceptionCapture(
                self, integrations=self.exception_autocapture_integrations
            )

        if sync_mode:
            self.consumers = None
        else:
            # On program exit, allow the consumer thread to exit cleanly.
            # This prevents exceptions and a messy shutdown when the
            # interpreter is destroyed before the daemon thread finishes
            # execution. However, it is *not* the same as flushing the queue!
            # To guarantee all messages have been delivered, you'll still need
            # to call flush().
            if send:
                atexit.register(self.join)
            for n in range(thread):
                self.consumers = []
                consumer = Consumer(
                    self.queue,
                    self.api_key,
                    host=self.host,
                    on_error=on_error,
                    flush_at=flush_at,
                    flush_interval=flush_interval,
                    gzip=gzip,
                    retries=max_retries,
                    timeout=timeout,
                    historical_migration=historical_migration,
                )
                self.consumers.append(consumer)

                # if we've disabled sending, just don't start the consumer
                if send:
                    consumer.start()

    @property
    def feature_flags(self):
        """
        Get the local evaluation feature flags.
        """
        return self._feature_flags

    @feature_flags.setter
    def feature_flags(self, flags):
        """
        Set the local evaluation feature flags.
        """
        self._feature_flags = flags or []
        self.feature_flags_by_key = {
            flag["key"]: flag
            for flag in self._feature_flags
            if flag.get("key") is not None
        }
        assert self.feature_flags_by_key is not None, (
            "feature_flags_by_key should be initialized when feature_flags is set"
        )

    def identify(
        self,
        distinct_id=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        properties = properties or {}

        require("distinct_id", distinct_id, ID_TYPES)
        require("properties", properties, dict)

        if "$session_id" not in properties and get_context_session_id():
            properties["$session_id"] = get_context_session_id()

        msg = {
            "timestamp": timestamp,
            "distinct_id": distinct_id,
            "$set": properties,
            "event": "$identify",
            "uuid": uuid,
        }

        return self._enqueue(msg, disable_geoip)

    def get_feature_variants(
        self,
        distinct_id,
        groups=None,
        person_properties=None,
        group_properties=None,
        disable_geoip=None,
    ) -> dict[str, Union[bool, str]]:
        """
        Get feature flag variants for a distinct_id by calling decide.
        """
        resp_data = self.get_flags_decision(
            distinct_id, groups, person_properties, group_properties, disable_geoip
        )
        return to_values(resp_data) or {}

    def get_feature_payloads(
        self,
        distinct_id,
        groups=None,
        person_properties=None,
        group_properties=None,
        disable_geoip=None,
    ) -> dict[str, str]:
        """
        Get feature flag payloads for a distinct_id by calling decide.
        """
        resp_data = self.get_flags_decision(
            distinct_id, groups, person_properties, group_properties, disable_geoip
        )
        return to_payloads(resp_data) or {}

    def get_feature_flags_and_payloads(
        self,
        distinct_id,
        groups=None,
        person_properties=None,
        group_properties=None,
        disable_geoip=None,
    ) -> FlagsAndPayloads:
        """
        Get feature flags and payloads for a distinct_id by calling decide.
        """
        resp = self.get_flags_decision(
            distinct_id, groups, person_properties, group_properties, disable_geoip
        )
        return to_flags_and_payloads(resp)

    def get_flags_decision(
        self,
        distinct_id,
        groups=None,
        person_properties=None,
        group_properties=None,
        disable_geoip=None,
    ) -> FlagsResponse:
        """
        Get feature flags decision, using either flags() or decide() API based on rollout.
        """

        if distinct_id is None:
            distinct_id = get_context_distinct_id()
        require("distinct_id", distinct_id, ID_TYPES)

        if disable_geoip is None:
            disable_geoip = self.disable_geoip

        if groups:
            require("groups", groups, dict)
        else:
            groups = {}

        request_data = {
            "distinct_id": distinct_id,
            "groups": groups,
            "person_properties": person_properties,
            "group_properties": group_properties,
            "geoip_disable": disable_geoip,
        }

        resp_data = flags(
            self.api_key,
            self.host,
            timeout=self.feature_flags_request_timeout_seconds,
            **request_data,
        )

        return normalize_flags_response(resp_data)

    def capture(
        self,
        distinct_id=None,
        event=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        groups=None,
        send_feature_flags=False,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        properties = {**(properties or {}), **system_context()}

        if "$session_id" not in properties and get_context_session_id():
            properties["$session_id"] = get_context_session_id()

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        require("distinct_id", distinct_id, ID_TYPES)
        require("properties", properties, dict)
        require("event", event, string_types)

        current_context = _get_current_context()
        if current_context:
            context_tags = current_context.collect_tags()
            # We want explicitly passed properties to override context tags
            context_tags.update(properties)
            properties = context_tags

        msg = {
            "properties": properties,
            "timestamp": timestamp,
            "distinct_id": distinct_id,
            "event": event,
            "uuid": uuid,
        }

        if groups:
            require("groups", groups, dict)
            msg["properties"]["$groups"] = groups

        extra_properties: dict[str, Any] = {}
        feature_variants: Optional[dict[str, Union[bool, str]]] = {}
        if send_feature_flags:
            try:
                feature_variants = self.get_feature_variants(
                    distinct_id, groups, disable_geoip=disable_geoip
                )
            except Exception as e:
                self.log.exception(
                    f"[FEATURE FLAGS] Unable to get feature variants: {e}"
                )

        elif self.feature_flags and event != "$feature_flag_called":
            # Local evaluation is enabled, flags are loaded, so try and get all flags we can without going to the server
            feature_variants = self.get_all_flags(
                distinct_id,
                groups=(groups or {}),
                disable_geoip=disable_geoip,
                only_evaluate_locally=True,
            )

        for feature, variant in (feature_variants or {}).items():
            extra_properties[f"$feature/{feature}"] = variant

        active_feature_flags = [
            key
            for (key, value) in (feature_variants or {}).items()
            if value is not False
        ]
        if active_feature_flags:
            extra_properties["$active_feature_flags"] = active_feature_flags

        if extra_properties:
            msg["properties"] = {**extra_properties, **msg["properties"]}

        return self._enqueue(msg, disable_geoip)

    def set(
        self,
        distinct_id=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        properties = properties or {}
        require("distinct_id", distinct_id, ID_TYPES)
        require("properties", properties, dict)

        msg = {
            "timestamp": timestamp,
            "distinct_id": distinct_id,
            "$set": properties,
            "event": "$set",
            "uuid": uuid,
        }

        return self._enqueue(msg, disable_geoip)

    def set_once(
        self,
        distinct_id=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        properties = properties or {}
        require("distinct_id", distinct_id, ID_TYPES)
        require("properties", properties, dict)

        msg = {
            "timestamp": timestamp,
            "distinct_id": distinct_id,
            "$set_once": properties,
            "event": "$set_once",
            "uuid": uuid,
        }

        return self._enqueue(msg, disable_geoip)

    def group_identify(
        self,
        group_type=None,
        group_key=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
        distinct_id=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )
        properties = properties or {}
        require("group_type", group_type, ID_TYPES)
        require("group_key", group_key, ID_TYPES)
        require("properties", properties, dict)

        if distinct_id:
            require("distinct_id", distinct_id, ID_TYPES)
        else:
            distinct_id = "${}_{}".format(group_type, group_key)

        msg = {
            "event": "$groupidentify",
            "properties": {
                "$group_type": group_type,
                "$group_key": group_key,
                "$group_set": properties,
            },
            "distinct_id": distinct_id,
            "timestamp": timestamp,
            "uuid": uuid,
        }

        return self._enqueue(msg, disable_geoip)

    def alias(
        self,
        previous_id=None,
        distinct_id=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        require("previous_id", previous_id, ID_TYPES)
        require("distinct_id", distinct_id, ID_TYPES)

        msg = {
            "properties": {
                "distinct_id": previous_id,
                "alias": distinct_id,
            },
            "timestamp": timestamp,
            "event": "$create_alias",
            "distinct_id": previous_id,
        }

        return self._enqueue(msg, disable_geoip)

    def page(
        self,
        distinct_id=None,
        url=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        disable_geoip=None,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        properties = properties or {}
        require("distinct_id", distinct_id, ID_TYPES)
        require("properties", properties, dict)

        if "$session_id" not in properties and get_context_session_id():
            properties["$session_id"] = get_context_session_id()

        require("url", url, string_types)
        properties["$current_url"] = url

        msg = {
            "event": "$pageview",
            "properties": properties,
            "timestamp": timestamp,
            "distinct_id": distinct_id,
            "uuid": uuid,
        }

        return self._enqueue(msg, disable_geoip)

    def capture_exception(
        self,
        exception=None,
        distinct_id=None,
        properties=None,
        context=None,
        timestamp=None,
        uuid=None,
        groups=None,
        **kwargs,
    ):
        if context is not None:
            warnings.warn(
                "The 'context' parameter is deprecated and will be removed in a future version.",
                DeprecationWarning,
                stacklevel=2,
            )

        if distinct_id is None:
            distinct_id = get_context_distinct_id()

        # this function shouldn't ever throw an error, so it logs exceptions instead of raising them.
        # this is important to ensure we don't unexpectedly re-raise exceptions in the user's code.
        try:
            properties = properties or {}

            # Check if this exception has already been captured
            if exception is not None and exception_is_already_captured(exception):
                self.log.debug("Exception already captured, skipping")
                return

            # if there's no distinct_id, we'll generate one and set personless mode
            # via $process_person_profile = false
            if distinct_id is None:
                properties["$process_person_profile"] = False
                distinct_id = uuid4()

            require("distinct_id", distinct_id, ID_TYPES)
            require("properties", properties, dict)

            if exception is not None:
                exc_info = exc_info_from_error(exception)
            else:
                exc_info = sys.exc_info()

            if exc_info is None or exc_info == (None, None, None):
                self.log.warning("No exception information available")
                return

            # Format stack trace for cymbal
            all_exceptions_with_trace = exceptions_from_error_tuple(exc_info)

            # Add in-app property to frames in the exceptions
            event = handle_in_app(
                {
                    "exception": {
                        "values": all_exceptions_with_trace,
                    },
                },
                project_root=self.project_root,
            )
            all_exceptions_with_trace_and_in_app = event["exception"]["values"]

            properties = {
                "$exception_type": all_exceptions_with_trace_and_in_app[0].get("type"),
                "$exception_message": all_exceptions_with_trace_and_in_app[0].get(
                    "value"
                ),
                "$exception_list": all_exceptions_with_trace_and_in_app,
                "$exception_personURL": f"{remove_trailing_slash(self.raw_host)}/project/{self.api_key}/person/{distinct_id}",
                **properties,
            }

            if self.log_captured_exceptions:
                self.log.exception(exception, extra=kwargs)

            res = self.capture(
                distinct_id, "$exception", properties, context, timestamp, uuid, groups
            )

            # Mark the exception as captured to prevent duplicate captures
            if exception is not None:
                mark_exception_as_captured(exception)

            return res
        except Exception as e:
            self.log.exception(f"Failed to capture exception: {e}")

    def _enqueue(self, msg, disable_geoip):
        """Push a new `msg` onto the queue, return `(success, msg)`"""

        if self.disabled:
            return False, "disabled"

        timestamp = msg["timestamp"]
        if timestamp is None:
            timestamp = datetime.now(tz=tzutc())

        require("timestamp", timestamp, datetime)

        # add common
        timestamp = guess_timezone(timestamp)
        msg["timestamp"] = timestamp.isoformat()

        # only send if "uuid" is truthy
        if "uuid" in msg:
            uuid = msg.pop("uuid")
            if uuid:
                msg["uuid"] = stringify_id(uuid)

        if not msg.get("properties"):
            msg["properties"] = {}
        msg["properties"]["$lib"] = "posthog-python"
        msg["properties"]["$lib_version"] = VERSION

        if disable_geoip is None:
            disable_geoip = self.disable_geoip

        if disable_geoip:
            msg["properties"]["$geoip_disable"] = True

        if self.super_properties:
            msg["properties"] = {**msg["properties"], **self.super_properties}

        msg["distinct_id"] = stringify_id(msg.get("distinct_id", None))

        msg = clean(msg)

        if self.before_send:
            try:
                modified_msg = self.before_send(msg)
                if modified_msg is None:
                    self.log.debug("Event dropped by before_send callback")
                    return True, None
                msg = modified_msg
            except Exception as e:
                self.log.exception(f"Error in before_send callback: {e}")
                # Continue with the original message if callback fails

        self.log.debug("queueing: %s", msg)

        # if send is False, return msg as if it was successfully queued
        if not self.send:
            return True, msg

        if self.sync_mode:
            self.log.debug("enqueued with blocking %s.", msg["event"])
            batch_post(
                self.api_key,
                self.host,
                gzip=self.gzip,
                timeout=self.timeout,
                batch=[msg],
                historical_migration=self.historical_migration,
            )

            return True, msg

        try:
            self.queue.put(msg, block=False)
            self.log.debug("enqueued %s.", msg["event"])
            return True, msg
        except queue.Full:
            self.log.warning("analytics-python queue is full")
            return False, msg

    def flush(self):
        """Forces a flush from the internal queue to the server"""
        queue = self.queue
        size = queue.qsize()
        queue.join()
        # Note that this message may not be precise, because of threading.
        self.log.debug("successfully flushed about %s items.", size)

    def join(self):
        """Ends the consumer thread once the queue is empty.
        Blocks execution until finished
        """
        for consumer in self.consumers:
            consumer.pause()
            try:
                consumer.join()
            except RuntimeError:
                # consumer thread has not started
                pass

        if self.poller:
            self.poller.stop()

    def shutdown(self):
        """Flush all messages and cleanly shutdown the client"""
        self.flush()
        self.join()

        if self.exception_capture:
            self.exception_capture.close()

    def _load_feature_flags(self):
        try:
            response = get(
                self.personal_api_key,
                f"/api/feature_flag/local_evaluation/?token={self.api_key}&send_cohorts",
                self.host,
                timeout=10,
            )

            self.feature_flags = response["flags"] or []
            self.group_type_mapping = response["group_type_mapping"] or {}
            self.cohorts = response["cohorts"] or {}

        except APIError as e:
            if e.status == 401:
                self.log.error(
                    "[FEATURE FLAGS] Error loading feature flags: To use feature flags, please set a valid personal_api_key. More information: https://posthog.com/docs/api/overview"
                )
                if self.debug:
                    raise APIError(
                        status=401,
                        message="You are using a write-only key with feature flags. "
                        "To use feature flags, please set a personal_api_key "
                        "More information: https://posthog.com/docs/api/overview",
                    )
            elif e.status == 402:
                self.log.warning(
                    "[FEATURE FLAGS] PostHog feature flags quota limited, resetting feature flag data.  Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts"
                )
                # Reset all feature flag data when quota limited
                self.feature_flags = []
                self.group_type_mapping = {}
                self.cohorts = {}

                if self.debug:
                    raise APIError(
                        status=402,
                        message="PostHog feature flags quota limited",
                    )
            else:
                self.log.error(f"[FEATURE FLAGS] Error loading feature flags: {e}")
        except Exception as e:
            self.log.warning(
                "[FEATURE FLAGS] Fetching feature flags failed with following error. We will retry in %s seconds."
                % self.poll_interval
            )
            self.log.warning(e)

        self._last_feature_flag_poll = datetime.now(tz=tzutc())

    def load_feature_flags(self):
        if not self.personal_api_key:
            self.log.warning(
                "[FEATURE FLAGS] You have to specify a personal_api_key to use feature flags."
            )
            self.feature_flags = []
            return

        self._load_feature_flags()
        if not (self.poller and self.poller.is_alive()):
            self.poller = Poller(
                interval=timedelta(seconds=self.poll_interval),
                execute=self._load_feature_flags,
            )
            self.poller.start()

    def _compute_flag_locally(
        self,
        feature_flag,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        warn_on_unknown_groups=True,
    ) -> FlagValue:
        if feature_flag.get("ensure_experience_continuity", False):
            raise InconclusiveMatchError("Flag has experience continuity enabled")

        if not feature_flag.get("active"):
            return False

        flag_filters = feature_flag.get("filters") or {}
        aggregation_group_type_index = flag_filters.get("aggregation_group_type_index")
        if aggregation_group_type_index is not None:
            group_name = self.group_type_mapping.get(str(aggregation_group_type_index))

            if not group_name:
                self.log.warning(
                    f"[FEATURE FLAGS] Unknown group type index {aggregation_group_type_index} for feature flag {feature_flag['key']}"
                )
                # failover to `/decide/`
                raise InconclusiveMatchError("Flag has unknown group type index")

            if group_name not in groups:
                # Group flags are never enabled in `groups` aren't passed in
                # don't failover to `/decide/`, since response will be the same
                if warn_on_unknown_groups:
                    self.log.warning(
                        f"[FEATURE FLAGS] Can't compute group feature flag: {feature_flag['key']} without group names passed in"
                    )
                else:
                    self.log.debug(
                        f"[FEATURE FLAGS] Can't compute group feature flag: {feature_flag['key']} without group names passed in"
                    )
                return False

            focused_group_properties = group_properties[group_name]
            return match_feature_flag_properties(
                feature_flag, groups[group_name], focused_group_properties
            )
        else:
            return match_feature_flag_properties(
                feature_flag, distinct_id, person_properties, self.cohorts
            )

    def feature_enabled(
        self,
        key,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        send_feature_flag_events=True,
        disable_geoip=None,
    ):
        response = self.get_feature_flag(
            key,
            distinct_id,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
            only_evaluate_locally=only_evaluate_locally,
            send_feature_flag_events=send_feature_flag_events,
            disable_geoip=disable_geoip,
        )

        if response is None:
            return None
        return bool(response)

    def _get_feature_flag_result(
        self,
        key,
        distinct_id,
        *,
        override_match_value: Optional[FlagValue] = None,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        send_feature_flag_events=True,
        disable_geoip=None,
    ) -> Optional[FeatureFlagResult]:
        require("key", key, string_types)
        require("distinct_id", distinct_id, ID_TYPES)
        require("groups", groups, dict)

        if self.disabled:
            return None

        person_properties, group_properties = (
            self._add_local_person_and_group_properties(
                distinct_id, groups, person_properties, group_properties
            )
        )

        flag_result = None
        flag_details = None
        request_id = None

        flag_value = self._locally_evaluate_flag(
            key, distinct_id, groups, person_properties, group_properties
        )
        flag_was_locally_evaluated = flag_value is not None

        if flag_was_locally_evaluated:
            lookup_match_value = override_match_value or flag_value
            payload = (
                self._compute_payload_locally(key, lookup_match_value)
                if lookup_match_value
                else None
            )
            flag_result = FeatureFlagResult.from_value_and_payload(
                key, lookup_match_value, payload
            )
        elif not only_evaluate_locally:
            try:
                flag_details, request_id = self._get_feature_flag_details_from_decide(
                    key,
                    distinct_id,
                    groups,
                    person_properties,
                    group_properties,
                    disable_geoip,
                )
                flag_result = FeatureFlagResult.from_flag_details(
                    flag_details, override_match_value
                )
                self.log.debug(
                    f"Successfully computed flag remotely: #{key} -> #{flag_result}"
                )
            except Exception as e:
                self.log.exception(f"[FEATURE FLAGS] Unable to get flag remotely: {e}")

        if send_feature_flag_events:
            self._capture_feature_flag_called(
                distinct_id,
                key,
                flag_result.get_value() if flag_result else None,
                flag_result.payload if flag_result else None,
                flag_was_locally_evaluated,
                groups,
                disable_geoip,
                request_id,
                flag_details,
            )

        return flag_result

    def get_feature_flag_result(
        self,
        key,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        send_feature_flag_events=True,
        disable_geoip=None,
    ) -> Optional[FeatureFlagResult]:
        """
        Get a FeatureFlagResult object which contains the flag result and payload for a key by evaluating locally or remotely
        depending on whether local evaluation is enabled and the flag can be locally evaluated.

        This also captures the $feature_flag_called event unless send_feature_flag_events is False.
        """
        return self._get_feature_flag_result(
            key,
            distinct_id,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
            only_evaluate_locally=only_evaluate_locally,
            send_feature_flag_events=send_feature_flag_events,
            disable_geoip=disable_geoip,
        )

    def get_feature_flag(
        self,
        key,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        send_feature_flag_events=True,
        disable_geoip=None,
    ) -> Optional[FlagValue]:
        """
        Get a feature flag value for a key by evaluating locally or remotely
        depending on whether local evaluation is enabled and the flag can be
        locally evaluated.

        This also captures the $feature_flag_called event unless send_feature_flag_events is False.
        """
        feature_flag_result = self.get_feature_flag_result(
            key,
            distinct_id,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
            only_evaluate_locally=only_evaluate_locally,
            send_feature_flag_events=send_feature_flag_events,
            disable_geoip=disable_geoip,
        )
        return feature_flag_result.get_value() if feature_flag_result else None

    def _locally_evaluate_flag(
        self,
        key: str,
        distinct_id: str,
        groups: dict[str, str],
        person_properties: dict[str, str],
        group_properties: dict[str, str],
    ) -> Optional[FlagValue]:
        if self.feature_flags is None and self.personal_api_key:
            self.load_feature_flags()
        response = None

        if self.feature_flags:
            assert self.feature_flags_by_key is not None, (
                "feature_flags_by_key should be initialized when feature_flags is set"
            )
            # Local evaluation
            flag = self.feature_flags_by_key.get(key)
            if flag:
                try:
                    response = self._compute_flag_locally(
                        flag,
                        distinct_id,
                        groups=groups,
                        person_properties=person_properties,
                        group_properties=group_properties,
                    )
                    self.log.debug(
                        f"Successfully computed flag locally: {key} -> {response}"
                    )
                except InconclusiveMatchError as e:
                    self.log.debug(f"Failed to compute flag {key} locally: {e}")
                except Exception as e:
                    self.log.exception(
                        f"[FEATURE FLAGS] Error while computing variant locally: {e}"
                    )
        return response

    def get_feature_flag_payload(
        self,
        key,
        distinct_id,
        *,
        match_value: Optional[FlagValue] = None,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        send_feature_flag_events=True,
        disable_geoip=None,
    ):
        feature_flag_result = self._get_feature_flag_result(
            key,
            distinct_id,
            override_match_value=match_value,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
            only_evaluate_locally=only_evaluate_locally,
            send_feature_flag_events=send_feature_flag_events,
            disable_geoip=disable_geoip,
        )
        return feature_flag_result.payload if feature_flag_result else None

    def _get_feature_flag_details_from_decide(
        self,
        key: str,
        distinct_id: str,
        groups: dict[str, str],
        person_properties: dict[str, str],
        group_properties: dict[str, str],
        disable_geoip: Optional[bool],
    ) -> tuple[Optional[FeatureFlag], Optional[str]]:
        """
        Calls /decide and returns the flag details and request id
        """
        resp_data = self.get_flags_decision(
            distinct_id, groups, person_properties, group_properties, disable_geoip
        )
        request_id = resp_data.get("requestId")
        flags = resp_data.get("flags")
        flag_details = flags.get(key) if flags else None
        return flag_details, request_id

    def _capture_feature_flag_called(
        self,
        distinct_id: str,
        key: str,
        response: Optional[FlagValue],
        payload: Optional[str],
        flag_was_locally_evaluated: bool,
        groups: dict[str, str],
        disable_geoip: Optional[bool],
        request_id: Optional[str],
        flag_details: Optional[FeatureFlag],
    ):
        feature_flag_reported_key = (
            f"{key}_{'::null::' if response is None else str(response)}"
        )

        if (
            feature_flag_reported_key
            not in self.distinct_ids_feature_flags_reported[distinct_id]
        ):
            properties: dict[str, Any] = {
                "$feature_flag": key,
                "$feature_flag_response": response,
                "locally_evaluated": flag_was_locally_evaluated,
                f"$feature/{key}": response,
            }

            if payload:
                # if payload is not a string, json serialize it to a string
                properties["$feature_flag_payload"] = payload

            if request_id:
                properties["$feature_flag_request_id"] = request_id
            if isinstance(flag_details, FeatureFlag):
                if flag_details.reason and flag_details.reason.description:
                    properties["$feature_flag_reason"] = flag_details.reason.description
                if isinstance(flag_details.metadata, FlagMetadata):
                    if flag_details.metadata.version:
                        properties["$feature_flag_version"] = (
                            flag_details.metadata.version
                        )
                    if flag_details.metadata.id:
                        properties["$feature_flag_id"] = flag_details.metadata.id

            self.capture(
                distinct_id,
                "$feature_flag_called",
                properties,
                groups=groups,
                disable_geoip=disable_geoip,
            )
            self.distinct_ids_feature_flags_reported[distinct_id].add(
                feature_flag_reported_key
            )

    def get_remote_config_payload(self, key: str):
        if self.disabled:
            return None

        if self.personal_api_key is None:
            self.log.warning(
                "[FEATURE FLAGS] You have to specify a personal_api_key to fetch decrypted feature flag payloads."
            )
            return None

        try:
            return remote_config(
                self.personal_api_key,
                self.host,
                key,
                timeout=self.feature_flags_request_timeout_seconds,
            )
        except Exception as e:
            self.log.exception(
                f"[FEATURE FLAGS] Unable to get decrypted feature flag payload: {e}"
            )

    def _compute_payload_locally(
        self, key: str, match_value: FlagValue
    ) -> Optional[str]:
        payload = None

        if self.feature_flags_by_key is None:
            return payload

        flag_definition = self.feature_flags_by_key.get(key)
        if flag_definition:
            flag_filters = flag_definition.get("filters") or {}
            flag_payloads = flag_filters.get("payloads") or {}
            # For boolean flags, convert True to "true"
            # For multivariate flags, use the variant string as-is
            lookup_value = (
                "true"
                if isinstance(match_value, bool) and match_value
                else str(match_value)
            )
            payload = flag_payloads.get(lookup_value, None)
        return payload

    def get_all_flags(
        self,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        disable_geoip=None,
    ) -> Optional[dict[str, Union[bool, str]]]:
        response = self.get_all_flags_and_payloads(
            distinct_id,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
            only_evaluate_locally=only_evaluate_locally,
            disable_geoip=disable_geoip,
        )

        return response["featureFlags"]

    def get_all_flags_and_payloads(
        self,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        only_evaluate_locally=False,
        disable_geoip=None,
    ) -> FlagsAndPayloads:
        if self.disabled:
            return {"featureFlags": None, "featureFlagPayloads": None}

        person_properties, group_properties = (
            self._add_local_person_and_group_properties(
                distinct_id, groups, person_properties, group_properties
            )
        )

        response, fallback_to_decide = self._get_all_flags_and_payloads_locally(
            distinct_id,
            groups=groups,
            person_properties=person_properties,
            group_properties=group_properties,
        )

        if fallback_to_decide and not only_evaluate_locally:
            try:
                decide_response = self.get_flags_decision(
                    distinct_id,
                    groups=groups,
                    person_properties=person_properties,
                    group_properties=group_properties,
                    disable_geoip=disable_geoip,
                )
                return to_flags_and_payloads(decide_response)
            except Exception as e:
                self.log.exception(
                    f"[FEATURE FLAGS] Unable to get feature flags and payloads: {e}"
                )

        return response

    def _get_all_flags_and_payloads_locally(
        self,
        distinct_id,
        *,
        groups={},
        person_properties={},
        group_properties={},
        warn_on_unknown_groups=False,
    ) -> tuple[FlagsAndPayloads, bool]:
        require("distinct_id", distinct_id, ID_TYPES)
        require("groups", groups, dict)

        if self.feature_flags is None and self.personal_api_key:
            self.load_feature_flags()

        flags: dict[str, FlagValue] = {}
        payloads: dict[str, str] = {}
        fallback_to_decide = False
        # If loading in previous line failed
        if self.feature_flags:
            for flag in self.feature_flags:
                try:
                    flags[flag["key"]] = self._compute_flag_locally(
                        flag,
                        distinct_id,
                        groups=groups,
                        person_properties=person_properties,
                        group_properties=group_properties,
                        warn_on_unknown_groups=warn_on_unknown_groups,
                    )
                    matched_payload = self._compute_payload_locally(
                        flag["key"], flags[flag["key"]]
                    )
                    if matched_payload:
                        payloads[flag["key"]] = matched_payload
                except InconclusiveMatchError:
                    # No need to log this, since it's just telling us to fall back to `/decide`
                    fallback_to_decide = True
                except Exception as e:
                    self.log.exception(
                        f"[FEATURE FLAGS] Error while computing variant and payload: {e}"
                    )
                    fallback_to_decide = True
        else:
            fallback_to_decide = True

        return {
            "featureFlags": flags,
            "featureFlagPayloads": payloads,
        }, fallback_to_decide

    def feature_flag_definitions(self):
        return self.feature_flags

    def _add_local_person_and_group_properties(
        self, distinct_id, groups, person_properties, group_properties
    ):
        all_person_properties = {
            "distinct_id": distinct_id,
            **(person_properties or {}),
        }

        all_group_properties = {}
        if groups:
            for group_name in groups:
                all_group_properties[group_name] = {
                    "$group_key": groups[group_name],
                    **(group_properties.get(group_name) or {}),
                }

        return all_person_properties, all_group_properties


def require(name, field, data_type):
    """Require that the named `field` has the right `data_type`"""
    if not isinstance(field, data_type):
        msg = "{0} must have {1}, got: {2}".format(name, data_type, field)
        raise AssertionError(msg)


def stringify_id(val):
    if val is None:
        return None
    if isinstance(val, string_types):
        return val
    return str(val)

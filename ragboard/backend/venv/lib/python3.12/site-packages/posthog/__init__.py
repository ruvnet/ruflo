import datetime  # noqa: F401
import warnings
from typing import Callable, Dict, List, Optional, Tuple  # noqa: F401

from posthog.client import Client
from posthog.exception_capture import Integrations  # noqa: F401
from posthog.scopes import (
    clear_tags,
    get_tags,
    new_context,
    scoped,
    tag,
    set_context_session,
    identify_context,
)
from posthog.types import FeatureFlag, FlagsAndPayloads
from posthog.version import VERSION

__version__ = VERSION

"""Context management."""
new_context = new_context
tag = tag
get_tags = get_tags
clear_tags = clear_tags
scoped = scoped
identify_context = identify_context
set_context_session = set_context_session


"""Settings."""
api_key = None  # type: Optional[str]
host = None  # type: Optional[str]
on_error = None  # type: Optional[Callable]
debug = False  # type: bool
send = True  # type: bool
sync_mode = False  # type: bool
disabled = False  # type: bool
personal_api_key = None  # type: Optional[str]
project_api_key = None  # type: Optional[str]
poll_interval = 30  # type: int
disable_geoip = True  # type: bool
feature_flags_request_timeout_seconds = 3  # type: int
super_properties = None  # type: Optional[Dict]
# Currently alpha, use at your own risk
enable_exception_autocapture = False  # type: bool
exception_autocapture_integrations = []  # type: List[Integrations]
log_captured_exceptions = False  # type: bool
# Used to determine in app paths for exception autocapture. Defaults to the current working directory
project_root = None  # type: Optional[str]
# Used for our AI observability feature to not capture any prompt or output just usage + metadata
privacy_mode = False  # type: bool

default_client = None  # type: Optional[Client]


def capture(
    distinct_id,  # type: str
    event,  # type: str
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    groups=None,  # type: Optional[Dict]
    send_feature_flags=False,
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    Capture allows you to capture anything a user does within your system, which you can later use in PostHog to find patterns in usage, work out which features to improve or where people are giving up.

    A `capture` call requires
    - `distinct id` which uniquely identifies your user
    - `event name` to specify the event
    - We recommend using [verb] [noun], like `movie played` or `movie updated` to easily identify what your events mean later on.

    Optionally you can submit
    - `properties`, which can be a dict with any information you'd like to add
    - `groups`, which is a dict of group type -> group key mappings

    For example:
    ```python
    posthog.capture('distinct id', 'opened app')
    posthog.capture('distinct id', 'movie played', {'movie_id': '123', 'category': 'romcom'})

    posthog.capture('distinct id', 'purchase', groups={'company': 'id:5'})
    ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "capture",
        distinct_id=distinct_id,
        event=event,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        groups=groups,
        send_feature_flags=send_feature_flags,
        disable_geoip=disable_geoip,
    )


def identify(
    distinct_id,  # type: str
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    Identify lets you add metadata on your users so you can more easily identify who they are in PostHog, and even do things like segment users by these properties.

    An `identify` call requires
    - `distinct id` which uniquely identifies your user
    - `properties` with a dict with any key: value pairs

    For example:
    ```python
    posthog.identify('distinct id', {
        'email': 'dwayne@gmail.com',
        'name': 'Dwayne Johnson'
    })
    ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "identify",
        distinct_id=distinct_id,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        disable_geoip=disable_geoip,
    )


def set(
    distinct_id,  # type: str
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    Set properties on a user record.
    This will overwrite previous people property values, just like `identify`.

     A `set` call requires
     - `distinct id` which uniquely identifies your user
     - `properties` with a dict with any key: value pairs

     For example:
     ```python
     posthog.set('distinct id', {
         'current_browser': 'Chrome',
     })
     ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "set",
        distinct_id=distinct_id,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        disable_geoip=disable_geoip,
    )


def set_once(
    distinct_id,  # type: str
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    Set properties on a user record, only if they do not yet exist.
    This will not overwrite previous people property values, unlike `identify`.

     A `set_once` call requires
     - `distinct id` which uniquely identifies your user
     - `properties` with a dict with any key: value pairs

     For example:
     ```python
     posthog.set_once('distinct id', {
         'referred_by': 'friend',
     })
     ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "set_once",
        distinct_id=distinct_id,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        disable_geoip=disable_geoip,
    )


def group_identify(
    group_type,  # type: str
    group_key,  # type: str
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    Set properties on a group

     A `group_identify` call requires
     - `group_type` type of your group
     - `group_key` unique identifier of the group
     - `properties` with a dict with any key: value pairs

     For example:
     ```python
     posthog.group_identify('company', 5, {
         'employees': 11,
     })
     ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "group_identify",
        group_type=group_type,
        group_key=group_key,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        disable_geoip=disable_geoip,
    )


def alias(
    previous_id,  # type: str
    distinct_id,  # type: str
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> Tuple[bool, dict]
    """
    To marry up whatever a user does before they sign up or log in with what they do after you need to make an alias call. This will allow you to answer questions like "Which marketing channels leads to users churning after a month?" or "What do users do on our website before signing up?"

    In a purely back-end implementation, this means whenever an anonymous user does something, you'll want to send a session ID ([Django](https://stackoverflow.com/questions/526179/in-django-how-can-i-find-out-the-request-session-sessionid-and-use-it-as-a-vari), [Flask](https://stackoverflow.com/questions/15156132/flask-login-how-to-get-session-id)) with the capture call. Then, when that users signs up, you want to do an alias call with the session ID and the newly created user ID.

    The same concept applies for when a user logs in.

    An `alias` call requires
    - `previous distinct id` the unique ID of the user before
    - `distinct id` the current unique id

    For example:
    ```python
    posthog.alias('anonymous session id', 'distinct id')
    ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "alias",
        previous_id=previous_id,
        distinct_id=distinct_id,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        disable_geoip=disable_geoip,
    )


def capture_exception(
    exception=None,  # type: Optional[BaseException]
    distinct_id=None,  # type: Optional[str]
    properties=None,  # type: Optional[Dict]
    context=None,  # type: Optional[Dict]
    timestamp=None,  # type: Optional[datetime.datetime]
    uuid=None,  # type: Optional[str]
    groups=None,  # type: Optional[Dict]
    **kwargs,
):
    # type: (...) -> Tuple[bool, dict]
    """
    capture_exception allows you to capture exceptions that happen in your code. This is useful for debugging and understanding what errors your users are encountering.
    This function never raises an exception, even if it fails to send the event.

    A `capture_exception` call does not require any fields, but we recommend sending:
    - `distinct id` which uniquely identifies your user for which this exception happens
    - `exception` to specify the exception to capture. If not provided, the current exception is captured via `sys.exc_info()`

    Optionally you can submit
    - `properties`, which can be a dict with any information you'd like to add
    - `groups`, which is a dict of group type -> group key mappings
    - remaining `kwargs` will be logged if `log_captured_exceptions` is enabled

    For example:
    ```python
    try:
        1 / 0
    except Exception as e:
        posthog.capture_exception(e, 'my specific distinct id')
        posthog.capture_exception(distinct_id='my specific distinct id')

    ```
    """

    if context is not None:
        warnings.warn(
            "The 'context' parameter is deprecated and will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )

    return _proxy(
        "capture_exception",
        exception=exception,
        distinct_id=distinct_id,
        properties=properties,
        context=context,
        timestamp=timestamp,
        uuid=uuid,
        groups=groups,
        **kwargs,
    )


def feature_enabled(
    key,  # type: str
    distinct_id,  # type: str
    groups={},  # type: dict
    person_properties={},  # type: dict
    group_properties={},  # type: dict
    only_evaluate_locally=False,  # type: bool
    send_feature_flag_events=True,  # type: bool
    disable_geoip=None,  # type: Optional[bool]
):
    # type: (...) -> bool
    """
    Use feature flags to enable or disable features for users.

    For example:
    ```python
    if posthog.feature_enabled('beta feature', 'distinct id'):
        # do something
    if posthog.feature_enabled('groups feature', 'distinct id', groups={"organization": "5"}):
        # do something
    ```

    You can call `posthog.load_feature_flags()` before to make sure you're not doing unexpected requests.
    """
    return _proxy(
        "feature_enabled",
        key=key,
        distinct_id=distinct_id,
        groups=groups,
        person_properties=person_properties,
        group_properties=group_properties,
        only_evaluate_locally=only_evaluate_locally,
        send_feature_flag_events=send_feature_flag_events,
        disable_geoip=disable_geoip,
    )


def get_feature_flag(
    key,  # type: str
    distinct_id,  # type: str
    groups={},  # type: dict
    person_properties={},  # type: dict
    group_properties={},  # type: dict
    only_evaluate_locally=False,  # type: bool
    send_feature_flag_events=True,  # type: bool
    disable_geoip=None,  # type: Optional[bool]
) -> Optional[FeatureFlag]:
    """
    Get feature flag variant for users. Used with experiments.
    Example:
    ```python
    if posthog.get_feature_flag('beta-feature', 'distinct_id') == 'test-variant':
        # do test variant code
    if posthog.get_feature_flag('beta-feature', 'distinct_id') == 'control':
        # do control code
    ```

    `groups` are a mapping from group type to group key. So, if you have a group type of "organization" and a group key of "5",
    you would pass groups={"organization": "5"}.

    `group_properties` take the format: { group_type_name: { group_properties } }

    So, for example, if you have the group type "organization" and the group key "5", with the properties name, and employee count,
    you'll send these as:

    ```python
        group_properties={"organization": {"name": "PostHog", "employees": 11}}
    ```
    """
    return _proxy(
        "get_feature_flag",
        key=key,
        distinct_id=distinct_id,
        groups=groups,
        person_properties=person_properties,
        group_properties=group_properties,
        only_evaluate_locally=only_evaluate_locally,
        send_feature_flag_events=send_feature_flag_events,
        disable_geoip=disable_geoip,
    )


def get_all_flags(
    distinct_id,  # type: str
    groups={},  # type: dict
    person_properties={},  # type: dict
    group_properties={},  # type: dict
    only_evaluate_locally=False,  # type: bool
    disable_geoip=None,  # type: Optional[bool]
) -> Optional[dict[str, FeatureFlag]]:
    """
    Get all flags for a given user.
    Example:
    ```python
    flags = posthog.get_all_flags('distinct_id')
    ```

    flags are key-value pairs where the key is the flag key and the value is the flag variant, or True, or False.
    """
    return _proxy(
        "get_all_flags",
        distinct_id=distinct_id,
        groups=groups,
        person_properties=person_properties,
        group_properties=group_properties,
        only_evaluate_locally=only_evaluate_locally,
        disable_geoip=disable_geoip,
    )


def get_feature_flag_payload(
    key,
    distinct_id,
    match_value=None,
    groups={},
    person_properties={},
    group_properties={},
    only_evaluate_locally=False,
    send_feature_flag_events=True,
    disable_geoip=None,  # type: Optional[bool]
) -> Optional[str]:
    return _proxy(
        "get_feature_flag_payload",
        key=key,
        distinct_id=distinct_id,
        match_value=match_value,
        groups=groups,
        person_properties=person_properties,
        group_properties=group_properties,
        only_evaluate_locally=only_evaluate_locally,
        send_feature_flag_events=send_feature_flag_events,
        disable_geoip=disable_geoip,
    )


def get_remote_config_payload(
    key,  # type: str
):
    """Get the payload for a remote config feature flag.

    Args:
        key: The key of the feature flag

    Returns:
        The payload associated with the feature flag. If payload is encrypted, the return value will decrypted

    Note:
        Requires personal_api_key to be set for authentication
    """
    return _proxy(
        "get_remote_config_payload",
        key=key,
    )


def get_all_flags_and_payloads(
    distinct_id,
    groups={},
    person_properties={},
    group_properties={},
    only_evaluate_locally=False,
    disable_geoip=None,  # type: Optional[bool]
) -> FlagsAndPayloads:
    return _proxy(
        "get_all_flags_and_payloads",
        distinct_id=distinct_id,
        groups=groups,
        person_properties=person_properties,
        group_properties=group_properties,
        only_evaluate_locally=only_evaluate_locally,
        disable_geoip=disable_geoip,
    )


def feature_flag_definitions():
    """Returns loaded feature flags, if any. Helpful for debugging what flag information you have loaded."""
    return _proxy("feature_flag_definitions")


def load_feature_flags():
    """Load feature flag definitions from PostHog."""
    return _proxy("load_feature_flags")


def page(*args, **kwargs):
    """Send a page call."""
    _proxy("page", *args, **kwargs)


def screen(*args, **kwargs):
    """Send a screen call."""
    _proxy("screen", *args, **kwargs)


def flush():
    """Tell the client to flush."""
    _proxy("flush")


def join():
    """Block program until the client clears the queue"""
    _proxy("join")


def shutdown():
    """Flush all messages and cleanly shutdown the client"""
    _proxy("flush")
    _proxy("join")


def setup():
    global default_client
    if not default_client:
        default_client = Client(
            api_key,
            host=host,
            debug=debug,
            on_error=on_error,
            send=send,
            sync_mode=sync_mode,
            personal_api_key=personal_api_key,
            project_api_key=project_api_key,
            poll_interval=poll_interval,
            disabled=disabled,
            disable_geoip=disable_geoip,
            feature_flags_request_timeout_seconds=feature_flags_request_timeout_seconds,
            super_properties=super_properties,
            # TODO: Currently this monitoring begins only when the Client is initialised (which happens when you do something with the SDK)
            # This kind of initialisation is very annoying for exception capture. We need to figure out a way around this,
            # or deprecate this proxy option fully (it's already in the process of deprecation, no new clients should be using this method since like 5-6 months)
            enable_exception_autocapture=enable_exception_autocapture,
            log_captured_exceptions=log_captured_exceptions,
            exception_autocapture_integrations=exception_autocapture_integrations,
        )

    # always set incase user changes it
    default_client.disabled = disabled
    default_client.debug = debug


def _proxy(method, *args, **kwargs):
    """Create an analytics client if one doesn't exist and send to it."""
    setup()

    fn = getattr(default_client, method)
    return fn(*args, **kwargs)


class Posthog(Client):
    pass

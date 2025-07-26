# Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
# Licensed under the MIT License

# 💖open source (under MIT License)

import re
import sys
from typing import TYPE_CHECKING

from posthog.exception_integrations import IntegrationEnablingError

try:
    from django import VERSION as DJANGO_VERSION
    from django.core import signals

except ImportError:
    raise IntegrationEnablingError("Django not installed")


if TYPE_CHECKING:
    from typing import Any, Dict  # noqa: F401

    from django.core.handlers.wsgi import WSGIRequest  # noqa: F401


class DjangoIntegration:
    # TODO: Abstract integrations one we have more and can see patterns
    """
    Autocapture errors from a Django application.
    """

    identifier = "django"

    def __init__(self, capture_exception_fn=None):
        if DJANGO_VERSION < (4, 2):
            raise IntegrationEnablingError("Django 4.2 or newer is required.")

        # TODO: Right now this seems too complicated / overkill for us, but seems like we can automatically plug in middlewares
        # which is great for users (they don't need to do this) and everything should just work.
        # We should consider this in the future, but for now we can just use the middleware and signals handlers.
        # See: https://github.com/getsentry/sentry-python/blob/269d96d6e9821122fbff280e6a26956e5ed03c0b/sentry_sdk/integrations/django/__init__.py

        self.capture_exception_fn = capture_exception_fn

        def _got_request_exception(request=None, **kwargs):
            # type: (WSGIRequest, **Any) -> None

            extra_props = {}
            if request is not None:
                # get headers metadata
                extra_props = DjangoRequestExtractor(request).extract_person_data()

            self.capture_exception_fn(sys.exc_info(), extra_props)

        signals.got_request_exception.connect(_got_request_exception)

    def uninstall(self):
        pass


class DjangoRequestExtractor:
    def __init__(self, request):
        # type: (Any) -> None
        self.request = request

    def extract_person_data(self):
        headers = self.headers()

        # Extract traceparent and tracestate headers
        traceparent = headers.get("Traceparent")
        tracestate = headers.get("Tracestate")

        # Extract the distinct_id from tracestate
        distinct_id = None
        if tracestate:
            # TODO: Align on the format of the distinct_id in tracestate
            # We can't have comma or equals in header values here, so maybe we should base64 encode it?
            match = re.search(r"posthog-distinct-id=([^,]+)", tracestate)
            if match:
                distinct_id = match.group(1)

        return {
            **self.user(),
            "distinct_id": distinct_id,
            "ip": headers.get("X-Forwarded-For"),
            "user_agent": headers.get("User-Agent"),
            "traceparent": traceparent,
            "$request_path": self.request.path,
        }

    def user(self):
        user_data: dict[str, str] = {}

        user = getattr(self.request, "user", None)

        if user is None or not user.is_authenticated:
            return user_data

        try:
            user_id = str(user.pk)
            if user_id:
                user_data.setdefault("$user_id", user_id)
        except Exception:
            pass

        try:
            email = str(user.email)
            if email:
                user_data.setdefault("email", email)
        except Exception:
            pass

        return user_data

    def headers(self):
        # type: () -> Dict[str, str]
        return dict(self.request.headers)

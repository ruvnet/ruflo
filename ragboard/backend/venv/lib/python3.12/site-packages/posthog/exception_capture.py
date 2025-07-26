# Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
# Licensed under the MIT License

# 💖open source (under MIT License)

import logging
import sys
import threading
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from posthog.client import Client


class Integrations(str, Enum):
    Django = "django"


class ExceptionCapture:
    # TODO: Add client side rate limiting to prevent spamming the server with exceptions

    log = logging.getLogger("posthog")

    def __init__(
        self, client: "Client", integrations: Optional[List[Integrations]] = None
    ):
        self.client = client
        self.original_excepthook = sys.excepthook
        sys.excepthook = self.exception_handler
        threading.excepthook = self.thread_exception_handler
        self.enabled_integrations = []

        for integration in integrations or []:
            # TODO: Maybe find a better way of enabling integrations
            # This is very annoying currently if we had to add any configuration per integration
            if integration == Integrations.Django:
                try:
                    from posthog.exception_integrations.django import DjangoIntegration

                    enabled_integration = DjangoIntegration(self.exception_receiver)
                    self.enabled_integrations.append(enabled_integration)
                except Exception as e:
                    self.log.exception(f"Failed to enable Django integration: {e}")

    def close(self):
        sys.excepthook = self.original_excepthook
        for integration in self.enabled_integrations:
            integration.uninstall()

    def exception_handler(self, exc_type, exc_value, exc_traceback):
        # don't affect default behaviour.
        self.capture_exception((exc_type, exc_value, exc_traceback))
        self.original_excepthook(exc_type, exc_value, exc_traceback)

    def thread_exception_handler(self, args):
        self.capture_exception((args.exc_type, args.exc_value, args.exc_traceback))

    def exception_receiver(self, exc_info, extra_properties):
        if "distinct_id" in extra_properties:
            metadata = {"distinct_id": extra_properties["distinct_id"]}
        else:
            metadata = None
        self.capture_exception((exc_info[0], exc_info[1], exc_info[2]), metadata)

    def capture_exception(self, exception, metadata=None):
        try:
            distinct_id = metadata.get("distinct_id") if metadata else None
            self.client.capture_exception(exception, distinct_id)
        except Exception as e:
            self.log.exception(f"Failed to capture exception: {e}")

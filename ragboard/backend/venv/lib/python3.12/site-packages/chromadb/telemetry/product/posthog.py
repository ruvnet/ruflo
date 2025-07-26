import posthog
import logging
import sys
from typing import Any, Dict, Set
from chromadb.config import System
from chromadb.telemetry.product import (
    ProductTelemetryClient,
    ProductTelemetryEvent,
)
from overrides import override

logger = logging.getLogger(__name__)

POSTHOG_EVENT_SETTINGS = {"$process_person_profile": False}


class Posthog(ProductTelemetryClient):
    def __init__(self, system: System):
        if not system.settings.anonymized_telemetry or "pytest" in sys.modules:
            posthog.disabled = True
        else:
            logger.info(
                "Anonymized telemetry enabled. See \
                    https://docs.trychroma.com/telemetry for more information."
            )

        posthog.project_api_key = "phc_YeUxaojbKk5KPi8hNlx1bBKHzuZ4FDtl67kH1blv8Bh"
        posthog_logger = logging.getLogger("posthog")
        # Silence posthog's logging
        posthog_logger.disabled = True

        self.batched_events: Dict[str, ProductTelemetryEvent] = {}
        self.seen_event_types: Set[Any] = set()

        super().__init__(system)

    @override
    def capture(self, event: ProductTelemetryEvent) -> None:
        if event.max_batch_size == 1 or event.batch_key not in self.seen_event_types:
            self.seen_event_types.add(event.batch_key)
            self._direct_capture(event)
            return
        batch_key = event.batch_key
        if batch_key not in self.batched_events:
            self.batched_events[batch_key] = event
            return
        batched_event = self.batched_events[batch_key].batch(event)
        self.batched_events[batch_key] = batched_event
        if batched_event.batch_size >= batched_event.max_batch_size:
            self._direct_capture(batched_event)
            del self.batched_events[batch_key]

    def _direct_capture(self, event: ProductTelemetryEvent) -> None:
        try:
            posthog.capture(
                self.user_id,
                event.name,
                {**event.properties, **POSTHOG_EVENT_SETTINGS, **self.context},
            )
        except Exception as e:
            logger.error(f"Failed to send telemetry event {event.name}: {e}")

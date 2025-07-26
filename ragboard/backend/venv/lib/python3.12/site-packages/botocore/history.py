# Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import logging

HISTORY_RECORDER = None
logger = logging.getLogger(__name__)


class BaseHistoryHandler:
    def emit(self, event_type, payload, source):
        raise NotImplementedError('emit()')


class HistoryRecorder:
    def __init__(self):
        self._enabled = False
        self._handlers = []

    def enable(self):
        self._enabled = True

    def disable(self):
        self._enabled = False

    def add_handler(self, handler):
        self._handlers.append(handler)

    def record(self, event_type, payload, source='BOTOCORE'):
        if self._enabled and self._handlers:
            for handler in self._handlers:
                try:
                    handler.emit(event_type, payload, source)
                except Exception:
                    # Never let the process die because we had a failure in
                    # a record collection handler.
                    logger.debug(
                        "Exception raised in %s.", handler, exc_info=True
                    )


def get_global_history_recorder():
    global HISTORY_RECORDER
    if HISTORY_RECORDER is None:
        HISTORY_RECORDER = HistoryRecorder()
    return HISTORY_RECORDER

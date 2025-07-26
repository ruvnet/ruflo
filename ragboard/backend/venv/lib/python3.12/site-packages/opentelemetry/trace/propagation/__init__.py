# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
from typing import Optional

from opentelemetry.context import create_key, get_value, set_value
from opentelemetry.context.context import Context
from opentelemetry.trace.span import INVALID_SPAN, Span

SPAN_KEY = "current-span"
_SPAN_KEY = create_key("current-span")


def set_span_in_context(
    span: Span, context: Optional[Context] = None
) -> Context:
    """Set the span in the given context.

    Args:
        span: The Span to set.
        context: a Context object. if one is not passed, the
            default current context is used instead.
    """
    ctx = set_value(_SPAN_KEY, span, context=context)
    return ctx


def get_current_span(context: Optional[Context] = None) -> Span:
    """Retrieve the current span.

    Args:
        context: A Context object. If one is not passed, the
            default current context is used instead.

    Returns:
        The Span set in the context if it exists. INVALID_SPAN otherwise.
    """
    span = get_value(_SPAN_KEY, context=context)
    if span is None or not isinstance(span, Span):
        return INVALID_SPAN
    return span

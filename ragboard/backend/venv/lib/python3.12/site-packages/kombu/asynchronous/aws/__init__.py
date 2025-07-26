from __future__ import annotations

from typing import Any

from kombu.asynchronous.aws.sqs.connection import AsyncSQSConnection


def connect_sqs(
    aws_access_key_id: str | None = None,
    aws_secret_access_key: str | None = None,
    **kwargs: Any
) -> AsyncSQSConnection:
    """Return async connection to Amazon SQS."""
    from .sqs.connection import AsyncSQSConnection
    return AsyncSQSConnection(
        aws_access_key_id, aws_secret_access_key, **kwargs
    )

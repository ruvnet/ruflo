"""Amazon boto3 interface."""

from __future__ import annotations

try:
    import boto3
    from botocore import exceptions
    from botocore.awsrequest import AWSRequest
    from botocore.httpsession import get_cert_path
    from botocore.response import get_response
except ImportError:
    boto3 = None

    class _void:
        pass

    class BotoCoreError(Exception):
        pass
    exceptions = _void()
    exceptions.BotoCoreError = BotoCoreError
    AWSRequest = _void()
    get_response = _void()
    get_cert_path = _void()


__all__ = (
    'exceptions', 'AWSRequest', 'get_response', 'get_cert_path',
)

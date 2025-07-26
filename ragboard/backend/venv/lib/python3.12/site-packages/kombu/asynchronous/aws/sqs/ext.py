"""Amazon SQS boto3 interface."""


from __future__ import annotations

try:
    import boto3
except ImportError:
    boto3 = None

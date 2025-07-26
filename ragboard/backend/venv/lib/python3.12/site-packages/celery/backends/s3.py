"""s3 result store backend."""

from kombu.utils.encoding import bytes_to_str

from celery.exceptions import ImproperlyConfigured

from .base import KeyValueStoreBackend

try:
    import boto3
    import botocore
except ImportError:
    boto3 = None
    botocore = None


__all__ = ('S3Backend',)


class S3Backend(KeyValueStoreBackend):
    """An S3 task result store.

    Raises:
        celery.exceptions.ImproperlyConfigured:
            if module :pypi:`boto3` is not available,
            if the :setting:`aws_access_key_id` or
            setting:`aws_secret_access_key` are not set,
            or it the :setting:`bucket` is not set.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        if not boto3 or not botocore:
            raise ImproperlyConfigured('You must install boto3'
                                       'to use s3 backend')
        conf = self.app.conf

        self.endpoint_url = conf.get('s3_endpoint_url', None)
        self.aws_region = conf.get('s3_region', None)

        self.aws_access_key_id = conf.get('s3_access_key_id', None)
        self.aws_secret_access_key = conf.get('s3_secret_access_key', None)

        self.bucket_name = conf.get('s3_bucket', None)
        if not self.bucket_name:
            raise ImproperlyConfigured('Missing bucket name')

        self.base_path = conf.get('s3_base_path', None)

        self._s3_resource = self._connect_to_s3()

    def _get_s3_object(self, key):
        key_bucket_path = self.base_path + key if self.base_path else key
        return self._s3_resource.Object(self.bucket_name, key_bucket_path)

    def get(self, key):
        key = bytes_to_str(key)
        s3_object = self._get_s3_object(key)
        try:
            s3_object.load()
            data = s3_object.get()['Body'].read()
            return data if self.content_encoding == 'binary' else data.decode('utf-8')
        except botocore.exceptions.ClientError as error:
            if error.response['Error']['Code'] == "404":
                return None
            raise error

    def set(self, key, value):
        key = bytes_to_str(key)
        s3_object = self._get_s3_object(key)
        s3_object.put(Body=value)

    def delete(self, key):
        key = bytes_to_str(key)
        s3_object = self._get_s3_object(key)
        s3_object.delete()

    def _connect_to_s3(self):
        session = boto3.Session(
            aws_access_key_id=self.aws_access_key_id,
            aws_secret_access_key=self.aws_secret_access_key,
            region_name=self.aws_region
        )
        if session.get_credentials() is None:
            raise ImproperlyConfigured('Missing aws s3 creds')
        return session.resource('s3', endpoint_url=self.endpoint_url)

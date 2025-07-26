"""The Azure Storage Block Blob backend for Celery."""
from kombu.utils import cached_property
from kombu.utils.encoding import bytes_to_str

from celery.exceptions import ImproperlyConfigured
from celery.utils.log import get_logger

from .base import KeyValueStoreBackend

try:
    import azure.storage.blob as azurestorage
    from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
    from azure.storage.blob import BlobServiceClient
except ImportError:
    azurestorage = None

__all__ = ("AzureBlockBlobBackend",)

LOGGER = get_logger(__name__)
AZURE_BLOCK_BLOB_CONNECTION_PREFIX = 'azureblockblob://'


class AzureBlockBlobBackend(KeyValueStoreBackend):
    """Azure Storage Block Blob backend for Celery."""

    def __init__(self,
                 url=None,
                 container_name=None,
                 *args,
                 **kwargs):
        super().__init__(*args, **kwargs)

        if azurestorage is None or azurestorage.__version__ < '12':
            raise ImproperlyConfigured(
                "You need to install the azure-storage-blob v12 library to"
                "use the AzureBlockBlob backend")

        conf = self.app.conf

        self._connection_string = self._parse_url(url)

        self._container_name = (
            container_name or
            conf["azureblockblob_container_name"])

        self.base_path = conf.get('azureblockblob_base_path', '')
        self._connection_timeout = conf.get(
            'azureblockblob_connection_timeout', 20
        )
        self._read_timeout = conf.get('azureblockblob_read_timeout', 120)

    @classmethod
    def _parse_url(cls, url, prefix=AZURE_BLOCK_BLOB_CONNECTION_PREFIX):
        connection_string = url[len(prefix):]
        if not connection_string:
            raise ImproperlyConfigured("Invalid URL")

        return connection_string

    @cached_property
    def _blob_service_client(self):
        """Return the Azure Storage Blob service client.

        If this is the first call to the property, the client is created and
        the container is created if it doesn't yet exist.

        """
        client = BlobServiceClient.from_connection_string(
            self._connection_string,
            connection_timeout=self._connection_timeout,
            read_timeout=self._read_timeout
        )

        try:
            client.create_container(name=self._container_name)
            msg = f"Container created with name {self._container_name}."
        except ResourceExistsError:
            msg = f"Container with name {self._container_name} already." \
                "exists. This will not be created."
        LOGGER.info(msg)

        return client

    def get(self, key):
        """Read the value stored at the given key.

        Args:
              key: The key for which to read the value.
        """
        key = bytes_to_str(key)
        LOGGER.debug("Getting Azure Block Blob %s/%s", self._container_name, key)

        blob_client = self._blob_service_client.get_blob_client(
            container=self._container_name,
            blob=f'{self.base_path}{key}',
        )

        try:
            return blob_client.download_blob().readall().decode()
        except ResourceNotFoundError:
            return None

    def set(self, key, value):
        """Store a value for a given key.

        Args:
              key: The key at which to store the value.
              value: The value to store.

        """
        key = bytes_to_str(key)
        LOGGER.debug(f"Creating azure blob at {self._container_name}/{key}")

        blob_client = self._blob_service_client.get_blob_client(
            container=self._container_name,
            blob=f'{self.base_path}{key}',
        )

        blob_client.upload_blob(value, overwrite=True)

    def mget(self, keys):
        """Read all the values for the provided keys.

        Args:
              keys: The list of keys to read.

        """
        return [self.get(key) for key in keys]

    def delete(self, key):
        """Delete the value at a given key.

        Args:
              key: The key of the value to delete.

        """
        key = bytes_to_str(key)
        LOGGER.debug(f"Deleting azure blob at {self._container_name}/{key}")

        blob_client = self._blob_service_client.get_blob_client(
            container=self._container_name,
            blob=f'{self.base_path}{key}',
        )

        blob_client.delete_blob()

    def as_uri(self, include_password=False):
        if include_password:
            return (
                f'{AZURE_BLOCK_BLOB_CONNECTION_PREFIX}'
                f'{self._connection_string}'
            )

        connection_string_parts = self._connection_string.split(';')
        account_key_prefix = 'AccountKey='
        redacted_connection_string_parts = [
            f'{account_key_prefix}**' if part.startswith(account_key_prefix)
            else part
            for part in connection_string_parts
        ]

        return (
            f'{AZURE_BLOCK_BLOB_CONNECTION_PREFIX}'
            f'{";".join(redacted_connection_string_parts)}'
        )

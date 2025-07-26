"""AWS DynamoDB result store backend."""
from collections import namedtuple
from time import sleep, time

from kombu.utils.url import _parse_url as parse_url

from celery.exceptions import ImproperlyConfigured
from celery.utils.log import get_logger

from .base import KeyValueStoreBackend

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    boto3 = ClientError = None

__all__ = ('DynamoDBBackend',)


# Helper class that describes a DynamoDB attribute
DynamoDBAttribute = namedtuple('DynamoDBAttribute', ('name', 'data_type'))

logger = get_logger(__name__)


class DynamoDBBackend(KeyValueStoreBackend):
    """AWS DynamoDB result backend.

    Raises:
        celery.exceptions.ImproperlyConfigured:
            if module :pypi:`boto3` is not available.
    """

    #: default DynamoDB table name (`default`)
    table_name = 'celery'

    #: Read Provisioned Throughput (`default`)
    read_capacity_units = 1

    #: Write Provisioned Throughput (`default`)
    write_capacity_units = 1

    #: AWS region (`default`)
    aws_region = None

    #: The endpoint URL that is passed to boto3 (local DynamoDB) (`default`)
    endpoint_url = None

    #: Item time-to-live in seconds (`default`)
    time_to_live_seconds = None

    # DynamoDB supports Time to Live as an auto-expiry mechanism.
    supports_autoexpire = True

    _key_field = DynamoDBAttribute(name='id', data_type='S')
    _value_field = DynamoDBAttribute(name='result', data_type='B')
    _timestamp_field = DynamoDBAttribute(name='timestamp', data_type='N')
    _ttl_field = DynamoDBAttribute(name='ttl', data_type='N')
    _available_fields = None

    def __init__(self, url=None, table_name=None, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.url = url
        self.table_name = table_name or self.table_name

        if not boto3:
            raise ImproperlyConfigured(
                'You need to install the boto3 library to use the '
                'DynamoDB backend.')

        aws_credentials_given = False
        aws_access_key_id = None
        aws_secret_access_key = None

        if url is not None:
            scheme, region, port, username, password, table, query = \
                parse_url(url)

            aws_access_key_id = username
            aws_secret_access_key = password

            access_key_given = aws_access_key_id is not None
            secret_key_given = aws_secret_access_key is not None

            if access_key_given != secret_key_given:
                raise ImproperlyConfigured(
                    'You need to specify both the Access Key ID '
                    'and Secret.')

            aws_credentials_given = access_key_given

            if region == 'localhost':
                # We are using the downloadable, local version of DynamoDB
                self.endpoint_url = f'http://localhost:{port}'
                self.aws_region = 'us-east-1'
                logger.warning(
                    'Using local-only DynamoDB endpoint URL: {}'.format(
                        self.endpoint_url
                    )
                )
            else:
                self.aws_region = region

            # If endpoint_url is explicitly set use it instead
            _get = self.app.conf.get
            config_endpoint_url = _get('dynamodb_endpoint_url')
            if config_endpoint_url:
                self.endpoint_url = config_endpoint_url

            self.read_capacity_units = int(
                query.get(
                    'read',
                    self.read_capacity_units
                )
            )
            self.write_capacity_units = int(
                query.get(
                    'write',
                    self.write_capacity_units
                )
            )

            ttl = query.get('ttl_seconds', self.time_to_live_seconds)
            if ttl:
                try:
                    self.time_to_live_seconds = int(ttl)
                except ValueError as e:
                    logger.error(
                        f'TTL must be a number; got "{ttl}"',
                        exc_info=e
                    )
                    raise e

            self.table_name = table or self.table_name

        self._available_fields = (
            self._key_field,
            self._value_field,
            self._timestamp_field
        )

        self._client = None
        if aws_credentials_given:
            self._get_client(
                access_key_id=aws_access_key_id,
                secret_access_key=aws_secret_access_key
            )

    def _get_client(self, access_key_id=None, secret_access_key=None):
        """Get client connection."""
        if self._client is None:
            client_parameters = {
                'region_name': self.aws_region
            }
            if access_key_id is not None:
                client_parameters.update({
                    'aws_access_key_id': access_key_id,
                    'aws_secret_access_key': secret_access_key
                })

            if self.endpoint_url is not None:
                client_parameters['endpoint_url'] = self.endpoint_url

            self._client = boto3.client(
                'dynamodb',
                **client_parameters
            )
            self._get_or_create_table()

            if self._has_ttl() is not None:
                self._validate_ttl_methods()
                self._set_table_ttl()

        return self._client

    def _get_table_schema(self):
        """Get the boto3 structure describing the DynamoDB table schema."""
        return {
            'AttributeDefinitions': [
                {
                    'AttributeName': self._key_field.name,
                    'AttributeType': self._key_field.data_type
                }
            ],
            'TableName': self.table_name,
            'KeySchema': [
                {
                    'AttributeName': self._key_field.name,
                    'KeyType': 'HASH'
                }
            ],
            'ProvisionedThroughput': {
                'ReadCapacityUnits': self.read_capacity_units,
                'WriteCapacityUnits': self.write_capacity_units
            }
        }

    def _get_or_create_table(self):
        """Create table if not exists, otherwise return the description."""
        table_schema = self._get_table_schema()
        try:
            return self._client.describe_table(TableName=self.table_name)
        except ClientError as e:
            error_code = e.response['Error'].get('Code', 'Unknown')

            if error_code == 'ResourceNotFoundException':
                table_description = self._client.create_table(**table_schema)
                logger.info(
                    'DynamoDB Table {} did not exist, creating.'.format(
                        self.table_name
                    )
                )
                # In case we created the table, wait until it becomes available.
                self._wait_for_table_status('ACTIVE')
                logger.info(
                    'DynamoDB Table {} is now available.'.format(
                        self.table_name
                    )
                )
                return table_description
            else:
                raise e

    def _has_ttl(self):
        """Return the desired Time to Live config.

        - True:  Enable TTL on the table; use expiry.
        - False: Disable TTL on the table; don't use expiry.
        - None:  Ignore TTL on the table; don't use expiry.
        """
        return None if self.time_to_live_seconds is None \
            else self.time_to_live_seconds >= 0

    def _validate_ttl_methods(self):
        """Verify boto support for the DynamoDB Time to Live methods."""
        # Required TTL methods.
        required_methods = (
            'update_time_to_live',
            'describe_time_to_live',
        )

        # Find missing methods.
        missing_methods = []
        for method in list(required_methods):
            if not hasattr(self._client, method):
                missing_methods.append(method)

        if missing_methods:
            logger.error(
                (
                    'boto3 method(s) {methods} not found; ensure that '
                    'boto3>=1.9.178 and botocore>=1.12.178 are installed'
                ).format(
                    methods=','.join(missing_methods)
                )
            )
            raise AttributeError(
                'boto3 method(s) {methods} not found'.format(
                    methods=','.join(missing_methods)
                )
            )

    def _get_ttl_specification(self, ttl_attr_name):
        """Get the boto3 structure describing the DynamoDB TTL specification."""
        return {
            'TableName': self.table_name,
            'TimeToLiveSpecification': {
                'Enabled': self._has_ttl(),
                'AttributeName': ttl_attr_name
            }
        }

    def _get_table_ttl_description(self):
        # Get the current TTL description.
        try:
            description = self._client.describe_time_to_live(
                TableName=self.table_name
            )
        except ClientError as e:
            error_code = e.response['Error'].get('Code', 'Unknown')
            error_message = e.response['Error'].get('Message', 'Unknown')
            logger.error((
                'Error describing Time to Live on DynamoDB table {table}: '
                '{code}: {message}'
            ).format(
                table=self.table_name,
                code=error_code,
                message=error_message,
            ))
            raise e

        return description

    def _set_table_ttl(self):
        """Enable or disable Time to Live on the table."""
        # Get the table TTL description, and return early when possible.
        description = self._get_table_ttl_description()
        status = description['TimeToLiveDescription']['TimeToLiveStatus']
        if status in ('ENABLED', 'ENABLING'):
            cur_attr_name = \
                description['TimeToLiveDescription']['AttributeName']
            if self._has_ttl():
                if cur_attr_name == self._ttl_field.name:
                    # We want TTL enabled, and it is currently enabled or being
                    # enabled, and on the correct attribute.
                    logger.debug((
                        'DynamoDB Time to Live is {situation} '
                        'on table {table}'
                    ).format(
                        situation='already enabled'
                        if status == 'ENABLED'
                        else 'currently being enabled',
                        table=self.table_name
                    ))
                    return description

        elif status in ('DISABLED', 'DISABLING'):
            if not self._has_ttl():
                # We want TTL disabled, and it is currently disabled or being
                # disabled.
                logger.debug((
                    'DynamoDB Time to Live is {situation} '
                    'on table {table}'
                ).format(
                    situation='already disabled'
                    if status == 'DISABLED'
                    else 'currently being disabled',
                    table=self.table_name
                ))
                return description

        # The state shouldn't ever have any value beyond the four handled
        # above, but to ease troubleshooting of potential future changes, emit
        # a log showing the unknown state.
        else:  # pragma: no cover
            logger.warning((
                'Unknown DynamoDB Time to Live status {status} '
                'on table {table}. Attempting to continue.'
            ).format(
                status=status,
                table=self.table_name
            ))

        # At this point, we have one of the following situations:
        #
        # We want TTL enabled,
        #
        # - and it's currently disabled: Try to enable.
        #
        # - and it's being disabled: Try to enable, but this is almost sure to
        #   raise ValidationException with message:
        #
        #     Time to live has been modified multiple times within a fixed
        #     interval
        #
        # - and it's currently enabling or being enabled, but on the wrong
        #   attribute: Try to enable, but this will raise ValidationException
        #   with message:
        #
        #     TimeToLive is active on a different AttributeName: current
        #     AttributeName is ttlx
        #
        # We want TTL disabled,
        #
        # - and it's currently enabled: Try to disable.
        #
        # - and it's being enabled: Try to disable, but this is almost sure to
        #   raise ValidationException with message:
        #
        #     Time to live has been modified multiple times within a fixed
        #     interval
        #
        attr_name = \
            cur_attr_name if status == 'ENABLED' else self._ttl_field.name
        try:
            specification = self._client.update_time_to_live(
                **self._get_ttl_specification(
                    ttl_attr_name=attr_name
                )
            )
            logger.info(
                (
                    'DynamoDB table Time to Live updated: '
                    'table={table} enabled={enabled} attribute={attr}'
                ).format(
                    table=self.table_name,
                    enabled=self._has_ttl(),
                    attr=self._ttl_field.name
                )
            )
            return specification
        except ClientError as e:
            error_code = e.response['Error'].get('Code', 'Unknown')
            error_message = e.response['Error'].get('Message', 'Unknown')
            logger.error((
                'Error {action} Time to Live on DynamoDB table {table}: '
                '{code}: {message}'
            ).format(
                action='enabling' if self._has_ttl() else 'disabling',
                table=self.table_name,
                code=error_code,
                message=error_message,
            ))
            raise e

    def _wait_for_table_status(self, expected='ACTIVE'):
        """Poll for the expected table status."""
        achieved_state = False
        while not achieved_state:
            table_description = self.client.describe_table(
                TableName=self.table_name
            )
            logger.debug(
                'Waiting for DynamoDB table {} to become {}.'.format(
                    self.table_name,
                    expected
                )
            )
            current_status = table_description['Table']['TableStatus']
            achieved_state = current_status == expected
            sleep(1)

    def _prepare_get_request(self, key):
        """Construct the item retrieval request parameters."""
        return {
            'TableName': self.table_name,
            'Key': {
                self._key_field.name: {
                    self._key_field.data_type: key
                }
            }
        }

    def _prepare_put_request(self, key, value):
        """Construct the item creation request parameters."""
        timestamp = time()
        put_request = {
            'TableName': self.table_name,
            'Item': {
                self._key_field.name: {
                    self._key_field.data_type: key
                },
                self._value_field.name: {
                    self._value_field.data_type: value
                },
                self._timestamp_field.name: {
                    self._timestamp_field.data_type: str(timestamp)
                }
            }
        }
        if self._has_ttl():
            put_request['Item'].update({
                self._ttl_field.name: {
                    self._ttl_field.data_type:
                        str(int(timestamp + self.time_to_live_seconds))
                }
            })
        return put_request

    def _item_to_dict(self, raw_response):
        """Convert get_item() response to field-value pairs."""
        if 'Item' not in raw_response:
            return {}
        return {
            field.name: raw_response['Item'][field.name][field.data_type]
            for field in self._available_fields
        }

    @property
    def client(self):
        return self._get_client()

    def get(self, key):
        key = str(key)
        request_parameters = self._prepare_get_request(key)
        item_response = self.client.get_item(**request_parameters)
        item = self._item_to_dict(item_response)
        return item.get(self._value_field.name)

    def set(self, key, value):
        key = str(key)
        request_parameters = self._prepare_put_request(key, value)
        self.client.put_item(**request_parameters)

    def mget(self, keys):
        return [self.get(key) for key in keys]

    def delete(self, key):
        key = str(key)
        request_parameters = self._prepare_get_request(key)
        self.client.delete_item(**request_parameters)

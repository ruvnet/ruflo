import typing

from ._migration import getattr_migration
from .version import VERSION

if typing.TYPE_CHECKING:
    # import of virtually everything is supported via `__getattr__` below,
    # but we need them here for type checking and IDE support
    import pydantic_core
    from pydantic_core.core_schema import (
        FieldSerializationInfo,
        SerializationInfo,
        SerializerFunctionWrapHandler,
        ValidationInfo,
        ValidatorFunctionWrapHandler,
    )

    from . import dataclasses
    from ._internal._generate_schema import GenerateSchema as GenerateSchema
    from .annotated_handlers import GetCoreSchemaHandler, GetJsonSchemaHandler
    from .config import ConfigDict
    from .errors import *
    from .fields import AliasChoices, AliasPath, Field, PrivateAttr, computed_field
    from .functional_serializers import (
        PlainSerializer,
        SerializeAsAny,
        WrapSerializer,
        field_serializer,
        model_serializer,
    )
    from .functional_validators import (
        AfterValidator,
        BeforeValidator,
        InstanceOf,
        PlainValidator,
        SkipValidation,
        WrapValidator,
        field_validator,
        model_validator,
    )
    from .json_schema import WithJsonSchema
    from .main import *
    from .networks import *
    from .type_adapter import TypeAdapter
    from .types import *
    from .validate_call_decorator import validate_call
    from .warnings import PydanticDeprecatedSince20, PydanticDeprecationWarning

    # this encourages pycharm to import `ValidationError` from here, not pydantic_core
    ValidationError = pydantic_core.ValidationError
    from .deprecated.class_validators import root_validator, validator
    from .deprecated.config import BaseConfig, Extra
    from .deprecated.tools import *
    from .root_model import RootModel

__version__ = VERSION
__all__ = (
    # dataclasses
    'dataclasses',
    # functional validators
    'field_validator',
    'model_validator',
    'AfterValidator',
    'BeforeValidator',
    'PlainValidator',
    'WrapValidator',
    'SkipValidation',
    'InstanceOf',
    # JSON Schema
    'WithJsonSchema',
    # deprecated V1 functional validators, these are imported via `__getattr__` below
    'root_validator',
    'validator',
    # functional serializers
    'field_serializer',
    'model_serializer',
    'PlainSerializer',
    'SerializeAsAny',
    'WrapSerializer',
    # config
    'ConfigDict',
    # deprecated V1 config, these are imported via `__getattr__` below
    'BaseConfig',
    'Extra',
    # validate_call
    'validate_call',
    # errors
    'PydanticErrorCodes',
    'PydanticUserError',
    'PydanticSchemaGenerationError',
    'PydanticImportError',
    'PydanticUndefinedAnnotation',
    'PydanticInvalidForJsonSchema',
    # fields
    'AliasPath',
    'AliasChoices',
    'Field',
    'computed_field',
    'PrivateAttr',
    # main
    'BaseModel',
    'create_model',
    # network
    'AnyUrl',
    'AnyHttpUrl',
    'FileUrl',
    'HttpUrl',
    'UrlConstraints',
    'EmailStr',
    'NameEmail',
    'IPvAnyAddress',
    'IPvAnyInterface',
    'IPvAnyNetwork',
    'PostgresDsn',
    'CockroachDsn',
    'AmqpDsn',
    'RedisDsn',
    'MongoDsn',
    'KafkaDsn',
    'MySQLDsn',
    'MariaDBDsn',
    'validate_email',
    # root_model
    'RootModel',
    # deprecated tools, these are imported via `__getattr__` below
    'parse_obj_as',
    'schema_of',
    'schema_json_of',
    # types
    'Strict',
    'StrictStr',
    'conbytes',
    'conlist',
    'conset',
    'confrozenset',
    'constr',
    'StringConstraints',
    'ImportString',
    'conint',
    'PositiveInt',
    'NegativeInt',
    'NonNegativeInt',
    'NonPositiveInt',
    'confloat',
    'PositiveFloat',
    'NegativeFloat',
    'NonNegativeFloat',
    'NonPositiveFloat',
    'FiniteFloat',
    'condecimal',
    'condate',
    'UUID1',
    'UUID3',
    'UUID4',
    'UUID5',
    'FilePath',
    'DirectoryPath',
    'NewPath',
    'Json',
    'SecretStr',
    'SecretBytes',
    'StrictBool',
    'StrictBytes',
    'StrictInt',
    'StrictFloat',
    'PaymentCardNumber',
    'ByteSize',
    'PastDate',
    'FutureDate',
    'PastDatetime',
    'FutureDatetime',
    'AwareDatetime',
    'NaiveDatetime',
    'AllowInfNan',
    'EncoderProtocol',
    'EncodedBytes',
    'EncodedStr',
    'Base64Encoder',
    'Base64Bytes',
    'Base64Str',
    'Base64UrlBytes',
    'Base64UrlStr',
    'GetPydanticSchema',
    'Tag',
    'Discriminator',
    'JsonValue',
    # type_adapter
    'TypeAdapter',
    # version
    '__version__',
    'VERSION',
    # warnings
    'PydanticDeprecatedSince20',
    'PydanticDeprecationWarning',
    # annotated handlers
    'GetCoreSchemaHandler',
    'GetJsonSchemaHandler',
    # generate schema from ._internal
    'GenerateSchema',
    # pydantic_core
    'ValidationError',
    'ValidationInfo',
    'SerializationInfo',
    'ValidatorFunctionWrapHandler',
    'FieldSerializationInfo',
    'SerializerFunctionWrapHandler',
)

# A mapping of {<member name>: (package, <module name>)} defining dynamic imports
_dynamic_imports: 'dict[str, tuple[str, str]]' = {
    'dataclasses': (__package__, '__module__'),
    # functional validators
    'field_validator': (__package__, '.functional_validators'),
    'model_validator': (__package__, '.functional_validators'),
    'AfterValidator': (__package__, '.functional_validators'),
    'BeforeValidator': (__package__, '.functional_validators'),
    'PlainValidator': (__package__, '.functional_validators'),
    'WrapValidator': (__package__, '.functional_validators'),
    'SkipValidation': (__package__, '.functional_validators'),
    'InstanceOf': (__package__, '.functional_validators'),
    # JSON Schema
    'WithJsonSchema': (__package__, '.json_schema'),
    # functional serializers
    'field_serializer': (__package__, '.functional_serializers'),
    'model_serializer': (__package__, '.functional_serializers'),
    'PlainSerializer': (__package__, '.functional_serializers'),
    'SerializeAsAny': (__package__, '.functional_serializers'),
    'WrapSerializer': (__package__, '.functional_serializers'),
    # config
    'ConfigDict': (__package__, '.config'),
    # validate call
    'validate_call': (__package__, '.validate_call_decorator'),
    # errors
    'PydanticErrorCodes': (__package__, '.errors'),
    'PydanticUserError': (__package__, '.errors'),
    'PydanticSchemaGenerationError': (__package__, '.errors'),
    'PydanticImportError': (__package__, '.errors'),
    'PydanticUndefinedAnnotation': (__package__, '.errors'),
    'PydanticInvalidForJsonSchema': (__package__, '.errors'),
    # fields
    'AliasPath': (__package__, '.fields'),
    'AliasChoices': (__package__, '.fields'),
    'Field': (__package__, '.fields'),
    'computed_field': (__package__, '.fields'),
    'PrivateAttr': (__package__, '.fields'),
    # main
    'BaseModel': (__package__, '.main'),
    'create_model': (__package__, '.main'),
    # network
    'AnyUrl': (__package__, '.networks'),
    'AnyHttpUrl': (__package__, '.networks'),
    'FileUrl': (__package__, '.networks'),
    'HttpUrl': (__package__, '.networks'),
    'UrlConstraints': (__package__, '.networks'),
    'EmailStr': (__package__, '.networks'),
    'NameEmail': (__package__, '.networks'),
    'IPvAnyAddress': (__package__, '.networks'),
    'IPvAnyInterface': (__package__, '.networks'),
    'IPvAnyNetwork': (__package__, '.networks'),
    'PostgresDsn': (__package__, '.networks'),
    'CockroachDsn': (__package__, '.networks'),
    'AmqpDsn': (__package__, '.networks'),
    'RedisDsn': (__package__, '.networks'),
    'MongoDsn': (__package__, '.networks'),
    'KafkaDsn': (__package__, '.networks'),
    'MySQLDsn': (__package__, '.networks'),
    'MariaDBDsn': (__package__, '.networks'),
    'validate_email': (__package__, '.networks'),
    # root_model
    'RootModel': (__package__, '.root_model'),
    # types
    'Strict': (__package__, '.types'),
    'StrictStr': (__package__, '.types'),
    'conbytes': (__package__, '.types'),
    'conlist': (__package__, '.types'),
    'conset': (__package__, '.types'),
    'confrozenset': (__package__, '.types'),
    'constr': (__package__, '.types'),
    'StringConstraints': (__package__, '.types'),
    'ImportString': (__package__, '.types'),
    'conint': (__package__, '.types'),
    'PositiveInt': (__package__, '.types'),
    'NegativeInt': (__package__, '.types'),
    'NonNegativeInt': (__package__, '.types'),
    'NonPositiveInt': (__package__, '.types'),
    'confloat': (__package__, '.types'),
    'PositiveFloat': (__package__, '.types'),
    'NegativeFloat': (__package__, '.types'),
    'NonNegativeFloat': (__package__, '.types'),
    'NonPositiveFloat': (__package__, '.types'),
    'FiniteFloat': (__package__, '.types'),
    'condecimal': (__package__, '.types'),
    'condate': (__package__, '.types'),
    'UUID1': (__package__, '.types'),
    'UUID3': (__package__, '.types'),
    'UUID4': (__package__, '.types'),
    'UUID5': (__package__, '.types'),
    'FilePath': (__package__, '.types'),
    'DirectoryPath': (__package__, '.types'),
    'NewPath': (__package__, '.types'),
    'Json': (__package__, '.types'),
    'SecretStr': (__package__, '.types'),
    'SecretBytes': (__package__, '.types'),
    'StrictBool': (__package__, '.types'),
    'StrictBytes': (__package__, '.types'),
    'StrictInt': (__package__, '.types'),
    'StrictFloat': (__package__, '.types'),
    'PaymentCardNumber': (__package__, '.types'),
    'ByteSize': (__package__, '.types'),
    'PastDate': (__package__, '.types'),
    'FutureDate': (__package__, '.types'),
    'PastDatetime': (__package__, '.types'),
    'FutureDatetime': (__package__, '.types'),
    'AwareDatetime': (__package__, '.types'),
    'NaiveDatetime': (__package__, '.types'),
    'AllowInfNan': (__package__, '.types'),
    'EncoderProtocol': (__package__, '.types'),
    'EncodedBytes': (__package__, '.types'),
    'EncodedStr': (__package__, '.types'),
    'Base64Encoder': (__package__, '.types'),
    'Base64Bytes': (__package__, '.types'),
    'Base64Str': (__package__, '.types'),
    'Base64UrlBytes': (__package__, '.types'),
    'Base64UrlStr': (__package__, '.types'),
    'GetPydanticSchema': (__package__, '.types'),
    'Tag': (__package__, '.types'),
    'Discriminator': (__package__, '.types'),
    'JsonValue': (__package__, '.types'),
    # type_adapter
    'TypeAdapter': (__package__, '.type_adapter'),
    # warnings
    'PydanticDeprecatedSince20': (__package__, '.warnings'),
    'PydanticDeprecationWarning': (__package__, '.warnings'),
    # annotated handlers
    'GetCoreSchemaHandler': (__package__, '.annotated_handlers'),
    'GetJsonSchemaHandler': (__package__, '.annotated_handlers'),
    # generate schema from ._internal
    'GenerateSchema': (__package__, '._internal._generate_schema'),
    # pydantic_core stuff
    'ValidationError': ('pydantic_core', '.'),
    'ValidationInfo': ('pydantic_core', '.core_schema'),
    'SerializationInfo': ('pydantic_core', '.core_schema'),
    'ValidatorFunctionWrapHandler': ('pydantic_core', '.core_schema'),
    'FieldSerializationInfo': ('pydantic_core', '.core_schema'),
    'SerializerFunctionWrapHandler': ('pydantic_core', '.core_schema'),
    # deprecated, mostly not included in __all__
    'root_validator': (__package__, '.deprecated.class_validators'),
    'validator': (__package__, '.deprecated.class_validators'),
    'BaseConfig': (__package__, '.deprecated.config'),
    'Extra': (__package__, '.deprecated.config'),
    'parse_obj_as': (__package__, '.deprecated.tools'),
    'schema_of': (__package__, '.deprecated.tools'),
    'schema_json_of': (__package__, '.deprecated.tools'),
    'FieldValidationInfo': ('pydantic_core', '.core_schema'),
}

_getattr_migration = getattr_migration(__name__)


def __getattr__(attr_name: str) -> object:
    dynamic_attr = _dynamic_imports.get(attr_name)
    if dynamic_attr is None:
        return _getattr_migration(attr_name)

    package, module_name = dynamic_attr

    from importlib import import_module

    if module_name == '__module__':
        return import_module(f'.{attr_name}', package=package)
    else:
        module = import_module(module_name, package=package)
        return getattr(module, attr_name)


def __dir__() -> 'list[str]':
    return list(__all__)

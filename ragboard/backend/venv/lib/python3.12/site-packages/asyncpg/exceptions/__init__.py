# GENERATED FROM postgresql/src/backend/utils/errcodes.txt
# DO NOT MODIFY, use tools/generate_exceptions.py to update

from ._base import *  # NOQA
from . import _base


class PostgresWarning(_base.PostgresLogMessage, Warning):
    sqlstate = '01000'


class DynamicResultSetsReturned(PostgresWarning):
    sqlstate = '0100C'


class ImplicitZeroBitPadding(PostgresWarning):
    sqlstate = '01008'


class NullValueEliminatedInSetFunction(PostgresWarning):
    sqlstate = '01003'


class PrivilegeNotGranted(PostgresWarning):
    sqlstate = '01007'


class PrivilegeNotRevoked(PostgresWarning):
    sqlstate = '01006'


class StringDataRightTruncation(PostgresWarning):
    sqlstate = '01004'


class DeprecatedFeature(PostgresWarning):
    sqlstate = '01P01'


class NoData(PostgresWarning):
    sqlstate = '02000'


class NoAdditionalDynamicResultSetsReturned(NoData):
    sqlstate = '02001'


class SQLStatementNotYetCompleteError(_base.PostgresError):
    sqlstate = '03000'


class PostgresConnectionError(_base.PostgresError):
    sqlstate = '08000'


class ConnectionDoesNotExistError(PostgresConnectionError):
    sqlstate = '08003'


class ConnectionFailureError(PostgresConnectionError):
    sqlstate = '08006'


class ClientCannotConnectError(PostgresConnectionError):
    sqlstate = '08001'


class ConnectionRejectionError(PostgresConnectionError):
    sqlstate = '08004'


class TransactionResolutionUnknownError(PostgresConnectionError):
    sqlstate = '08007'


class ProtocolViolationError(PostgresConnectionError):
    sqlstate = '08P01'


class TriggeredActionError(_base.PostgresError):
    sqlstate = '09000'


class FeatureNotSupportedError(_base.PostgresError):
    sqlstate = '0A000'


class InvalidCachedStatementError(FeatureNotSupportedError):
    pass


class InvalidTransactionInitiationError(_base.PostgresError):
    sqlstate = '0B000'


class LocatorError(_base.PostgresError):
    sqlstate = '0F000'


class InvalidLocatorSpecificationError(LocatorError):
    sqlstate = '0F001'


class InvalidGrantorError(_base.PostgresError):
    sqlstate = '0L000'


class InvalidGrantOperationError(InvalidGrantorError):
    sqlstate = '0LP01'


class InvalidRoleSpecificationError(_base.PostgresError):
    sqlstate = '0P000'


class DiagnosticsError(_base.PostgresError):
    sqlstate = '0Z000'


class StackedDiagnosticsAccessedWithoutActiveHandlerError(DiagnosticsError):
    sqlstate = '0Z002'


class CaseNotFoundError(_base.PostgresError):
    sqlstate = '20000'


class CardinalityViolationError(_base.PostgresError):
    sqlstate = '21000'


class DataError(_base.PostgresError):
    sqlstate = '22000'


class ArraySubscriptError(DataError):
    sqlstate = '2202E'


class CharacterNotInRepertoireError(DataError):
    sqlstate = '22021'


class DatetimeFieldOverflowError(DataError):
    sqlstate = '22008'


class DivisionByZeroError(DataError):
    sqlstate = '22012'


class ErrorInAssignmentError(DataError):
    sqlstate = '22005'


class EscapeCharacterConflictError(DataError):
    sqlstate = '2200B'


class IndicatorOverflowError(DataError):
    sqlstate = '22022'


class IntervalFieldOverflowError(DataError):
    sqlstate = '22015'


class InvalidArgumentForLogarithmError(DataError):
    sqlstate = '2201E'


class InvalidArgumentForNtileFunctionError(DataError):
    sqlstate = '22014'


class InvalidArgumentForNthValueFunctionError(DataError):
    sqlstate = '22016'


class InvalidArgumentForPowerFunctionError(DataError):
    sqlstate = '2201F'


class InvalidArgumentForWidthBucketFunctionError(DataError):
    sqlstate = '2201G'


class InvalidCharacterValueForCastError(DataError):
    sqlstate = '22018'


class InvalidDatetimeFormatError(DataError):
    sqlstate = '22007'


class InvalidEscapeCharacterError(DataError):
    sqlstate = '22019'


class InvalidEscapeOctetError(DataError):
    sqlstate = '2200D'


class InvalidEscapeSequenceError(DataError):
    sqlstate = '22025'


class NonstandardUseOfEscapeCharacterError(DataError):
    sqlstate = '22P06'


class InvalidIndicatorParameterValueError(DataError):
    sqlstate = '22010'


class InvalidParameterValueError(DataError):
    sqlstate = '22023'


class InvalidPrecedingOrFollowingSizeError(DataError):
    sqlstate = '22013'


class InvalidRegularExpressionError(DataError):
    sqlstate = '2201B'


class InvalidRowCountInLimitClauseError(DataError):
    sqlstate = '2201W'


class InvalidRowCountInResultOffsetClauseError(DataError):
    sqlstate = '2201X'


class InvalidTablesampleArgumentError(DataError):
    sqlstate = '2202H'


class InvalidTablesampleRepeatError(DataError):
    sqlstate = '2202G'


class InvalidTimeZoneDisplacementValueError(DataError):
    sqlstate = '22009'


class InvalidUseOfEscapeCharacterError(DataError):
    sqlstate = '2200C'


class MostSpecificTypeMismatchError(DataError):
    sqlstate = '2200G'


class NullValueNotAllowedError(DataError):
    sqlstate = '22004'


class NullValueNoIndicatorParameterError(DataError):
    sqlstate = '22002'


class NumericValueOutOfRangeError(DataError):
    sqlstate = '22003'


class SequenceGeneratorLimitExceededError(DataError):
    sqlstate = '2200H'


class StringDataLengthMismatchError(DataError):
    sqlstate = '22026'


class StringDataRightTruncationError(DataError):
    sqlstate = '22001'


class SubstringError(DataError):
    sqlstate = '22011'


class TrimError(DataError):
    sqlstate = '22027'


class UnterminatedCStringError(DataError):
    sqlstate = '22024'


class ZeroLengthCharacterStringError(DataError):
    sqlstate = '2200F'


class PostgresFloatingPointError(DataError):
    sqlstate = '22P01'


class InvalidTextRepresentationError(DataError):
    sqlstate = '22P02'


class InvalidBinaryRepresentationError(DataError):
    sqlstate = '22P03'


class BadCopyFileFormatError(DataError):
    sqlstate = '22P04'


class UntranslatableCharacterError(DataError):
    sqlstate = '22P05'


class NotAnXmlDocumentError(DataError):
    sqlstate = '2200L'


class InvalidXmlDocumentError(DataError):
    sqlstate = '2200M'


class InvalidXmlContentError(DataError):
    sqlstate = '2200N'


class InvalidXmlCommentError(DataError):
    sqlstate = '2200S'


class InvalidXmlProcessingInstructionError(DataError):
    sqlstate = '2200T'


class DuplicateJsonObjectKeyValueError(DataError):
    sqlstate = '22030'


class InvalidArgumentForSQLJsonDatetimeFunctionError(DataError):
    sqlstate = '22031'


class InvalidJsonTextError(DataError):
    sqlstate = '22032'


class InvalidSQLJsonSubscriptError(DataError):
    sqlstate = '22033'


class MoreThanOneSQLJsonItemError(DataError):
    sqlstate = '22034'


class NoSQLJsonItemError(DataError):
    sqlstate = '22035'


class NonNumericSQLJsonItemError(DataError):
    sqlstate = '22036'


class NonUniqueKeysInAJsonObjectError(DataError):
    sqlstate = '22037'


class SingletonSQLJsonItemRequiredError(DataError):
    sqlstate = '22038'


class SQLJsonArrayNotFoundError(DataError):
    sqlstate = '22039'


class SQLJsonMemberNotFoundError(DataError):
    sqlstate = '2203A'


class SQLJsonNumberNotFoundError(DataError):
    sqlstate = '2203B'


class SQLJsonObjectNotFoundError(DataError):
    sqlstate = '2203C'


class TooManyJsonArrayElementsError(DataError):
    sqlstate = '2203D'


class TooManyJsonObjectMembersError(DataError):
    sqlstate = '2203E'


class SQLJsonScalarRequiredError(DataError):
    sqlstate = '2203F'


class SQLJsonItemCannotBeCastToTargetTypeError(DataError):
    sqlstate = '2203G'


class IntegrityConstraintViolationError(_base.PostgresError):
    sqlstate = '23000'


class RestrictViolationError(IntegrityConstraintViolationError):
    sqlstate = '23001'


class NotNullViolationError(IntegrityConstraintViolationError):
    sqlstate = '23502'


class ForeignKeyViolationError(IntegrityConstraintViolationError):
    sqlstate = '23503'


class UniqueViolationError(IntegrityConstraintViolationError):
    sqlstate = '23505'


class CheckViolationError(IntegrityConstraintViolationError):
    sqlstate = '23514'


class ExclusionViolationError(IntegrityConstraintViolationError):
    sqlstate = '23P01'


class InvalidCursorStateError(_base.PostgresError):
    sqlstate = '24000'


class InvalidTransactionStateError(_base.PostgresError):
    sqlstate = '25000'


class ActiveSQLTransactionError(InvalidTransactionStateError):
    sqlstate = '25001'


class BranchTransactionAlreadyActiveError(InvalidTransactionStateError):
    sqlstate = '25002'


class HeldCursorRequiresSameIsolationLevelError(InvalidTransactionStateError):
    sqlstate = '25008'


class InappropriateAccessModeForBranchTransactionError(
        InvalidTransactionStateError):
    sqlstate = '25003'


class InappropriateIsolationLevelForBranchTransactionError(
        InvalidTransactionStateError):
    sqlstate = '25004'


class NoActiveSQLTransactionForBranchTransactionError(
        InvalidTransactionStateError):
    sqlstate = '25005'


class ReadOnlySQLTransactionError(InvalidTransactionStateError):
    sqlstate = '25006'


class SchemaAndDataStatementMixingNotSupportedError(
        InvalidTransactionStateError):
    sqlstate = '25007'


class NoActiveSQLTransactionError(InvalidTransactionStateError):
    sqlstate = '25P01'


class InFailedSQLTransactionError(InvalidTransactionStateError):
    sqlstate = '25P02'


class IdleInTransactionSessionTimeoutError(InvalidTransactionStateError):
    sqlstate = '25P03'


class InvalidSQLStatementNameError(_base.PostgresError):
    sqlstate = '26000'


class TriggeredDataChangeViolationError(_base.PostgresError):
    sqlstate = '27000'


class InvalidAuthorizationSpecificationError(_base.PostgresError):
    sqlstate = '28000'


class InvalidPasswordError(InvalidAuthorizationSpecificationError):
    sqlstate = '28P01'


class DependentPrivilegeDescriptorsStillExistError(_base.PostgresError):
    sqlstate = '2B000'


class DependentObjectsStillExistError(
        DependentPrivilegeDescriptorsStillExistError):
    sqlstate = '2BP01'


class InvalidTransactionTerminationError(_base.PostgresError):
    sqlstate = '2D000'


class SQLRoutineError(_base.PostgresError):
    sqlstate = '2F000'


class FunctionExecutedNoReturnStatementError(SQLRoutineError):
    sqlstate = '2F005'


class ModifyingSQLDataNotPermittedError(SQLRoutineError):
    sqlstate = '2F002'


class ProhibitedSQLStatementAttemptedError(SQLRoutineError):
    sqlstate = '2F003'


class ReadingSQLDataNotPermittedError(SQLRoutineError):
    sqlstate = '2F004'


class InvalidCursorNameError(_base.PostgresError):
    sqlstate = '34000'


class ExternalRoutineError(_base.PostgresError):
    sqlstate = '38000'


class ContainingSQLNotPermittedError(ExternalRoutineError):
    sqlstate = '38001'


class ModifyingExternalRoutineSQLDataNotPermittedError(ExternalRoutineError):
    sqlstate = '38002'


class ProhibitedExternalRoutineSQLStatementAttemptedError(
        ExternalRoutineError):
    sqlstate = '38003'


class ReadingExternalRoutineSQLDataNotPermittedError(ExternalRoutineError):
    sqlstate = '38004'


class ExternalRoutineInvocationError(_base.PostgresError):
    sqlstate = '39000'


class InvalidSqlstateReturnedError(ExternalRoutineInvocationError):
    sqlstate = '39001'


class NullValueInExternalRoutineNotAllowedError(
        ExternalRoutineInvocationError):
    sqlstate = '39004'


class TriggerProtocolViolatedError(ExternalRoutineInvocationError):
    sqlstate = '39P01'


class SrfProtocolViolatedError(ExternalRoutineInvocationError):
    sqlstate = '39P02'


class EventTriggerProtocolViolatedError(ExternalRoutineInvocationError):
    sqlstate = '39P03'


class SavepointError(_base.PostgresError):
    sqlstate = '3B000'


class InvalidSavepointSpecificationError(SavepointError):
    sqlstate = '3B001'


class InvalidCatalogNameError(_base.PostgresError):
    sqlstate = '3D000'


class InvalidSchemaNameError(_base.PostgresError):
    sqlstate = '3F000'


class TransactionRollbackError(_base.PostgresError):
    sqlstate = '40000'


class TransactionIntegrityConstraintViolationError(TransactionRollbackError):
    sqlstate = '40002'


class SerializationError(TransactionRollbackError):
    sqlstate = '40001'


class StatementCompletionUnknownError(TransactionRollbackError):
    sqlstate = '40003'


class DeadlockDetectedError(TransactionRollbackError):
    sqlstate = '40P01'


class SyntaxOrAccessError(_base.PostgresError):
    sqlstate = '42000'


class PostgresSyntaxError(SyntaxOrAccessError):
    sqlstate = '42601'


class InsufficientPrivilegeError(SyntaxOrAccessError):
    sqlstate = '42501'


class CannotCoerceError(SyntaxOrAccessError):
    sqlstate = '42846'


class GroupingError(SyntaxOrAccessError):
    sqlstate = '42803'


class WindowingError(SyntaxOrAccessError):
    sqlstate = '42P20'


class InvalidRecursionError(SyntaxOrAccessError):
    sqlstate = '42P19'


class InvalidForeignKeyError(SyntaxOrAccessError):
    sqlstate = '42830'


class InvalidNameError(SyntaxOrAccessError):
    sqlstate = '42602'


class NameTooLongError(SyntaxOrAccessError):
    sqlstate = '42622'


class ReservedNameError(SyntaxOrAccessError):
    sqlstate = '42939'


class DatatypeMismatchError(SyntaxOrAccessError):
    sqlstate = '42804'


class IndeterminateDatatypeError(SyntaxOrAccessError):
    sqlstate = '42P18'


class CollationMismatchError(SyntaxOrAccessError):
    sqlstate = '42P21'


class IndeterminateCollationError(SyntaxOrAccessError):
    sqlstate = '42P22'


class WrongObjectTypeError(SyntaxOrAccessError):
    sqlstate = '42809'


class GeneratedAlwaysError(SyntaxOrAccessError):
    sqlstate = '428C9'


class UndefinedColumnError(SyntaxOrAccessError):
    sqlstate = '42703'


class UndefinedFunctionError(SyntaxOrAccessError):
    sqlstate = '42883'


class UndefinedTableError(SyntaxOrAccessError):
    sqlstate = '42P01'


class UndefinedParameterError(SyntaxOrAccessError):
    sqlstate = '42P02'


class UndefinedObjectError(SyntaxOrAccessError):
    sqlstate = '42704'


class DuplicateColumnError(SyntaxOrAccessError):
    sqlstate = '42701'


class DuplicateCursorError(SyntaxOrAccessError):
    sqlstate = '42P03'


class DuplicateDatabaseError(SyntaxOrAccessError):
    sqlstate = '42P04'


class DuplicateFunctionError(SyntaxOrAccessError):
    sqlstate = '42723'


class DuplicatePreparedStatementError(SyntaxOrAccessError):
    sqlstate = '42P05'


class DuplicateSchemaError(SyntaxOrAccessError):
    sqlstate = '42P06'


class DuplicateTableError(SyntaxOrAccessError):
    sqlstate = '42P07'


class DuplicateAliasError(SyntaxOrAccessError):
    sqlstate = '42712'


class DuplicateObjectError(SyntaxOrAccessError):
    sqlstate = '42710'


class AmbiguousColumnError(SyntaxOrAccessError):
    sqlstate = '42702'


class AmbiguousFunctionError(SyntaxOrAccessError):
    sqlstate = '42725'


class AmbiguousParameterError(SyntaxOrAccessError):
    sqlstate = '42P08'


class AmbiguousAliasError(SyntaxOrAccessError):
    sqlstate = '42P09'


class InvalidColumnReferenceError(SyntaxOrAccessError):
    sqlstate = '42P10'


class InvalidColumnDefinitionError(SyntaxOrAccessError):
    sqlstate = '42611'


class InvalidCursorDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P11'


class InvalidDatabaseDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P12'


class InvalidFunctionDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P13'


class InvalidPreparedStatementDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P14'


class InvalidSchemaDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P15'


class InvalidTableDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P16'


class InvalidObjectDefinitionError(SyntaxOrAccessError):
    sqlstate = '42P17'


class WithCheckOptionViolationError(_base.PostgresError):
    sqlstate = '44000'


class InsufficientResourcesError(_base.PostgresError):
    sqlstate = '53000'


class DiskFullError(InsufficientResourcesError):
    sqlstate = '53100'


class OutOfMemoryError(InsufficientResourcesError):
    sqlstate = '53200'


class TooManyConnectionsError(InsufficientResourcesError):
    sqlstate = '53300'


class ConfigurationLimitExceededError(InsufficientResourcesError):
    sqlstate = '53400'


class ProgramLimitExceededError(_base.PostgresError):
    sqlstate = '54000'


class StatementTooComplexError(ProgramLimitExceededError):
    sqlstate = '54001'


class TooManyColumnsError(ProgramLimitExceededError):
    sqlstate = '54011'


class TooManyArgumentsError(ProgramLimitExceededError):
    sqlstate = '54023'


class ObjectNotInPrerequisiteStateError(_base.PostgresError):
    sqlstate = '55000'


class ObjectInUseError(ObjectNotInPrerequisiteStateError):
    sqlstate = '55006'


class CantChangeRuntimeParamError(ObjectNotInPrerequisiteStateError):
    sqlstate = '55P02'


class LockNotAvailableError(ObjectNotInPrerequisiteStateError):
    sqlstate = '55P03'


class UnsafeNewEnumValueUsageError(ObjectNotInPrerequisiteStateError):
    sqlstate = '55P04'


class OperatorInterventionError(_base.PostgresError):
    sqlstate = '57000'


class QueryCanceledError(OperatorInterventionError):
    sqlstate = '57014'


class AdminShutdownError(OperatorInterventionError):
    sqlstate = '57P01'


class CrashShutdownError(OperatorInterventionError):
    sqlstate = '57P02'


class CannotConnectNowError(OperatorInterventionError):
    sqlstate = '57P03'


class DatabaseDroppedError(OperatorInterventionError):
    sqlstate = '57P04'


class IdleSessionTimeoutError(OperatorInterventionError):
    sqlstate = '57P05'


class PostgresSystemError(_base.PostgresError):
    sqlstate = '58000'


class PostgresIOError(PostgresSystemError):
    sqlstate = '58030'


class UndefinedFileError(PostgresSystemError):
    sqlstate = '58P01'


class DuplicateFileError(PostgresSystemError):
    sqlstate = '58P02'


class SnapshotTooOldError(_base.PostgresError):
    sqlstate = '72000'


class ConfigFileError(_base.PostgresError):
    sqlstate = 'F0000'


class LockFileExistsError(ConfigFileError):
    sqlstate = 'F0001'


class FDWError(_base.PostgresError):
    sqlstate = 'HV000'


class FDWColumnNameNotFoundError(FDWError):
    sqlstate = 'HV005'


class FDWDynamicParameterValueNeededError(FDWError):
    sqlstate = 'HV002'


class FDWFunctionSequenceError(FDWError):
    sqlstate = 'HV010'


class FDWInconsistentDescriptorInformationError(FDWError):
    sqlstate = 'HV021'


class FDWInvalidAttributeValueError(FDWError):
    sqlstate = 'HV024'


class FDWInvalidColumnNameError(FDWError):
    sqlstate = 'HV007'


class FDWInvalidColumnNumberError(FDWError):
    sqlstate = 'HV008'


class FDWInvalidDataTypeError(FDWError):
    sqlstate = 'HV004'


class FDWInvalidDataTypeDescriptorsError(FDWError):
    sqlstate = 'HV006'


class FDWInvalidDescriptorFieldIdentifierError(FDWError):
    sqlstate = 'HV091'


class FDWInvalidHandleError(FDWError):
    sqlstate = 'HV00B'


class FDWInvalidOptionIndexError(FDWError):
    sqlstate = 'HV00C'


class FDWInvalidOptionNameError(FDWError):
    sqlstate = 'HV00D'


class FDWInvalidStringLengthOrBufferLengthError(FDWError):
    sqlstate = 'HV090'


class FDWInvalidStringFormatError(FDWError):
    sqlstate = 'HV00A'


class FDWInvalidUseOfNullPointerError(FDWError):
    sqlstate = 'HV009'


class FDWTooManyHandlesError(FDWError):
    sqlstate = 'HV014'


class FDWOutOfMemoryError(FDWError):
    sqlstate = 'HV001'


class FDWNoSchemasError(FDWError):
    sqlstate = 'HV00P'


class FDWOptionNameNotFoundError(FDWError):
    sqlstate = 'HV00J'


class FDWReplyHandleError(FDWError):
    sqlstate = 'HV00K'


class FDWSchemaNotFoundError(FDWError):
    sqlstate = 'HV00Q'


class FDWTableNotFoundError(FDWError):
    sqlstate = 'HV00R'


class FDWUnableToCreateExecutionError(FDWError):
    sqlstate = 'HV00L'


class FDWUnableToCreateReplyError(FDWError):
    sqlstate = 'HV00M'


class FDWUnableToEstablishConnectionError(FDWError):
    sqlstate = 'HV00N'


class PLPGSQLError(_base.PostgresError):
    sqlstate = 'P0000'


class RaiseError(PLPGSQLError):
    sqlstate = 'P0001'


class NoDataFoundError(PLPGSQLError):
    sqlstate = 'P0002'


class TooManyRowsError(PLPGSQLError):
    sqlstate = 'P0003'


class AssertError(PLPGSQLError):
    sqlstate = 'P0004'


class InternalServerError(_base.PostgresError):
    sqlstate = 'XX000'


class DataCorruptedError(InternalServerError):
    sqlstate = 'XX001'


class IndexCorruptedError(InternalServerError):
    sqlstate = 'XX002'


__all__ = (
    'ActiveSQLTransactionError', 'AdminShutdownError',
    'AmbiguousAliasError', 'AmbiguousColumnError',
    'AmbiguousFunctionError', 'AmbiguousParameterError',
    'ArraySubscriptError', 'AssertError', 'BadCopyFileFormatError',
    'BranchTransactionAlreadyActiveError', 'CannotCoerceError',
    'CannotConnectNowError', 'CantChangeRuntimeParamError',
    'CardinalityViolationError', 'CaseNotFoundError',
    'CharacterNotInRepertoireError', 'CheckViolationError',
    'ClientCannotConnectError', 'CollationMismatchError',
    'ConfigFileError', 'ConfigurationLimitExceededError',
    'ConnectionDoesNotExistError', 'ConnectionFailureError',
    'ConnectionRejectionError', 'ContainingSQLNotPermittedError',
    'CrashShutdownError', 'DataCorruptedError', 'DataError',
    'DatabaseDroppedError', 'DatatypeMismatchError',
    'DatetimeFieldOverflowError', 'DeadlockDetectedError',
    'DependentObjectsStillExistError',
    'DependentPrivilegeDescriptorsStillExistError', 'DeprecatedFeature',
    'DiagnosticsError', 'DiskFullError', 'DivisionByZeroError',
    'DuplicateAliasError', 'DuplicateColumnError', 'DuplicateCursorError',
    'DuplicateDatabaseError', 'DuplicateFileError',
    'DuplicateFunctionError', 'DuplicateJsonObjectKeyValueError',
    'DuplicateObjectError', 'DuplicatePreparedStatementError',
    'DuplicateSchemaError', 'DuplicateTableError',
    'DynamicResultSetsReturned', 'ErrorInAssignmentError',
    'EscapeCharacterConflictError', 'EventTriggerProtocolViolatedError',
    'ExclusionViolationError', 'ExternalRoutineError',
    'ExternalRoutineInvocationError', 'FDWColumnNameNotFoundError',
    'FDWDynamicParameterValueNeededError', 'FDWError',
    'FDWFunctionSequenceError',
    'FDWInconsistentDescriptorInformationError',
    'FDWInvalidAttributeValueError', 'FDWInvalidColumnNameError',
    'FDWInvalidColumnNumberError', 'FDWInvalidDataTypeDescriptorsError',
    'FDWInvalidDataTypeError', 'FDWInvalidDescriptorFieldIdentifierError',
    'FDWInvalidHandleError', 'FDWInvalidOptionIndexError',
    'FDWInvalidOptionNameError', 'FDWInvalidStringFormatError',
    'FDWInvalidStringLengthOrBufferLengthError',
    'FDWInvalidUseOfNullPointerError', 'FDWNoSchemasError',
    'FDWOptionNameNotFoundError', 'FDWOutOfMemoryError',
    'FDWReplyHandleError', 'FDWSchemaNotFoundError',
    'FDWTableNotFoundError', 'FDWTooManyHandlesError',
    'FDWUnableToCreateExecutionError', 'FDWUnableToCreateReplyError',
    'FDWUnableToEstablishConnectionError', 'FeatureNotSupportedError',
    'ForeignKeyViolationError', 'FunctionExecutedNoReturnStatementError',
    'GeneratedAlwaysError', 'GroupingError',
    'HeldCursorRequiresSameIsolationLevelError',
    'IdleInTransactionSessionTimeoutError', 'IdleSessionTimeoutError',
    'ImplicitZeroBitPadding', 'InFailedSQLTransactionError',
    'InappropriateAccessModeForBranchTransactionError',
    'InappropriateIsolationLevelForBranchTransactionError',
    'IndeterminateCollationError', 'IndeterminateDatatypeError',
    'IndexCorruptedError', 'IndicatorOverflowError',
    'InsufficientPrivilegeError', 'InsufficientResourcesError',
    'IntegrityConstraintViolationError', 'InternalServerError',
    'IntervalFieldOverflowError', 'InvalidArgumentForLogarithmError',
    'InvalidArgumentForNthValueFunctionError',
    'InvalidArgumentForNtileFunctionError',
    'InvalidArgumentForPowerFunctionError',
    'InvalidArgumentForSQLJsonDatetimeFunctionError',
    'InvalidArgumentForWidthBucketFunctionError',
    'InvalidAuthorizationSpecificationError',
    'InvalidBinaryRepresentationError', 'InvalidCachedStatementError',
    'InvalidCatalogNameError', 'InvalidCharacterValueForCastError',
    'InvalidColumnDefinitionError', 'InvalidColumnReferenceError',
    'InvalidCursorDefinitionError', 'InvalidCursorNameError',
    'InvalidCursorStateError', 'InvalidDatabaseDefinitionError',
    'InvalidDatetimeFormatError', 'InvalidEscapeCharacterError',
    'InvalidEscapeOctetError', 'InvalidEscapeSequenceError',
    'InvalidForeignKeyError', 'InvalidFunctionDefinitionError',
    'InvalidGrantOperationError', 'InvalidGrantorError',
    'InvalidIndicatorParameterValueError', 'InvalidJsonTextError',
    'InvalidLocatorSpecificationError', 'InvalidNameError',
    'InvalidObjectDefinitionError', 'InvalidParameterValueError',
    'InvalidPasswordError', 'InvalidPrecedingOrFollowingSizeError',
    'InvalidPreparedStatementDefinitionError', 'InvalidRecursionError',
    'InvalidRegularExpressionError', 'InvalidRoleSpecificationError',
    'InvalidRowCountInLimitClauseError',
    'InvalidRowCountInResultOffsetClauseError',
    'InvalidSQLJsonSubscriptError', 'InvalidSQLStatementNameError',
    'InvalidSavepointSpecificationError', 'InvalidSchemaDefinitionError',
    'InvalidSchemaNameError', 'InvalidSqlstateReturnedError',
    'InvalidTableDefinitionError', 'InvalidTablesampleArgumentError',
    'InvalidTablesampleRepeatError', 'InvalidTextRepresentationError',
    'InvalidTimeZoneDisplacementValueError',
    'InvalidTransactionInitiationError', 'InvalidTransactionStateError',
    'InvalidTransactionTerminationError',
    'InvalidUseOfEscapeCharacterError', 'InvalidXmlCommentError',
    'InvalidXmlContentError', 'InvalidXmlDocumentError',
    'InvalidXmlProcessingInstructionError', 'LocatorError',
    'LockFileExistsError', 'LockNotAvailableError',
    'ModifyingExternalRoutineSQLDataNotPermittedError',
    'ModifyingSQLDataNotPermittedError', 'MoreThanOneSQLJsonItemError',
    'MostSpecificTypeMismatchError', 'NameTooLongError',
    'NoActiveSQLTransactionError',
    'NoActiveSQLTransactionForBranchTransactionError',
    'NoAdditionalDynamicResultSetsReturned', 'NoData', 'NoDataFoundError',
    'NoSQLJsonItemError', 'NonNumericSQLJsonItemError',
    'NonUniqueKeysInAJsonObjectError',
    'NonstandardUseOfEscapeCharacterError', 'NotAnXmlDocumentError',
    'NotNullViolationError', 'NullValueEliminatedInSetFunction',
    'NullValueInExternalRoutineNotAllowedError',
    'NullValueNoIndicatorParameterError', 'NullValueNotAllowedError',
    'NumericValueOutOfRangeError', 'ObjectInUseError',
    'ObjectNotInPrerequisiteStateError', 'OperatorInterventionError',
    'OutOfMemoryError', 'PLPGSQLError', 'PostgresConnectionError',
    'PostgresFloatingPointError', 'PostgresIOError',
    'PostgresSyntaxError', 'PostgresSystemError', 'PostgresWarning',
    'PrivilegeNotGranted', 'PrivilegeNotRevoked',
    'ProgramLimitExceededError',
    'ProhibitedExternalRoutineSQLStatementAttemptedError',
    'ProhibitedSQLStatementAttemptedError', 'ProtocolViolationError',
    'QueryCanceledError', 'RaiseError', 'ReadOnlySQLTransactionError',
    'ReadingExternalRoutineSQLDataNotPermittedError',
    'ReadingSQLDataNotPermittedError', 'ReservedNameError',
    'RestrictViolationError', 'SQLJsonArrayNotFoundError',
    'SQLJsonItemCannotBeCastToTargetTypeError',
    'SQLJsonMemberNotFoundError', 'SQLJsonNumberNotFoundError',
    'SQLJsonObjectNotFoundError', 'SQLJsonScalarRequiredError',
    'SQLRoutineError', 'SQLStatementNotYetCompleteError',
    'SavepointError', 'SchemaAndDataStatementMixingNotSupportedError',
    'SequenceGeneratorLimitExceededError', 'SerializationError',
    'SingletonSQLJsonItemRequiredError', 'SnapshotTooOldError',
    'SrfProtocolViolatedError',
    'StackedDiagnosticsAccessedWithoutActiveHandlerError',
    'StatementCompletionUnknownError', 'StatementTooComplexError',
    'StringDataLengthMismatchError', 'StringDataRightTruncation',
    'StringDataRightTruncationError', 'SubstringError',
    'SyntaxOrAccessError', 'TooManyArgumentsError', 'TooManyColumnsError',
    'TooManyConnectionsError', 'TooManyJsonArrayElementsError',
    'TooManyJsonObjectMembersError', 'TooManyRowsError',
    'TransactionIntegrityConstraintViolationError',
    'TransactionResolutionUnknownError', 'TransactionRollbackError',
    'TriggerProtocolViolatedError', 'TriggeredActionError',
    'TriggeredDataChangeViolationError', 'TrimError',
    'UndefinedColumnError', 'UndefinedFileError',
    'UndefinedFunctionError', 'UndefinedObjectError',
    'UndefinedParameterError', 'UndefinedTableError',
    'UniqueViolationError', 'UnsafeNewEnumValueUsageError',
    'UnterminatedCStringError', 'UntranslatableCharacterError',
    'WindowingError', 'WithCheckOptionViolationError',
    'WrongObjectTypeError', 'ZeroLengthCharacterStringError'
)

__all__ += _base.__all__

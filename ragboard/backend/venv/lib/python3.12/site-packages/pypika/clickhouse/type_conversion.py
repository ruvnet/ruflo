from pypika.terms import (
    Field,
    Function,
)
from pypika.utils import format_alias_sql


class ToString(Function):
    def __init__(self, name, alias: str = None):
        super(ToString, self).__init__("toString", name, alias=alias)


class ToFixedString(Function):
    def __init__(self, field, length: int, alias: str = None, schema: str = None):
        self._length = length
        self._field = field
        self.alias = alias
        self.name = "toFixedString"
        self.schema = schema
        self.args = ()

    def get_sql(self, with_alias=False, with_namespace=False, quote_char=None, dialect=None, **kwargs):
        sql = "{name}({field},{length})".format(
            name=self.name,
            field=self._field if isinstance(self._field, Field) else "'%s'" % str(self._field),
            length=self._length,
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class ToInt8(Function):
    def __init__(self, name, alias: str = None):
        super(ToInt8, self).__init__("toInt8", name, alias=alias)


class ToInt16(Function):
    def __init__(self, name, alias: str = None):
        super(ToInt16, self).__init__("toInt16", name, alias=alias)


class ToInt32(Function):
    def __init__(self, name, alias: str = None):
        super(ToInt32, self).__init__("toInt32", name, alias=alias)


class ToInt64(Function):
    def __init__(self, name, alias: str = None):
        super(ToInt64, self).__init__("toInt64", name, alias=alias)


class ToUInt8(Function):
    def __init__(self, name, alias: str = None):
        super(ToUInt8, self).__init__("toUInt8", name, alias=alias)


class ToUInt16(Function):
    def __init__(self, name, alias: str = None):
        super(ToUInt16, self).__init__("toUInt16", name, alias=alias)


class ToUInt32(Function):
    def __init__(self, name, alias: str = None):
        super(ToUInt32, self).__init__("toUInt32", name, alias=alias)


class ToUInt64(Function):
    def __init__(self, name, alias: str = None):
        super(ToUInt64, self).__init__("toUInt64", name, alias=alias)


class ToFloat32(Function):
    def __init__(self, name, alias: str = None):
        super(ToFloat32, self).__init__("toFloat32", name, alias=alias)


class ToFloat64(Function):
    def __init__(self, name, alias: str = None):
        super(ToFloat64, self).__init__("toFloat64", name, alias=alias)


class ToDate(Function):
    def __init__(self, name, alias: str = None):
        super(ToDate, self).__init__("toDate", name, alias=alias)


class ToDateTime(Function):
    def __init__(self, name, alias: str = None):
        super(ToDateTime, self).__init__("toDateTime", name, alias=alias)

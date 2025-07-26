from itertools import zip_longest

from sqlalchemy import schema
from sqlalchemy.sql.elements import ClauseList


class CompareTable:
    def __init__(self, table):
        self.table = table

    def __eq__(self, other):
        if self.table.name != other.name or self.table.schema != other.schema:
            return False

        for c1, c2 in zip_longest(self.table.c, other.c):
            if (c1 is None and c2 is not None) or (
                c2 is None and c1 is not None
            ):
                return False
            if CompareColumn(c1) != c2:
                return False

        return True

        # TODO: compare constraints, indexes

    def __ne__(self, other):
        return not self.__eq__(other)


class CompareColumn:
    def __init__(self, column):
        self.column = column

    def __eq__(self, other):
        return (
            self.column.name == other.name
            and self.column.nullable == other.nullable
        )
        # TODO: datatypes etc

    def __ne__(self, other):
        return not self.__eq__(other)


class CompareIndex:
    def __init__(self, index, name_only=False):
        self.index = index
        self.name_only = name_only

    def __eq__(self, other):
        if self.name_only:
            return self.index.name == other.name
        else:
            return (
                str(schema.CreateIndex(self.index))
                == str(schema.CreateIndex(other))
                and self.index.dialect_kwargs == other.dialect_kwargs
            )

    def __ne__(self, other):
        return not self.__eq__(other)

    def __repr__(self):
        expr = ClauseList(*self.index.expressions)
        try:
            expr_str = expr.compile().string
        except Exception:
            expr_str = str(expr)
        return f"<CompareIndex {self.index.name}({expr_str})>"


class CompareCheckConstraint:
    def __init__(self, constraint):
        self.constraint = constraint

    def __eq__(self, other):
        return (
            isinstance(other, schema.CheckConstraint)
            and self.constraint.name == other.name
            and (str(self.constraint.sqltext) == str(other.sqltext))
            and (other.table.name == self.constraint.table.name)
            and other.table.schema == self.constraint.table.schema
        )

    def __ne__(self, other):
        return not self.__eq__(other)


class CompareForeignKey:
    def __init__(self, constraint):
        self.constraint = constraint

    def __eq__(self, other):
        r1 = (
            isinstance(other, schema.ForeignKeyConstraint)
            and self.constraint.name == other.name
            and (other.table.name == self.constraint.table.name)
            and other.table.schema == self.constraint.table.schema
        )
        if not r1:
            return False
        for c1, c2 in zip_longest(self.constraint.columns, other.columns):
            if (c1 is None and c2 is not None) or (
                c2 is None and c1 is not None
            ):
                return False
            if CompareColumn(c1) != c2:
                return False
        return True

    def __ne__(self, other):
        return not self.__eq__(other)


class ComparePrimaryKey:
    def __init__(self, constraint):
        self.constraint = constraint

    def __eq__(self, other):
        r1 = (
            isinstance(other, schema.PrimaryKeyConstraint)
            and self.constraint.name == other.name
            and (other.table.name == self.constraint.table.name)
            and other.table.schema == self.constraint.table.schema
        )
        if not r1:
            return False

        for c1, c2 in zip_longest(self.constraint.columns, other.columns):
            if (c1 is None and c2 is not None) or (
                c2 is None and c1 is not None
            ):
                return False
            if CompareColumn(c1) != c2:
                return False

        return True

    def __ne__(self, other):
        return not self.__eq__(other)


class CompareUniqueConstraint:
    def __init__(self, constraint):
        self.constraint = constraint

    def __eq__(self, other):
        r1 = (
            isinstance(other, schema.UniqueConstraint)
            and self.constraint.name == other.name
            and (other.table.name == self.constraint.table.name)
            and other.table.schema == self.constraint.table.schema
        )
        if not r1:
            return False

        for c1, c2 in zip_longest(self.constraint.columns, other.columns):
            if (c1 is None and c2 is not None) or (
                c2 is None and c1 is not None
            ):
                return False
            if CompareColumn(c1) != c2:
                return False

        return True

    def __ne__(self, other):
        return not self.__eq__(other)

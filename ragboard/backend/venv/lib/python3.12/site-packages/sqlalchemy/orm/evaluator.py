# orm/evaluator.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

"""Evaluation functions used **INTERNALLY** by ORM DML use cases.


This module is **private, for internal use by SQLAlchemy**.

.. versionchanged:: 2.0.4 renamed ``EvaluatorCompiler`` to
   ``_EvaluatorCompiler``.

"""


from __future__ import annotations

from typing import Type

from . import exc as orm_exc
from .base import LoaderCallableStatus
from .base import PassiveFlag
from .. import exc
from .. import inspect
from ..sql import and_
from ..sql import operators
from ..sql.sqltypes import Integer
from ..sql.sqltypes import Numeric
from ..util import warn_deprecated


class UnevaluatableError(exc.InvalidRequestError):
    pass


class _NoObject(operators.ColumnOperators):
    def operate(self, *arg, **kw):
        return None

    def reverse_operate(self, *arg, **kw):
        return None


class _ExpiredObject(operators.ColumnOperators):
    def operate(self, *arg, **kw):
        return self

    def reverse_operate(self, *arg, **kw):
        return self


_NO_OBJECT = _NoObject()
_EXPIRED_OBJECT = _ExpiredObject()


class _EvaluatorCompiler:
    def __init__(self, target_cls=None):
        self.target_cls = target_cls

    def process(self, clause, *clauses):
        if clauses:
            clause = and_(clause, *clauses)

        meth = getattr(self, f"visit_{clause.__visit_name__}", None)
        if not meth:
            raise UnevaluatableError(
                f"Cannot evaluate {type(clause).__name__}"
            )
        return meth(clause)

    def visit_grouping(self, clause):
        return self.process(clause.element)

    def visit_null(self, clause):
        return lambda obj: None

    def visit_false(self, clause):
        return lambda obj: False

    def visit_true(self, clause):
        return lambda obj: True

    def visit_column(self, clause):
        try:
            parentmapper = clause._annotations["parentmapper"]
        except KeyError as ke:
            raise UnevaluatableError(
                f"Cannot evaluate column: {clause}"
            ) from ke

        if self.target_cls and not issubclass(
            self.target_cls, parentmapper.class_
        ):
            raise UnevaluatableError(
                "Can't evaluate criteria against "
                f"alternate class {parentmapper.class_}"
            )

        parentmapper._check_configure()

        # we'd like to use "proxy_key" annotation to get the "key", however
        # in relationship primaryjoin cases proxy_key is sometimes deannotated
        # and sometimes apparently not present in the first place (?).
        # While I can stop it from being deannotated (though need to see if
        # this breaks other things), not sure right now  about cases where it's
        # not there in the first place.  can fix at some later point.
        # key = clause._annotations["proxy_key"]

        # for now, use the old way
        try:
            key = parentmapper._columntoproperty[clause].key
        except orm_exc.UnmappedColumnError as err:
            raise UnevaluatableError(
                f"Cannot evaluate expression: {err}"
            ) from err

        # note this used to fall back to a simple `getattr(obj, key)` evaluator
        # if impl was None; as of #8656, we ensure mappers are configured
        # so that impl is available
        impl = parentmapper.class_manager[key].impl

        def get_corresponding_attr(obj):
            if obj is None:
                return _NO_OBJECT
            state = inspect(obj)
            dict_ = state.dict

            value = impl.get(
                state, dict_, passive=PassiveFlag.PASSIVE_NO_FETCH
            )
            if value is LoaderCallableStatus.PASSIVE_NO_RESULT:
                return _EXPIRED_OBJECT
            return value

        return get_corresponding_attr

    def visit_tuple(self, clause):
        return self.visit_clauselist(clause)

    def visit_expression_clauselist(self, clause):
        return self.visit_clauselist(clause)

    def visit_clauselist(self, clause):
        evaluators = [self.process(clause) for clause in clause.clauses]

        dispatch = (
            f"visit_{clause.operator.__name__.rstrip('_')}_clauselist_op"
        )
        meth = getattr(self, dispatch, None)
        if meth:
            return meth(clause.operator, evaluators, clause)
        else:
            raise UnevaluatableError(
                f"Cannot evaluate clauselist with operator {clause.operator}"
            )

    def visit_binary(self, clause):
        eval_left = self.process(clause.left)
        eval_right = self.process(clause.right)

        dispatch = f"visit_{clause.operator.__name__.rstrip('_')}_binary_op"
        meth = getattr(self, dispatch, None)
        if meth:
            return meth(clause.operator, eval_left, eval_right, clause)
        else:
            raise UnevaluatableError(
                f"Cannot evaluate {type(clause).__name__} with "
                f"operator {clause.operator}"
            )

    def visit_or_clauselist_op(self, operator, evaluators, clause):
        def evaluate(obj):
            has_null = False
            for sub_evaluate in evaluators:
                value = sub_evaluate(obj)
                if value is _EXPIRED_OBJECT:
                    return _EXPIRED_OBJECT
                elif value:
                    return True
                has_null = has_null or value is None
            if has_null:
                return None
            return False

        return evaluate

    def visit_and_clauselist_op(self, operator, evaluators, clause):
        def evaluate(obj):
            for sub_evaluate in evaluators:
                value = sub_evaluate(obj)
                if value is _EXPIRED_OBJECT:
                    return _EXPIRED_OBJECT

                if not value:
                    if value is None or value is _NO_OBJECT:
                        return None
                    return False
            return True

        return evaluate

    def visit_comma_op_clauselist_op(self, operator, evaluators, clause):
        def evaluate(obj):
            values = []
            for sub_evaluate in evaluators:
                value = sub_evaluate(obj)
                if value is _EXPIRED_OBJECT:
                    return _EXPIRED_OBJECT
                elif value is None or value is _NO_OBJECT:
                    return None
                values.append(value)
            return tuple(values)

        return evaluate

    def visit_custom_op_binary_op(
        self, operator, eval_left, eval_right, clause
    ):
        if operator.python_impl:
            return self._straight_evaluate(
                operator, eval_left, eval_right, clause
            )
        else:
            raise UnevaluatableError(
                f"Custom operator {operator.opstring!r} can't be evaluated "
                "in Python unless it specifies a callable using "
                "`.python_impl`."
            )

    def visit_is_binary_op(self, operator, eval_left, eval_right, clause):
        def evaluate(obj):
            left_val = eval_left(obj)
            right_val = eval_right(obj)
            if left_val is _EXPIRED_OBJECT or right_val is _EXPIRED_OBJECT:
                return _EXPIRED_OBJECT
            return left_val == right_val

        return evaluate

    def visit_is_not_binary_op(self, operator, eval_left, eval_right, clause):
        def evaluate(obj):
            left_val = eval_left(obj)
            right_val = eval_right(obj)
            if left_val is _EXPIRED_OBJECT or right_val is _EXPIRED_OBJECT:
                return _EXPIRED_OBJECT
            return left_val != right_val

        return evaluate

    def _straight_evaluate(self, operator, eval_left, eval_right, clause):
        def evaluate(obj):
            left_val = eval_left(obj)
            right_val = eval_right(obj)
            if left_val is _EXPIRED_OBJECT or right_val is _EXPIRED_OBJECT:
                return _EXPIRED_OBJECT
            elif left_val is None or right_val is None:
                return None

            return operator(eval_left(obj), eval_right(obj))

        return evaluate

    def _straight_evaluate_numeric_only(
        self, operator, eval_left, eval_right, clause
    ):
        if clause.left.type._type_affinity not in (
            Numeric,
            Integer,
        ) or clause.right.type._type_affinity not in (Numeric, Integer):
            raise UnevaluatableError(
                f'Cannot evaluate math operator "{operator.__name__}" for '
                f"datatypes {clause.left.type}, {clause.right.type}"
            )

        return self._straight_evaluate(operator, eval_left, eval_right, clause)

    visit_add_binary_op = _straight_evaluate_numeric_only
    visit_mul_binary_op = _straight_evaluate_numeric_only
    visit_sub_binary_op = _straight_evaluate_numeric_only
    visit_mod_binary_op = _straight_evaluate_numeric_only
    visit_truediv_binary_op = _straight_evaluate_numeric_only
    visit_lt_binary_op = _straight_evaluate
    visit_le_binary_op = _straight_evaluate
    visit_ne_binary_op = _straight_evaluate
    visit_gt_binary_op = _straight_evaluate
    visit_ge_binary_op = _straight_evaluate
    visit_eq_binary_op = _straight_evaluate

    def visit_in_op_binary_op(self, operator, eval_left, eval_right, clause):
        return self._straight_evaluate(
            lambda a, b: a in b if a is not _NO_OBJECT else None,
            eval_left,
            eval_right,
            clause,
        )

    def visit_not_in_op_binary_op(
        self, operator, eval_left, eval_right, clause
    ):
        return self._straight_evaluate(
            lambda a, b: a not in b if a is not _NO_OBJECT else None,
            eval_left,
            eval_right,
            clause,
        )

    def visit_concat_op_binary_op(
        self, operator, eval_left, eval_right, clause
    ):
        return self._straight_evaluate(
            lambda a, b: a + b, eval_left, eval_right, clause
        )

    def visit_startswith_op_binary_op(
        self, operator, eval_left, eval_right, clause
    ):
        return self._straight_evaluate(
            lambda a, b: a.startswith(b), eval_left, eval_right, clause
        )

    def visit_endswith_op_binary_op(
        self, operator, eval_left, eval_right, clause
    ):
        return self._straight_evaluate(
            lambda a, b: a.endswith(b), eval_left, eval_right, clause
        )

    def visit_unary(self, clause):
        eval_inner = self.process(clause.element)
        if clause.operator is operators.inv:

            def evaluate(obj):
                value = eval_inner(obj)
                if value is _EXPIRED_OBJECT:
                    return _EXPIRED_OBJECT
                elif value is None:
                    return None
                return not value

            return evaluate
        raise UnevaluatableError(
            f"Cannot evaluate {type(clause).__name__} "
            f"with operator {clause.operator}"
        )

    def visit_bindparam(self, clause):
        if clause.callable:
            val = clause.callable()
        else:
            val = clause.value
        return lambda obj: val


def __getattr__(name: str) -> Type[_EvaluatorCompiler]:
    if name == "EvaluatorCompiler":
        warn_deprecated(
            "Direct use of 'EvaluatorCompiler' is not supported, and this "
            "name will be removed in a future release.  "
            "'_EvaluatorCompiler' is for internal use only",
            "2.0",
        )
        return _EvaluatorCompiler
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

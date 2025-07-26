# Adapted from https://stackoverflow.com/a/9558001/2536294

import ast
import operator as op
from dataclasses import dataclass

from ._multiprocessing_helpers import mp

if mp is not None:
    from .externals.loky.process_executor import _ExceptionWithTraceback


# supported operators
operators = {
    ast.Add: op.add,
    ast.Sub: op.sub,
    ast.Mult: op.mul,
    ast.Div: op.truediv,
    ast.FloorDiv: op.floordiv,
    ast.Mod: op.mod,
    ast.Pow: op.pow,
    ast.USub: op.neg,
}


def eval_expr(expr):
    """
    >>> eval_expr('2*6')
    12
    >>> eval_expr('2**6')
    64
    >>> eval_expr('1 + 2*3**(4) / (6 + -7)')
    -161.0
    """
    try:
        return eval_(ast.parse(expr, mode="eval").body)
    except (TypeError, SyntaxError, KeyError) as e:
        raise ValueError(
            f"{expr!r} is not a valid or supported arithmetic expression."
        ) from e


def eval_(node):
    if isinstance(node, ast.Constant):  # <constant>
        return node.value
    elif isinstance(node, ast.BinOp):  # <left> <operator> <right>
        return operators[type(node.op)](eval_(node.left), eval_(node.right))
    elif isinstance(node, ast.UnaryOp):  # <operator> <operand> e.g., -1
        return operators[type(node.op)](eval_(node.operand))
    else:
        raise TypeError(node)


@dataclass(frozen=True)
class _Sentinel:
    """A sentinel to mark a parameter as not explicitly set"""

    default_value: object

    def __repr__(self):
        return f"default({self.default_value!r})"


class _TracebackCapturingWrapper:
    """Protect function call and return error with traceback."""

    def __init__(self, func):
        self.func = func

    def __call__(self, **kwargs):
        try:
            return self.func(**kwargs)
        except BaseException as e:
            return _ExceptionWithTraceback(e)


def _retrieve_traceback_capturing_wrapped_call(out):
    if isinstance(out, _ExceptionWithTraceback):
        rebuild, args = out.__reduce__()
        out = rebuild(*args)
    if isinstance(out, BaseException):
        raise out
    return out

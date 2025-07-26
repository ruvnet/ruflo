class MaxEvalError(Exception):
    """
    Exception raised when the maximum number of evaluations is reached.
    """


class TargetSuccess(Exception):
    """
    Exception raised when the target value is reached.
    """


class CallbackSuccess(StopIteration):
    """
    Exception raised when the callback function raises a ``StopIteration``.
    """


class FeasibleSuccess(Exception):
    """
    Exception raised when a feasible point of a feasible problem is found.
    """

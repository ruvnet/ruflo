from pypika.terms import Function


class If(Function):
    def __init__(self, *conditions, **kwargs):
        super().__init__("if", *conditions, **kwargs)


class MultiIf(Function):
    def __init__(self, *conditions, **kwargs):
        super().__init__("multiIf", *conditions, **kwargs)

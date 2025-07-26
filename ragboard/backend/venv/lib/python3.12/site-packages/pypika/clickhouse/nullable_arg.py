from pypika.terms import Function


class IfNull(Function):
    def __init__(self, term, alt, **kwargs):
        super().__init__("ifNull", term, alt, **kwargs)

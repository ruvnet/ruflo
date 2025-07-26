"""Custom maps, sequences, etc."""


from __future__ import annotations


class HashedSeq(list):
    """Hashed Sequence.

    Type used for hash() to make sure the hash is not generated
    multiple times.
    """

    __slots__ = 'hashvalue'

    def __init__(self, *seq):
        self[:] = seq
        self.hashvalue = hash(seq)

    def __hash__(self):
        return self.hashvalue


def eqhash(o):
    """Call ``obj.__eqhash__``."""
    try:
        return o.__eqhash__()
    except AttributeError:
        return hash(o)


class EqualityDict(dict):
    """Dict using the eq operator for keying."""

    def __getitem__(self, key):
        h = eqhash(key)
        if h not in self:
            return self.__missing__(key)
        return super().__getitem__(h)

    def __setitem__(self, key, value):
        return super().__setitem__(eqhash(key), value)

    def __delitem__(self, key):
        return super().__delitem__(eqhash(key))

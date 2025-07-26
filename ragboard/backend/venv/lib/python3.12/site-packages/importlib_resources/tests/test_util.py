import unittest

from .util import MemorySetup, Traversable


class TestMemoryTraversableImplementation(unittest.TestCase):
    def test_concrete_methods_are_not_overridden(self):
        """`MemoryTraversable` must not override `Traversable` concrete methods.

        This test is not an attempt to enforce a particular `Traversable` protocol;
        it merely catches changes in the `Traversable` abstract/concrete methods
        that have not been mirrored in the `MemoryTraversable` subclass.
        """

        traversable_concrete_methods = {
            method
            for method, value in Traversable.__dict__.items()
            if callable(value) and method not in Traversable.__abstractmethods__
        }
        memory_traversable_concrete_methods = {
            method
            for method, value in MemorySetup.MemoryTraversable.__dict__.items()
            if callable(value) and not method.startswith("__")
        }
        overridden_methods = (
            memory_traversable_concrete_methods & traversable_concrete_methods
        )

        assert not overridden_methods

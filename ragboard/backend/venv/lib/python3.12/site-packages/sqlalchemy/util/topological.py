# util/topological.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Topological sorting algorithms."""

from __future__ import annotations

from typing import Any
from typing import Collection
from typing import DefaultDict
from typing import Iterable
from typing import Iterator
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import TypeVar

from .. import util
from ..exc import CircularDependencyError

_T = TypeVar("_T", bound=Any)

__all__ = ["sort", "sort_as_subsets", "find_cycles"]


def sort_as_subsets(
    tuples: Collection[Tuple[_T, _T]], allitems: Collection[_T]
) -> Iterator[Sequence[_T]]:
    edges: DefaultDict[_T, Set[_T]] = util.defaultdict(set)
    for parent, child in tuples:
        edges[child].add(parent)

    todo = list(allitems)
    todo_set = set(allitems)

    while todo_set:
        output = []
        for node in todo:
            if todo_set.isdisjoint(edges[node]):
                output.append(node)

        if not output:
            raise CircularDependencyError(
                "Circular dependency detected.",
                find_cycles(tuples, allitems),
                _gen_edges(edges),
            )

        todo_set.difference_update(output)
        todo = [t for t in todo if t in todo_set]
        yield output


def sort(
    tuples: Collection[Tuple[_T, _T]],
    allitems: Collection[_T],
    deterministic_order: bool = True,
) -> Iterator[_T]:
    """sort the given list of items by dependency.

    'tuples' is a list of tuples representing a partial ordering.

    deterministic_order is no longer used, the order is now always
    deterministic given the order of "allitems".    the flag is there
    for backwards compatibility with Alembic.

    """

    for set_ in sort_as_subsets(tuples, allitems):
        yield from set_


def find_cycles(
    tuples: Iterable[Tuple[_T, _T]], allitems: Iterable[_T]
) -> Set[_T]:
    # adapted from:
    # https://neopythonic.blogspot.com/2009/01/detecting-cycles-in-directed-graph.html

    edges: DefaultDict[_T, Set[_T]] = util.defaultdict(set)
    for parent, child in tuples:
        edges[parent].add(child)
    nodes_to_test = set(edges)

    output = set()

    # we'd like to find all nodes that are
    # involved in cycles, so we do the full
    # pass through the whole thing for each
    # node in the original list.

    # we can go just through parent edge nodes.
    # if a node is only a child and never a parent,
    # by definition it can't be part of a cycle.  same
    # if it's not in the edges at all.
    for node in nodes_to_test:
        stack = [node]
        todo = nodes_to_test.difference(stack)
        while stack:
            top = stack[-1]
            for node in edges[top]:
                if node in stack:
                    cyc = stack[stack.index(node) :]
                    todo.difference_update(cyc)
                    output.update(cyc)

                if node in todo:
                    stack.append(node)
                    todo.remove(node)
                    break
            else:
                node = stack.pop()
    return output


def _gen_edges(edges: DefaultDict[_T, Set[_T]]) -> Set[Tuple[_T, _T]]:
    return {(right, left) for left in edges for right in edges[left]}

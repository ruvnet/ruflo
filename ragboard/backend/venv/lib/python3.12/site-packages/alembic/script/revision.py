from __future__ import annotations

import collections
import re
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Deque
from typing import Dict
from typing import FrozenSet
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Optional
from typing import overload
from typing import Protocol
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from sqlalchemy import util as sqlautil

from .. import util
from ..util import not_none

if TYPE_CHECKING:
    from typing import Literal

_RevIdType = Union[str, List[str], Tuple[str, ...]]
_GetRevArg = Union[
    str,
    Iterable[Optional[str]],
    Iterable[str],
]
_RevisionIdentifierType = Union[str, Tuple[str, ...], None]
_RevisionOrStr = Union["Revision", str]
_RevisionOrBase = Union["Revision", "Literal['base']"]
_InterimRevisionMapType = Dict[str, "Revision"]
_RevisionMapType = Dict[Union[None, str, Tuple[()]], Optional["Revision"]]
_T = TypeVar("_T")
_TR = TypeVar("_TR", bound=Optional[_RevisionOrStr])

_relative_destination = re.compile(r"(?:(.+?)@)?(\w+)?((?:\+|-)\d+)")
_revision_illegal_chars = ["@", "-", "+"]


class _CollectRevisionsProtocol(Protocol):
    def __call__(
        self,
        upper: _RevisionIdentifierType,
        lower: _RevisionIdentifierType,
        inclusive: bool,
        implicit_base: bool,
        assert_relative_length: bool,
    ) -> Tuple[Set[Revision], Tuple[Optional[_RevisionOrBase], ...]]:
        ...


class RevisionError(Exception):
    pass


class RangeNotAncestorError(RevisionError):
    def __init__(
        self, lower: _RevisionIdentifierType, upper: _RevisionIdentifierType
    ) -> None:
        self.lower = lower
        self.upper = upper
        super().__init__(
            "Revision %s is not an ancestor of revision %s"
            % (lower or "base", upper or "base")
        )


class MultipleHeads(RevisionError):
    def __init__(self, heads: Sequence[str], argument: Optional[str]) -> None:
        self.heads = heads
        self.argument = argument
        super().__init__(
            "Multiple heads are present for given argument '%s'; "
            "%s" % (argument, ", ".join(heads))
        )


class ResolutionError(RevisionError):
    def __init__(self, message: str, argument: str) -> None:
        super().__init__(message)
        self.argument = argument


class CycleDetected(RevisionError):
    kind = "Cycle"

    def __init__(self, revisions: Sequence[str]) -> None:
        self.revisions = revisions
        super().__init__(
            "%s is detected in revisions (%s)"
            % (self.kind, ", ".join(revisions))
        )


class DependencyCycleDetected(CycleDetected):
    kind = "Dependency cycle"

    def __init__(self, revisions: Sequence[str]) -> None:
        super().__init__(revisions)


class LoopDetected(CycleDetected):
    kind = "Self-loop"

    def __init__(self, revision: str) -> None:
        super().__init__([revision])


class DependencyLoopDetected(DependencyCycleDetected, LoopDetected):
    kind = "Dependency self-loop"

    def __init__(self, revision: Sequence[str]) -> None:
        super().__init__(revision)


class RevisionMap:
    """Maintains a map of :class:`.Revision` objects.

    :class:`.RevisionMap` is used by :class:`.ScriptDirectory` to maintain
    and traverse the collection of :class:`.Script` objects, which are
    themselves instances of :class:`.Revision`.

    """

    def __init__(self, generator: Callable[[], Iterable[Revision]]) -> None:
        """Construct a new :class:`.RevisionMap`.

        :param generator: a zero-arg callable that will generate an iterable
         of :class:`.Revision` instances to be used.   These are typically
         :class:`.Script` subclasses within regular Alembic use.

        """
        self._generator = generator

    @util.memoized_property
    def heads(self) -> Tuple[str, ...]:
        """All "head" revisions as strings.

        This is normally a tuple of length one,
        unless unmerged branches are present.

        :return: a tuple of string revision numbers.

        """
        self._revision_map
        return self.heads

    @util.memoized_property
    def bases(self) -> Tuple[str, ...]:
        """All "base" revisions as strings.

        These are revisions that have a ``down_revision`` of None,
        or empty tuple.

        :return: a tuple of string revision numbers.

        """
        self._revision_map
        return self.bases

    @util.memoized_property
    def _real_heads(self) -> Tuple[str, ...]:
        """All "real" head revisions as strings.

        :return: a tuple of string revision numbers.

        """
        self._revision_map
        return self._real_heads

    @util.memoized_property
    def _real_bases(self) -> Tuple[str, ...]:
        """All "real" base revisions as strings.

        :return: a tuple of string revision numbers.

        """
        self._revision_map
        return self._real_bases

    @util.memoized_property
    def _revision_map(self) -> _RevisionMapType:
        """memoized attribute, initializes the revision map from the
        initial collection.

        """
        # Ordering required for some tests to pass (but not required in
        # general)
        map_: _InterimRevisionMapType = sqlautil.OrderedDict()

        heads: Set[Revision] = sqlautil.OrderedSet()
        _real_heads: Set[Revision] = sqlautil.OrderedSet()
        bases: Tuple[Revision, ...] = ()
        _real_bases: Tuple[Revision, ...] = ()

        has_branch_labels = set()
        all_revisions = set()

        for revision in self._generator():
            all_revisions.add(revision)

            if revision.revision in map_:
                util.warn(
                    "Revision %s is present more than once" % revision.revision
                )
            map_[revision.revision] = revision
            if revision.branch_labels:
                has_branch_labels.add(revision)

            heads.add(revision)
            _real_heads.add(revision)
            if revision.is_base:
                bases += (revision,)
            if revision._is_real_base:
                _real_bases += (revision,)

        # add the branch_labels to the map_.  We'll need these
        # to resolve the dependencies.
        rev_map = map_.copy()
        self._map_branch_labels(
            has_branch_labels, cast(_RevisionMapType, map_)
        )

        # resolve dependency names from branch labels and symbolic
        # names
        self._add_depends_on(all_revisions, cast(_RevisionMapType, map_))

        for rev in map_.values():
            for downrev in rev._all_down_revisions:
                if downrev not in map_:
                    util.warn(
                        "Revision %s referenced from %s is not present"
                        % (downrev, rev)
                    )
                down_revision = map_[downrev]
                down_revision.add_nextrev(rev)
                if downrev in rev._versioned_down_revisions:
                    heads.discard(down_revision)
                _real_heads.discard(down_revision)

        # once the map has downrevisions populated, the dependencies
        # can be further refined to include only those which are not
        # already ancestors
        self._normalize_depends_on(all_revisions, cast(_RevisionMapType, map_))
        self._detect_cycles(rev_map, heads, bases, _real_heads, _real_bases)

        revision_map: _RevisionMapType = dict(map_.items())
        revision_map[None] = revision_map[()] = None
        self.heads = tuple(rev.revision for rev in heads)
        self._real_heads = tuple(rev.revision for rev in _real_heads)
        self.bases = tuple(rev.revision for rev in bases)
        self._real_bases = tuple(rev.revision for rev in _real_bases)

        self._add_branches(has_branch_labels, revision_map)
        return revision_map

    def _detect_cycles(
        self,
        rev_map: _InterimRevisionMapType,
        heads: Set[Revision],
        bases: Tuple[Revision, ...],
        _real_heads: Set[Revision],
        _real_bases: Tuple[Revision, ...],
    ) -> None:
        if not rev_map:
            return
        if not heads or not bases:
            raise CycleDetected(list(rev_map))
        total_space = {
            rev.revision
            for rev in self._iterate_related_revisions(
                lambda r: r._versioned_down_revisions,
                heads,
                map_=cast(_RevisionMapType, rev_map),
            )
        }.intersection(
            rev.revision
            for rev in self._iterate_related_revisions(
                lambda r: r.nextrev,
                bases,
                map_=cast(_RevisionMapType, rev_map),
            )
        )
        deleted_revs = set(rev_map.keys()) - total_space
        if deleted_revs:
            raise CycleDetected(sorted(deleted_revs))

        if not _real_heads or not _real_bases:
            raise DependencyCycleDetected(list(rev_map))
        total_space = {
            rev.revision
            for rev in self._iterate_related_revisions(
                lambda r: r._all_down_revisions,
                _real_heads,
                map_=cast(_RevisionMapType, rev_map),
            )
        }.intersection(
            rev.revision
            for rev in self._iterate_related_revisions(
                lambda r: r._all_nextrev,
                _real_bases,
                map_=cast(_RevisionMapType, rev_map),
            )
        )
        deleted_revs = set(rev_map.keys()) - total_space
        if deleted_revs:
            raise DependencyCycleDetected(sorted(deleted_revs))

    def _map_branch_labels(
        self, revisions: Collection[Revision], map_: _RevisionMapType
    ) -> None:
        for revision in revisions:
            if revision.branch_labels:
                assert revision._orig_branch_labels is not None
                for branch_label in revision._orig_branch_labels:
                    if branch_label in map_:
                        map_rev = map_[branch_label]
                        assert map_rev is not None
                        raise RevisionError(
                            "Branch name '%s' in revision %s already "
                            "used by revision %s"
                            % (
                                branch_label,
                                revision.revision,
                                map_rev.revision,
                            )
                        )
                    map_[branch_label] = revision

    def _add_branches(
        self, revisions: Collection[Revision], map_: _RevisionMapType
    ) -> None:
        for revision in revisions:
            if revision.branch_labels:
                revision.branch_labels.update(revision.branch_labels)
                for node in self._get_descendant_nodes(
                    [revision], map_, include_dependencies=False
                ):
                    node.branch_labels.update(revision.branch_labels)

                parent = node
                while (
                    parent
                    and not parent._is_real_branch_point
                    and not parent.is_merge_point
                ):
                    parent.branch_labels.update(revision.branch_labels)
                    if parent.down_revision:
                        parent = map_[parent.down_revision]
                    else:
                        break

    def _add_depends_on(
        self, revisions: Collection[Revision], map_: _RevisionMapType
    ) -> None:
        """Resolve the 'dependencies' for each revision in a collection
        in terms of actual revision ids, as opposed to branch labels or other
        symbolic names.

        The collection is then assigned to the _resolved_dependencies
        attribute on each revision object.

        """

        for revision in revisions:
            if revision.dependencies:
                deps = [
                    map_[dep] for dep in util.to_tuple(revision.dependencies)
                ]
                revision._resolved_dependencies = tuple(
                    [d.revision for d in deps if d is not None]
                )
            else:
                revision._resolved_dependencies = ()

    def _normalize_depends_on(
        self, revisions: Collection[Revision], map_: _RevisionMapType
    ) -> None:
        """Create a collection of "dependencies" that omits dependencies
        that are already ancestor nodes for each revision in a given
        collection.

        This builds upon the _resolved_dependencies collection created in the
        _add_depends_on() method, looking in the fully populated revision map
        for ancestors, and omitting them as the _resolved_dependencies
        collection as it is copied to a new collection. The new collection is
        then assigned to the _normalized_resolved_dependencies attribute on
        each revision object.

        The collection is then used to determine the immediate "down revision"
        identifiers for this revision.

        """

        for revision in revisions:
            if revision._resolved_dependencies:
                normalized_resolved = set(revision._resolved_dependencies)
                for rev in self._get_ancestor_nodes(
                    [revision],
                    include_dependencies=False,
                    map_=map_,
                ):
                    if rev is revision:
                        continue
                    elif rev._resolved_dependencies:
                        normalized_resolved.difference_update(
                            rev._resolved_dependencies
                        )

                revision._normalized_resolved_dependencies = tuple(
                    normalized_resolved
                )
            else:
                revision._normalized_resolved_dependencies = ()

    def add_revision(self, revision: Revision, _replace: bool = False) -> None:
        """add a single revision to an existing map.

        This method is for single-revision use cases, it's not
        appropriate for fully populating an entire revision map.

        """
        map_ = self._revision_map
        if not _replace and revision.revision in map_:
            util.warn(
                "Revision %s is present more than once" % revision.revision
            )
        elif _replace and revision.revision not in map_:
            raise Exception("revision %s not in map" % revision.revision)

        map_[revision.revision] = revision

        revisions = [revision]
        self._add_branches(revisions, map_)
        self._map_branch_labels(revisions, map_)
        self._add_depends_on(revisions, map_)

        if revision.is_base:
            self.bases += (revision.revision,)
        if revision._is_real_base:
            self._real_bases += (revision.revision,)

        for downrev in revision._all_down_revisions:
            if downrev not in map_:
                util.warn(
                    "Revision %s referenced from %s is not present"
                    % (downrev, revision)
                )
            not_none(map_[downrev]).add_nextrev(revision)

        self._normalize_depends_on(revisions, map_)

        if revision._is_real_head:
            self._real_heads = tuple(
                head
                for head in self._real_heads
                if head
                not in set(revision._all_down_revisions).union(
                    [revision.revision]
                )
            ) + (revision.revision,)
        if revision.is_head:
            self.heads = tuple(
                head
                for head in self.heads
                if head
                not in set(revision._versioned_down_revisions).union(
                    [revision.revision]
                )
            ) + (revision.revision,)

    def get_current_head(
        self, branch_label: Optional[str] = None
    ) -> Optional[str]:
        """Return the current head revision.

        If the script directory has multiple heads
        due to branching, an error is raised;
        :meth:`.ScriptDirectory.get_heads` should be
        preferred.

        :param branch_label: optional branch name which will limit the
         heads considered to those which include that branch_label.

        :return: a string revision number.

        .. seealso::

            :meth:`.ScriptDirectory.get_heads`

        """
        current_heads: Sequence[str] = self.heads
        if branch_label:
            current_heads = self.filter_for_lineage(
                current_heads, branch_label
            )
        if len(current_heads) > 1:
            raise MultipleHeads(
                current_heads,
                "%s@head" % branch_label if branch_label else "head",
            )

        if current_heads:
            return current_heads[0]
        else:
            return None

    def _get_base_revisions(self, identifier: str) -> Tuple[str, ...]:
        return self.filter_for_lineage(self.bases, identifier)

    def get_revisions(
        self, id_: Optional[_GetRevArg]
    ) -> Tuple[Optional[_RevisionOrBase], ...]:
        """Return the :class:`.Revision` instances with the given rev id
        or identifiers.

        May be given a single identifier, a sequence of identifiers, or the
        special symbols "head" or "base".  The result is a tuple of one
        or more identifiers, or an empty tuple in the case of "base".

        In the cases where 'head', 'heads' is requested and the
        revision map is empty, returns an empty tuple.

        Supports partial identifiers, where the given identifier
        is matched against all identifiers that start with the given
        characters; if there is exactly one match, that determines the
        full revision.

        """

        if isinstance(id_, (list, tuple, set, frozenset)):
            return sum([self.get_revisions(id_elem) for id_elem in id_], ())
        else:
            resolved_id, branch_label = self._resolve_revision_number(id_)
            if len(resolved_id) == 1:
                try:
                    rint = int(resolved_id[0])
                    if rint < 0:
                        # branch@-n -> walk down from heads
                        select_heads = self.get_revisions("heads")
                        if branch_label is not None:
                            select_heads = tuple(
                                head
                                for head in select_heads
                                if branch_label
                                in is_revision(head).branch_labels
                            )
                        return tuple(
                            self._walk(head, steps=rint)
                            for head in select_heads
                        )
                except ValueError:
                    # couldn't resolve as integer
                    pass
            return tuple(
                self._revision_for_ident(rev_id, branch_label)
                for rev_id in resolved_id
            )

    def get_revision(self, id_: Optional[str]) -> Optional[Revision]:
        """Return the :class:`.Revision` instance with the given rev id.

        If a symbolic name such as "head" or "base" is given, resolves
        the identifier into the current head or base revision.  If the symbolic
        name refers to multiples, :class:`.MultipleHeads` is raised.

        Supports partial identifiers, where the given identifier
        is matched against all identifiers that start with the given
        characters; if there is exactly one match, that determines the
        full revision.

        """

        resolved_id, branch_label = self._resolve_revision_number(id_)
        if len(resolved_id) > 1:
            raise MultipleHeads(resolved_id, id_)

        resolved: Union[str, Tuple[()]] = resolved_id[0] if resolved_id else ()
        return self._revision_for_ident(resolved, branch_label)

    def _resolve_branch(self, branch_label: str) -> Optional[Revision]:
        try:
            branch_rev = self._revision_map[branch_label]
        except KeyError:
            try:
                nonbranch_rev = self._revision_for_ident(branch_label)
            except ResolutionError as re:
                raise ResolutionError(
                    "No such branch: '%s'" % branch_label, branch_label
                ) from re

            else:
                return nonbranch_rev
        else:
            return branch_rev

    def _revision_for_ident(
        self,
        resolved_id: Union[str, Tuple[()], None],
        check_branch: Optional[str] = None,
    ) -> Optional[Revision]:
        branch_rev: Optional[Revision]
        if check_branch:
            branch_rev = self._resolve_branch(check_branch)
        else:
            branch_rev = None

        revision: Union[Optional[Revision], Literal[False]]
        try:
            revision = self._revision_map[resolved_id]
        except KeyError:
            # break out to avoid misleading py3k stack traces
            revision = False
        revs: Sequence[str]
        if revision is False:
            assert resolved_id
            # do a partial lookup
            revs = [
                x
                for x in self._revision_map
                if x and len(x) > 3 and x.startswith(resolved_id)
            ]

            if branch_rev:
                revs = self.filter_for_lineage(revs, check_branch)
            if not revs:
                raise ResolutionError(
                    "No such revision or branch '%s'%s"
                    % (
                        resolved_id,
                        (
                            "; please ensure at least four characters are "
                            "present for partial revision identifier matches"
                            if len(resolved_id) < 4
                            else ""
                        ),
                    ),
                    resolved_id,
                )
            elif len(revs) > 1:
                raise ResolutionError(
                    "Multiple revisions start "
                    "with '%s': %s..."
                    % (resolved_id, ", ".join("'%s'" % r for r in revs[0:3])),
                    resolved_id,
                )
            else:
                revision = self._revision_map[revs[0]]

        if check_branch and revision is not None:
            assert branch_rev is not None
            assert resolved_id
            if not self._shares_lineage(
                revision.revision, branch_rev.revision
            ):
                raise ResolutionError(
                    "Revision %s is not a member of branch '%s'"
                    % (revision.revision, check_branch),
                    resolved_id,
                )
        return revision

    def _filter_into_branch_heads(
        self, targets: Iterable[Optional[_RevisionOrBase]]
    ) -> Set[Optional[_RevisionOrBase]]:
        targets = set(targets)

        for rev in list(targets):
            assert rev
            if targets.intersection(
                self._get_descendant_nodes([rev], include_dependencies=False)
            ).difference([rev]):
                targets.discard(rev)
        return targets

    def filter_for_lineage(
        self,
        targets: Iterable[_TR],
        check_against: Optional[str],
        include_dependencies: bool = False,
    ) -> Tuple[_TR, ...]:
        id_, branch_label = self._resolve_revision_number(check_against)

        shares = []
        if branch_label:
            shares.append(branch_label)
        if id_:
            shares.extend(id_)

        return tuple(
            tg
            for tg in targets
            if self._shares_lineage(
                tg, shares, include_dependencies=include_dependencies
            )
        )

    def _shares_lineage(
        self,
        target: Optional[_RevisionOrStr],
        test_against_revs: Sequence[_RevisionOrStr],
        include_dependencies: bool = False,
    ) -> bool:
        if not test_against_revs:
            return True
        if not isinstance(target, Revision):
            resolved_target = not_none(self._revision_for_ident(target))
        else:
            resolved_target = target

        resolved_test_against_revs = [
            self._revision_for_ident(test_against_rev)
            if not isinstance(test_against_rev, Revision)
            else test_against_rev
            for test_against_rev in util.to_tuple(
                test_against_revs, default=()
            )
        ]

        return bool(
            set(
                self._get_descendant_nodes(
                    [resolved_target],
                    include_dependencies=include_dependencies,
                )
            )
            .union(
                self._get_ancestor_nodes(
                    [resolved_target],
                    include_dependencies=include_dependencies,
                )
            )
            .intersection(resolved_test_against_revs)
        )

    def _resolve_revision_number(
        self, id_: Optional[_GetRevArg]
    ) -> Tuple[Tuple[str, ...], Optional[str]]:
        branch_label: Optional[str]
        if isinstance(id_, str) and "@" in id_:
            branch_label, id_ = id_.split("@", 1)

        elif id_ is not None and (
            (isinstance(id_, tuple) and id_ and not isinstance(id_[0], str))
            or not isinstance(id_, (str, tuple))
        ):
            raise RevisionError(
                "revision identifier %r is not a string; ensure database "
                "driver settings are correct" % (id_,)
            )

        else:
            branch_label = None

        # ensure map is loaded
        self._revision_map
        if id_ == "heads":
            if branch_label:
                return (
                    self.filter_for_lineage(self.heads, branch_label),
                    branch_label,
                )
            else:
                return self._real_heads, branch_label
        elif id_ == "head":
            current_head = self.get_current_head(branch_label)
            if current_head:
                return (current_head,), branch_label
            else:
                return (), branch_label
        elif id_ == "base" or id_ is None:
            return (), branch_label
        else:
            return util.to_tuple(id_, default=None), branch_label

    def iterate_revisions(
        self,
        upper: _RevisionIdentifierType,
        lower: _RevisionIdentifierType,
        implicit_base: bool = False,
        inclusive: bool = False,
        assert_relative_length: bool = True,
        select_for_downgrade: bool = False,
    ) -> Iterator[Revision]:
        """Iterate through script revisions, starting at the given
        upper revision identifier and ending at the lower.

        The traversal uses strictly the `down_revision`
        marker inside each migration script, so
        it is a requirement that upper >= lower,
        else you'll get nothing back.

        The iterator yields :class:`.Revision` objects.

        """
        fn: _CollectRevisionsProtocol
        if select_for_downgrade:
            fn = self._collect_downgrade_revisions
        else:
            fn = self._collect_upgrade_revisions

        revisions, heads = fn(
            upper,
            lower,
            inclusive=inclusive,
            implicit_base=implicit_base,
            assert_relative_length=assert_relative_length,
        )

        for node in self._topological_sort(revisions, heads):
            yield not_none(self.get_revision(node))

    def _get_descendant_nodes(
        self,
        targets: Collection[Optional[_RevisionOrBase]],
        map_: Optional[_RevisionMapType] = None,
        check: bool = False,
        omit_immediate_dependencies: bool = False,
        include_dependencies: bool = True,
    ) -> Iterator[Any]:
        if omit_immediate_dependencies:

            def fn(rev: Revision) -> Iterable[str]:
                if rev not in targets:
                    return rev._all_nextrev
                else:
                    return rev.nextrev

        elif include_dependencies:

            def fn(rev: Revision) -> Iterable[str]:
                return rev._all_nextrev

        else:

            def fn(rev: Revision) -> Iterable[str]:
                return rev.nextrev

        return self._iterate_related_revisions(
            fn, targets, map_=map_, check=check
        )

    def _get_ancestor_nodes(
        self,
        targets: Collection[Optional[_RevisionOrBase]],
        map_: Optional[_RevisionMapType] = None,
        check: bool = False,
        include_dependencies: bool = True,
    ) -> Iterator[Revision]:
        if include_dependencies:

            def fn(rev: Revision) -> Iterable[str]:
                return rev._normalized_down_revisions

        else:

            def fn(rev: Revision) -> Iterable[str]:
                return rev._versioned_down_revisions

        return self._iterate_related_revisions(
            fn, targets, map_=map_, check=check
        )

    def _iterate_related_revisions(
        self,
        fn: Callable[[Revision], Iterable[str]],
        targets: Collection[Optional[_RevisionOrBase]],
        map_: Optional[_RevisionMapType],
        check: bool = False,
    ) -> Iterator[Revision]:
        if map_ is None:
            map_ = self._revision_map

        seen = set()
        todo: Deque[Revision] = collections.deque()
        for target_for in targets:
            target = is_revision(target_for)
            todo.append(target)
            if check:
                per_target = set()

            while todo:
                rev = todo.pop()
                if check:
                    per_target.add(rev)

                if rev in seen:
                    continue
                seen.add(rev)
                # Check for map errors before collecting.
                for rev_id in fn(rev):
                    next_rev = map_[rev_id]
                    assert next_rev is not None
                    if next_rev.revision != rev_id:
                        raise RevisionError(
                            "Dependency resolution failed; broken map"
                        )
                    todo.append(next_rev)
                yield rev
            if check:
                overlaps = per_target.intersection(targets).difference(
                    [target]
                )
                if overlaps:
                    raise RevisionError(
                        "Requested revision %s overlaps with "
                        "other requested revisions %s"
                        % (
                            target.revision,
                            ", ".join(r.revision for r in overlaps),
                        )
                    )

    def _topological_sort(
        self,
        revisions: Collection[Revision],
        heads: Any,
    ) -> List[str]:
        """Yield revision ids of a collection of Revision objects in
        topological sorted order (i.e. revisions always come after their
        down_revisions and dependencies). Uses the order of keys in
        _revision_map to sort.

        """

        id_to_rev = self._revision_map

        def get_ancestors(rev_id: str) -> Set[str]:
            return {
                r.revision
                for r in self._get_ancestor_nodes([id_to_rev[rev_id]])
            }

        todo = {d.revision for d in revisions}

        # Use revision map (ordered dict) key order to pre-sort.
        inserted_order = list(self._revision_map)

        current_heads = list(
            sorted(
                {d.revision for d in heads if d.revision in todo},
                key=inserted_order.index,
            )
        )
        ancestors_by_idx = [get_ancestors(rev_id) for rev_id in current_heads]

        output = []

        current_candidate_idx = 0
        while current_heads:
            candidate = current_heads[current_candidate_idx]

            for check_head_index, ancestors in enumerate(ancestors_by_idx):
                # scan all the heads.  see if we can continue walking
                # down the current branch indicated by current_candidate_idx.
                if (
                    check_head_index != current_candidate_idx
                    and candidate in ancestors
                ):
                    current_candidate_idx = check_head_index
                    # nope, another head is dependent on us, they have
                    # to be traversed first
                    break
            else:
                # yup, we can emit
                if candidate in todo:
                    output.append(candidate)
                    todo.remove(candidate)

                # now update the heads with our ancestors.

                candidate_rev = id_to_rev[candidate]
                assert candidate_rev is not None

                heads_to_add = [
                    r
                    for r in candidate_rev._normalized_down_revisions
                    if r in todo and r not in current_heads
                ]

                if not heads_to_add:
                    # no ancestors, so remove this head from the list
                    del current_heads[current_candidate_idx]
                    del ancestors_by_idx[current_candidate_idx]
                    current_candidate_idx = max(current_candidate_idx - 1, 0)
                else:
                    if (
                        not candidate_rev._normalized_resolved_dependencies
                        and len(candidate_rev._versioned_down_revisions) == 1
                    ):
                        current_heads[current_candidate_idx] = heads_to_add[0]

                        # for plain movement down a revision line without
                        # any mergepoints, branchpoints, or deps, we
                        # can update the ancestors collection directly
                        # by popping out the candidate we just emitted
                        ancestors_by_idx[current_candidate_idx].discard(
                            candidate
                        )

                    else:
                        # otherwise recalculate it again, things get
                        # complicated otherwise.  This can possibly be
                        # improved to not run the whole ancestor thing
                        # each time but it was getting complicated
                        current_heads[current_candidate_idx] = heads_to_add[0]
                        current_heads.extend(heads_to_add[1:])
                        ancestors_by_idx[
                            current_candidate_idx
                        ] = get_ancestors(heads_to_add[0])
                        ancestors_by_idx.extend(
                            get_ancestors(head) for head in heads_to_add[1:]
                        )

        assert not todo
        return output

    def _walk(
        self,
        start: Optional[Union[str, Revision]],
        steps: int,
        branch_label: Optional[str] = None,
        no_overwalk: bool = True,
    ) -> Optional[_RevisionOrBase]:
        """
        Walk the requested number of :steps up (steps > 0) or down (steps < 0)
        the revision tree.

        :branch_label is used to select branches only when walking up.

        If the walk goes past the boundaries of the tree and :no_overwalk is
        True, None is returned, otherwise the walk terminates early.

        A RevisionError is raised if there is no unambiguous revision to
        walk to.
        """
        initial: Optional[_RevisionOrBase]
        if isinstance(start, str):
            initial = self.get_revision(start)
        else:
            initial = start

        children: Sequence[Optional[_RevisionOrBase]]
        for _ in range(abs(steps)):
            if steps > 0:
                assert initial != "base"  # type: ignore[comparison-overlap]
                # Walk up
                walk_up = [
                    is_revision(rev)
                    for rev in self.get_revisions(
                        self.bases if initial is None else initial.nextrev
                    )
                ]
                if branch_label:
                    children = self.filter_for_lineage(walk_up, branch_label)
                else:
                    children = walk_up
            else:
                # Walk down
                if initial == "base":  # type: ignore[comparison-overlap]
                    children = ()
                else:
                    children = self.get_revisions(
                        self.heads
                        if initial is None
                        else initial.down_revision
                    )
                    if not children:
                        children = ("base",)
            if not children:
                # This will return an invalid result if no_overwalk, otherwise
                # further steps will stay where we are.
                ret = None if no_overwalk else initial
                return ret
            elif len(children) > 1:
                raise RevisionError("Ambiguous walk")
            initial = children[0]

        return initial

    def _parse_downgrade_target(
        self,
        current_revisions: _RevisionIdentifierType,
        target: _RevisionIdentifierType,
        assert_relative_length: bool,
    ) -> Tuple[Optional[str], Optional[_RevisionOrBase]]:
        """
        Parse downgrade command syntax :target to retrieve the target revision
        and branch label (if any) given the :current_revisions stamp of the
        database.

        Returns a tuple (branch_label, target_revision) where branch_label
        is a string from the command specifying the branch to consider (or
        None if no branch given), and target_revision is a Revision object
        which the command refers to. target_revisions is None if the command
        refers to 'base'. The target may be specified in absolute form, or
        relative to :current_revisions.
        """
        if target is None:
            return None, None
        assert isinstance(
            target, str
        ), "Expected downgrade target in string form"
        match = _relative_destination.match(target)
        if match:
            branch_label, symbol, relative = match.groups()
            rel_int = int(relative)
            if rel_int >= 0:
                if symbol is None:
                    # Downgrading to current + n is not valid.
                    raise RevisionError(
                        "Relative revision %s didn't "
                        "produce %d migrations" % (relative, abs(rel_int))
                    )
                # Find target revision relative to given symbol.
                rev = self._walk(
                    symbol,
                    rel_int,
                    branch_label,
                    no_overwalk=assert_relative_length,
                )
                if rev is None:
                    raise RevisionError("Walked too far")
                return branch_label, rev
            else:
                relative_revision = symbol is None
                if relative_revision:
                    # Find target revision relative to current state.
                    if branch_label:
                        cr_tuple = util.to_tuple(current_revisions)
                        symbol_list: Sequence[str]
                        symbol_list = self.filter_for_lineage(
                            cr_tuple, branch_label
                        )
                        if not symbol_list:
                            # check the case where there are multiple branches
                            # but there is currently a single heads, since all
                            # other branch heads are dependent of the current
                            # single heads.
                            all_current = cast(
                                Set[Revision], self._get_all_current(cr_tuple)
                            )
                            sl_all_current = self.filter_for_lineage(
                                all_current, branch_label
                            )
                            symbol_list = [
                                r.revision if r else r  # type: ignore[misc]
                                for r in sl_all_current
                            ]

                        assert len(symbol_list) == 1
                        symbol = symbol_list[0]
                    else:
                        current_revisions = util.to_tuple(current_revisions)
                        if not current_revisions:
                            raise RevisionError(
                                "Relative revision %s didn't "
                                "produce %d migrations"
                                % (relative, abs(rel_int))
                            )
                        # Have to check uniques here for duplicate rows test.
                        if len(set(current_revisions)) > 1:
                            util.warn(
                                "downgrade -1 from multiple heads is "
                                "ambiguous; "
                                "this usage will be disallowed in a future "
                                "release."
                            )
                        symbol = current_revisions[0]
                        # Restrict iteration to just the selected branch when
                        # ambiguous branches are involved.
                        branch_label = symbol
                # Walk down the tree to find downgrade target.
                rev = self._walk(
                    start=self.get_revision(symbol)
                    if branch_label is None
                    else self.get_revision("%s@%s" % (branch_label, symbol)),
                    steps=rel_int,
                    no_overwalk=assert_relative_length,
                )
                if rev is None:
                    if relative_revision:
                        raise RevisionError(
                            "Relative revision %s didn't "
                            "produce %d migrations" % (relative, abs(rel_int))
                        )
                    else:
                        raise RevisionError("Walked too far")
                return branch_label, rev

        # No relative destination given, revision specified is absolute.
        branch_label, _, symbol = target.rpartition("@")
        if not branch_label:
            branch_label = None
        return branch_label, self.get_revision(symbol)

    def _parse_upgrade_target(
        self,
        current_revisions: _RevisionIdentifierType,
        target: _RevisionIdentifierType,
        assert_relative_length: bool,
    ) -> Tuple[Optional[_RevisionOrBase], ...]:
        """
        Parse upgrade command syntax :target to retrieve the target revision
        and given the :current_revisions stamp of the database.

        Returns a tuple of Revision objects which should be iterated/upgraded
        to. The target may be specified in absolute form, or relative to
        :current_revisions.
        """
        if isinstance(target, str):
            match = _relative_destination.match(target)
        else:
            match = None

        if not match:
            # No relative destination, target is absolute.
            return self.get_revisions(target)

        current_revisions_tup: Union[str, Tuple[Optional[str], ...], None]
        current_revisions_tup = util.to_tuple(current_revisions)

        branch_label, symbol, relative_str = match.groups()
        relative = int(relative_str)
        if relative > 0:
            if symbol is None:
                if not current_revisions_tup:
                    current_revisions_tup = (None,)
                # Try to filter to a single target (avoid ambiguous branches).
                start_revs = current_revisions_tup
                if branch_label:
                    start_revs = self.filter_for_lineage(
                        self.get_revisions(current_revisions_tup),  # type: ignore[arg-type] # noqa: E501
                        branch_label,
                    )
                    if not start_revs:
                        # The requested branch is not a head, so we need to
                        # backtrack to find a branchpoint.
                        active_on_branch = self.filter_for_lineage(
                            self._get_ancestor_nodes(
                                self.get_revisions(current_revisions_tup)
                            ),
                            branch_label,
                        )
                        # Find the tips of this set of revisions (revisions
                        # without children within the set).
                        start_revs = tuple(
                            {rev.revision for rev in active_on_branch}
                            - {
                                down
                                for rev in active_on_branch
                                for down in rev._normalized_down_revisions
                            }
                        )
                        if not start_revs:
                            # We must need to go right back to base to find
                            # a starting point for this branch.
                            start_revs = (None,)
                if len(start_revs) > 1:
                    raise RevisionError(
                        "Ambiguous upgrade from multiple current revisions"
                    )
                # Walk up from unique target revision.
                rev = self._walk(
                    start=start_revs[0],
                    steps=relative,
                    branch_label=branch_label,
                    no_overwalk=assert_relative_length,
                )
                if rev is None:
                    raise RevisionError(
                        "Relative revision %s didn't "
                        "produce %d migrations" % (relative_str, abs(relative))
                    )
                return (rev,)
            else:
                # Walk is relative to a given revision, not the current state.
                return (
                    self._walk(
                        start=self.get_revision(symbol),
                        steps=relative,
                        branch_label=branch_label,
                        no_overwalk=assert_relative_length,
                    ),
                )
        else:
            if symbol is None:
                # Upgrading to current - n is not valid.
                raise RevisionError(
                    "Relative revision %s didn't "
                    "produce %d migrations" % (relative, abs(relative))
                )
            return (
                self._walk(
                    start=self.get_revision(symbol)
                    if branch_label is None
                    else self.get_revision("%s@%s" % (branch_label, symbol)),
                    steps=relative,
                    no_overwalk=assert_relative_length,
                ),
            )

    def _collect_downgrade_revisions(
        self,
        upper: _RevisionIdentifierType,
        lower: _RevisionIdentifierType,
        inclusive: bool,
        implicit_base: bool,
        assert_relative_length: bool,
    ) -> Tuple[Set[Revision], Tuple[Optional[_RevisionOrBase], ...]]:
        """
        Compute the set of current revisions specified by :upper, and the
        downgrade target specified by :target. Return all dependents of target
        which are currently active.

        :inclusive=True includes the target revision in the set
        """

        branch_label, target_revision = self._parse_downgrade_target(
            current_revisions=upper,
            target=lower,
            assert_relative_length=assert_relative_length,
        )
        if target_revision == "base":
            target_revision = None
        assert target_revision is None or isinstance(target_revision, Revision)

        roots: List[Revision]
        # Find candidates to drop.
        if target_revision is None:
            # Downgrading back to base: find all tree roots.
            roots = [
                rev
                for rev in self._revision_map.values()
                if rev is not None and rev.down_revision is None
            ]
        elif inclusive:
            # inclusive implies target revision should also be dropped
            roots = [target_revision]
        else:
            # Downgrading to fixed target: find all direct children.
            roots = [
                is_revision(rev)
                for rev in self.get_revisions(target_revision.nextrev)
            ]

        if branch_label and len(roots) > 1:
            # Need to filter roots.
            ancestors = {
                rev.revision
                for rev in self._get_ancestor_nodes(
                    [self._resolve_branch(branch_label)],
                    include_dependencies=False,
                )
            }
            # Intersection gives the root revisions we are trying to
            # rollback with the downgrade.
            roots = [
                is_revision(rev)
                for rev in self.get_revisions(
                    {rev.revision for rev in roots}.intersection(ancestors)
                )
            ]

            # Ensure we didn't throw everything away when filtering branches.
            if len(roots) == 0:
                raise RevisionError(
                    "Not a valid downgrade target from current heads"
                )

        heads = self.get_revisions(upper)

        # Aim is to drop :branch_revision; to do so we also need to drop its
        # descendents and anything dependent on it.
        downgrade_revisions = set(
            self._get_descendant_nodes(
                roots,
                include_dependencies=True,
                omit_immediate_dependencies=False,
            )
        )
        active_revisions = set(
            self._get_ancestor_nodes(heads, include_dependencies=True)
        )

        # Emit revisions to drop in reverse topological sorted order.
        downgrade_revisions.intersection_update(active_revisions)

        if implicit_base:
            # Wind other branches back to base.
            downgrade_revisions.update(
                active_revisions.difference(self._get_ancestor_nodes(roots))
            )

        if (
            target_revision is not None
            and not downgrade_revisions
            and target_revision not in heads
        ):
            # Empty intersection: target revs are not present.

            raise RangeNotAncestorError("Nothing to drop", upper)

        return downgrade_revisions, heads

    def _collect_upgrade_revisions(
        self,
        upper: _RevisionIdentifierType,
        lower: _RevisionIdentifierType,
        inclusive: bool,
        implicit_base: bool,
        assert_relative_length: bool,
    ) -> Tuple[Set[Revision], Tuple[Revision, ...]]:
        """
        Compute the set of required revisions specified by :upper, and the
        current set of active revisions specified by :lower. Find the
        difference between the two to compute the required upgrades.

        :inclusive=True includes the current/lower revisions in the set

        :implicit_base=False only returns revisions which are downstream
        of the current/lower revisions. Dependencies from branches with
        different bases will not be included.
        """
        targets: Collection[Revision] = [
            is_revision(rev)
            for rev in self._parse_upgrade_target(
                current_revisions=lower,
                target=upper,
                assert_relative_length=assert_relative_length,
            )
        ]

        # assert type(targets) is tuple, "targets should be a tuple"

        # Handled named bases (e.g. branch@... -> heads should only produce
        # targets on the given branch)
        if isinstance(lower, str) and "@" in lower:
            branch, _, _ = lower.partition("@")
            branch_rev = self.get_revision(branch)
            if branch_rev is not None and branch_rev.revision == branch:
                # A revision was used as a label; get its branch instead
                assert len(branch_rev.branch_labels) == 1
                branch = next(iter(branch_rev.branch_labels))
            targets = {
                need for need in targets if branch in need.branch_labels
            }

        required_node_set = set(
            self._get_ancestor_nodes(
                targets, check=True, include_dependencies=True
            )
        ).union(targets)

        current_revisions = self.get_revisions(lower)
        if not implicit_base and any(
            rev not in required_node_set
            for rev in current_revisions
            if rev is not None
        ):
            raise RangeNotAncestorError(lower, upper)
        assert (
            type(current_revisions) is tuple
        ), "current_revisions should be a tuple"

        # Special case where lower = a relative value (get_revisions can't
        # find it)
        if current_revisions and current_revisions[0] is None:
            _, rev = self._parse_downgrade_target(
                current_revisions=upper,
                target=lower,
                assert_relative_length=assert_relative_length,
            )
            assert rev
            if rev == "base":
                current_revisions = tuple()
                lower = None
            else:
                current_revisions = (rev,)
                lower = rev.revision

        current_node_set = set(
            self._get_ancestor_nodes(
                current_revisions, check=True, include_dependencies=True
            )
        ).union(current_revisions)

        needs = required_node_set.difference(current_node_set)

        # Include the lower revision (=current_revisions?) in the iteration
        if inclusive:
            needs.update(is_revision(rev) for rev in self.get_revisions(lower))
        # By default, base is implicit as we want all dependencies returned.
        # Base is also implicit if lower = base
        # implicit_base=False -> only return direct downstreams of
        # current_revisions
        if current_revisions and not implicit_base:
            lower_descendents = self._get_descendant_nodes(
                [is_revision(rev) for rev in current_revisions],
                check=True,
                include_dependencies=False,
            )
            needs.intersection_update(lower_descendents)

        return needs, tuple(targets)

    def _get_all_current(
        self, id_: Tuple[str, ...]
    ) -> Set[Optional[_RevisionOrBase]]:
        top_revs: Set[Optional[_RevisionOrBase]]
        top_revs = set(self.get_revisions(id_))
        top_revs.update(
            self._get_ancestor_nodes(list(top_revs), include_dependencies=True)
        )
        return self._filter_into_branch_heads(top_revs)


class Revision:
    """Base class for revisioned objects.

    The :class:`.Revision` class is the base of the more public-facing
    :class:`.Script` object, which represents a migration script.
    The mechanics of revision management and traversal are encapsulated
    within :class:`.Revision`, while :class:`.Script` applies this logic
    to Python files in a version directory.

    """

    nextrev: FrozenSet[str] = frozenset()
    """following revisions, based on down_revision only."""

    _all_nextrev: FrozenSet[str] = frozenset()

    revision: str = None  # type: ignore[assignment]
    """The string revision number."""

    down_revision: Optional[_RevIdType] = None
    """The ``down_revision`` identifier(s) within the migration script.

    Note that the total set of "down" revisions is
    down_revision + dependencies.

    """

    dependencies: Optional[_RevIdType] = None
    """Additional revisions which this revision is dependent on.

    From a migration standpoint, these dependencies are added to the
    down_revision to form the full iteration.  However, the separation
    of down_revision from "dependencies" is to assist in navigating
    a history that contains many branches, typically a multi-root scenario.

    """

    branch_labels: Set[str] = None  # type: ignore[assignment]
    """Optional string/tuple of symbolic names to apply to this
    revision's branch"""

    _resolved_dependencies: Tuple[str, ...]
    _normalized_resolved_dependencies: Tuple[str, ...]

    @classmethod
    def verify_rev_id(cls, revision: str) -> None:
        illegal_chars = set(revision).intersection(_revision_illegal_chars)
        if illegal_chars:
            raise RevisionError(
                "Character(s) '%s' not allowed in revision identifier '%s'"
                % (", ".join(sorted(illegal_chars)), revision)
            )

    def __init__(
        self,
        revision: str,
        down_revision: Optional[Union[str, Tuple[str, ...]]],
        dependencies: Optional[Union[str, Tuple[str, ...]]] = None,
        branch_labels: Optional[Union[str, Tuple[str, ...]]] = None,
    ) -> None:
        if down_revision and revision in util.to_tuple(down_revision):
            raise LoopDetected(revision)
        elif dependencies is not None and revision in util.to_tuple(
            dependencies
        ):
            raise DependencyLoopDetected(revision)

        self.verify_rev_id(revision)
        self.revision = revision
        self.down_revision = tuple_rev_as_scalar(util.to_tuple(down_revision))
        self.dependencies = tuple_rev_as_scalar(util.to_tuple(dependencies))
        self._orig_branch_labels = util.to_tuple(branch_labels, default=())
        self.branch_labels = set(self._orig_branch_labels)

    def __repr__(self) -> str:
        args = [repr(self.revision), repr(self.down_revision)]
        if self.dependencies:
            args.append("dependencies=%r" % (self.dependencies,))
        if self.branch_labels:
            args.append("branch_labels=%r" % (self.branch_labels,))
        return "%s(%s)" % (self.__class__.__name__, ", ".join(args))

    def add_nextrev(self, revision: Revision) -> None:
        self._all_nextrev = self._all_nextrev.union([revision.revision])
        if self.revision in revision._versioned_down_revisions:
            self.nextrev = self.nextrev.union([revision.revision])

    @property
    def _all_down_revisions(self) -> Tuple[str, ...]:
        return util.dedupe_tuple(
            util.to_tuple(self.down_revision, default=())
            + self._resolved_dependencies
        )

    @property
    def _normalized_down_revisions(self) -> Tuple[str, ...]:
        """return immediate down revisions for a rev, omitting dependencies
        that are still dependencies of ancestors.

        """
        return util.dedupe_tuple(
            util.to_tuple(self.down_revision, default=())
            + self._normalized_resolved_dependencies
        )

    @property
    def _versioned_down_revisions(self) -> Tuple[str, ...]:
        return util.to_tuple(self.down_revision, default=())

    @property
    def is_head(self) -> bool:
        """Return True if this :class:`.Revision` is a 'head' revision.

        This is determined based on whether any other :class:`.Script`
        within the :class:`.ScriptDirectory` refers to this
        :class:`.Script`.   Multiple heads can be present.

        """
        return not bool(self.nextrev)

    @property
    def _is_real_head(self) -> bool:
        return not bool(self._all_nextrev)

    @property
    def is_base(self) -> bool:
        """Return True if this :class:`.Revision` is a 'base' revision."""

        return self.down_revision is None

    @property
    def _is_real_base(self) -> bool:
        """Return True if this :class:`.Revision` is a "real" base revision,
        e.g. that it has no dependencies either."""

        # we use self.dependencies here because this is called up
        # in initialization where _real_dependencies isn't set up
        # yet
        return self.down_revision is None and self.dependencies is None

    @property
    def is_branch_point(self) -> bool:
        """Return True if this :class:`.Script` is a branch point.

        A branchpoint is defined as a :class:`.Script` which is referred
        to by more than one succeeding :class:`.Script`, that is more
        than one :class:`.Script` has a `down_revision` identifier pointing
        here.

        """
        return len(self.nextrev) > 1

    @property
    def _is_real_branch_point(self) -> bool:
        """Return True if this :class:`.Script` is a 'real' branch point,
        taking into account dependencies as well.

        """
        return len(self._all_nextrev) > 1

    @property
    def is_merge_point(self) -> bool:
        """Return True if this :class:`.Script` is a merge point."""

        return len(self._versioned_down_revisions) > 1


@overload
def tuple_rev_as_scalar(rev: None) -> None:
    ...


@overload
def tuple_rev_as_scalar(
    rev: Union[Tuple[_T, ...], List[_T]]
) -> Union[_T, Tuple[_T, ...], List[_T]]:
    ...


def tuple_rev_as_scalar(
    rev: Optional[Sequence[_T]],
) -> Union[_T, Sequence[_T], None]:
    if not rev:
        return None
    elif len(rev) == 1:
        return rev[0]
    else:
        return rev


def is_revision(rev: Any) -> Revision:
    assert isinstance(rev, Revision)
    return rev

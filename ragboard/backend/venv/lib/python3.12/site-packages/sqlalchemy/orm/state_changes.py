# orm/state_changes.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""State tracking utilities used by :class:`_orm.Session`.

"""

from __future__ import annotations

import contextlib
from enum import Enum
from typing import Any
from typing import Callable
from typing import cast
from typing import Iterator
from typing import NoReturn
from typing import Optional
from typing import Tuple
from typing import TypeVar
from typing import Union

from .. import exc as sa_exc
from .. import util
from ..util.typing import Literal

_F = TypeVar("_F", bound=Callable[..., Any])


class _StateChangeState(Enum):
    pass


class _StateChangeStates(_StateChangeState):
    ANY = 1
    NO_CHANGE = 2
    CHANGE_IN_PROGRESS = 3


class _StateChange:
    """Supplies state assertion decorators.

    The current use case is for the :class:`_orm.SessionTransaction` class. The
    :class:`_StateChange` class itself is agnostic of the
    :class:`_orm.SessionTransaction` class so could in theory be generalized
    for other systems as well.

    """

    _next_state: _StateChangeState = _StateChangeStates.ANY
    _state: _StateChangeState = _StateChangeStates.NO_CHANGE
    _current_fn: Optional[Callable[..., Any]] = None

    def _raise_for_prerequisite_state(
        self, operation_name: str, state: _StateChangeState
    ) -> NoReturn:
        raise sa_exc.IllegalStateChangeError(
            f"Can't run operation '{operation_name}()' when Session "
            f"is in state {state!r}",
            code="isce",
        )

    @classmethod
    def declare_states(
        cls,
        prerequisite_states: Union[
            Literal[_StateChangeStates.ANY], Tuple[_StateChangeState, ...]
        ],
        moves_to: _StateChangeState,
    ) -> Callable[[_F], _F]:
        """Method decorator declaring valid states.

        :param prerequisite_states: sequence of acceptable prerequisite
         states.   Can be the single constant _State.ANY to indicate no
         prerequisite state

        :param moves_to: the expected state at the end of the method, assuming
         no exceptions raised.   Can be the constant _State.NO_CHANGE to
         indicate state should not change at the end of the method.

        """
        assert prerequisite_states, "no prequisite states sent"
        has_prerequisite_states = (
            prerequisite_states is not _StateChangeStates.ANY
        )

        prerequisite_state_collection = cast(
            "Tuple[_StateChangeState, ...]", prerequisite_states
        )
        expect_state_change = moves_to is not _StateChangeStates.NO_CHANGE

        @util.decorator
        def _go(fn: _F, self: Any, *arg: Any, **kw: Any) -> Any:
            current_state = self._state

            if (
                has_prerequisite_states
                and current_state not in prerequisite_state_collection
            ):
                self._raise_for_prerequisite_state(fn.__name__, current_state)

            next_state = self._next_state
            existing_fn = self._current_fn
            expect_state = moves_to if expect_state_change else current_state

            if (
                # destination states are restricted
                next_state is not _StateChangeStates.ANY
                # method seeks to change state
                and expect_state_change
                # destination state incorrect
                and next_state is not expect_state
            ):
                if existing_fn and next_state in (
                    _StateChangeStates.NO_CHANGE,
                    _StateChangeStates.CHANGE_IN_PROGRESS,
                ):
                    raise sa_exc.IllegalStateChangeError(
                        f"Method '{fn.__name__}()' can't be called here; "
                        f"method '{existing_fn.__name__}()' is already "
                        f"in progress and this would cause an unexpected "
                        f"state change to {moves_to!r}",
                        code="isce",
                    )
                else:
                    raise sa_exc.IllegalStateChangeError(
                        f"Cant run operation '{fn.__name__}()' here; "
                        f"will move to state {moves_to!r} where we are "
                        f"expecting {next_state!r}",
                        code="isce",
                    )

            self._current_fn = fn
            self._next_state = _StateChangeStates.CHANGE_IN_PROGRESS
            try:
                ret_value = fn(self, *arg, **kw)
            except:
                raise
            else:
                if self._state is expect_state:
                    return ret_value

                if self._state is current_state:
                    raise sa_exc.IllegalStateChangeError(
                        f"Method '{fn.__name__}()' failed to "
                        "change state "
                        f"to {moves_to!r} as expected",
                        code="isce",
                    )
                elif existing_fn:
                    raise sa_exc.IllegalStateChangeError(
                        f"While method '{existing_fn.__name__}()' was "
                        "running, "
                        f"method '{fn.__name__}()' caused an "
                        "unexpected "
                        f"state change to {self._state!r}",
                        code="isce",
                    )
                else:
                    raise sa_exc.IllegalStateChangeError(
                        f"Method '{fn.__name__}()' caused an unexpected "
                        f"state change to {self._state!r}",
                        code="isce",
                    )

            finally:
                self._next_state = next_state
                self._current_fn = existing_fn

        return _go

    @contextlib.contextmanager
    def _expect_state(self, expected: _StateChangeState) -> Iterator[Any]:
        """called within a method that changes states.

        method must also use the ``@declare_states()`` decorator.

        """
        assert self._next_state is _StateChangeStates.CHANGE_IN_PROGRESS, (
            "Unexpected call to _expect_state outside of "
            "state-changing method"
        )

        self._next_state = expected
        try:
            yield
        except:
            raise
        else:
            if self._state is not expected:
                raise sa_exc.IllegalStateChangeError(
                    f"Unexpected state change to {self._state!r}", code="isce"
                )
        finally:
            self._next_state = _StateChangeStates.CHANGE_IN_PROGRESS

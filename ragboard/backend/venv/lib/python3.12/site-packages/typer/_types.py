from enum import Enum
from typing import Generic, TypeVar, Union

import click

ParamTypeValue = TypeVar("ParamTypeValue")


class TyperChoice(click.Choice, Generic[ParamTypeValue]):  # type: ignore[type-arg]
    def normalize_choice(
        self, choice: ParamTypeValue, ctx: Union[click.Context, None]
    ) -> str:
        # Click 8.2.0 added a new method `normalize_choice` to the `Choice` class
        # to support enums, but it uses the enum names, while Typer has always used the
        # enum values.
        # This class overrides that method to maintain the previous behavior.
        # In Click:
        # normed_value = choice.name if isinstance(choice, Enum) else str(choice)
        normed_value = str(choice.value) if isinstance(choice, Enum) else str(choice)

        if ctx is not None and ctx.token_normalize_func is not None:
            normed_value = ctx.token_normalize_func(normed_value)

        if not self.case_sensitive:
            normed_value = normed_value.casefold()

        return normed_value

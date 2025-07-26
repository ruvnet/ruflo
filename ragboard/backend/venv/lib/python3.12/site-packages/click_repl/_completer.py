from __future__ import unicode_literals

import os
from glob import iglob

import click
from prompt_toolkit.completion import Completion, Completer

from .utils import _resolve_context, split_arg_string

__all__ = ["ClickCompleter"]

IS_WINDOWS = os.name == "nt"


# Handle backwards compatibility between Click<=7.0 and >=8.0
try:
    import click.shell_completion

    HAS_CLICK_V8 = True
    AUTO_COMPLETION_PARAM = "shell_complete"
except (ImportError, ModuleNotFoundError):
    import click._bashcomplete  # type: ignore[import]

    HAS_CLICK_V8 = False
    AUTO_COMPLETION_PARAM = "autocompletion"


def text_type(text):
    return "{}".format(text)


class ClickCompleter(Completer):
    __slots__ = ("cli", "ctx", "parsed_args", "parsed_ctx", "ctx_command")

    def __init__(self, cli, ctx):
        self.cli = cli
        self.ctx = ctx
        self.parsed_args = []
        self.parsed_ctx = ctx
        self.ctx_command = ctx.command

    def _get_completion_from_autocompletion_functions(
        self,
        param,
        autocomplete_ctx,
        args,
        incomplete,
    ):
        param_choices = []

        if HAS_CLICK_V8:
            autocompletions = param.shell_complete(autocomplete_ctx, incomplete)
        else:
            autocompletions = param.autocompletion(  # type: ignore[attr-defined]
                autocomplete_ctx, args, incomplete
            )

        for autocomplete in autocompletions:
            if isinstance(autocomplete, tuple):
                param_choices.append(
                    Completion(
                        text_type(autocomplete[0]),
                        -len(incomplete),
                        display_meta=autocomplete[1],
                    )
                )

            elif HAS_CLICK_V8 and isinstance(
                autocomplete, click.shell_completion.CompletionItem
            ):
                param_choices.append(
                    Completion(text_type(autocomplete.value), -len(incomplete))
                )

            else:
                param_choices.append(
                    Completion(text_type(autocomplete), -len(incomplete))
                )

        return param_choices

    def _get_completion_from_choices_click_le_7(self, param, incomplete):
        if not getattr(param.type, "case_sensitive", True):
            incomplete = incomplete.lower()
            return [
                Completion(
                    text_type(choice),
                    -len(incomplete),
                    display=text_type(repr(choice) if " " in choice else choice),
                )
                for choice in param.type.choices  # type: ignore[attr-defined]
                if choice.lower().startswith(incomplete)
            ]

        else:
            return [
                Completion(
                    text_type(choice),
                    -len(incomplete),
                    display=text_type(repr(choice) if " " in choice else choice),
                )
                for choice in param.type.choices  # type: ignore[attr-defined]
                if choice.startswith(incomplete)
            ]

    def _get_completion_for_Path_types(self, param, args, incomplete):
        if "*" in incomplete:
            return []

        choices = []
        _incomplete = os.path.expandvars(incomplete)
        search_pattern = _incomplete.strip("'\"\t\n\r\v ").replace("\\\\", "\\") + "*"
        quote = ""

        if " " in _incomplete:
            for i in incomplete:
                if i in ("'", '"'):
                    quote = i
                    break

        for path in iglob(search_pattern):
            if " " in path:
                if quote:
                    path = quote + path
                else:
                    if IS_WINDOWS:
                        path = repr(path).replace("\\\\", "\\")
            else:
                if IS_WINDOWS:
                    path = path.replace("\\", "\\\\")

            choices.append(
                Completion(
                    text_type(path),
                    -len(incomplete),
                    display=text_type(os.path.basename(path.strip("'\""))),
                )
            )

        return choices

    def _get_completion_for_Boolean_type(self, param, incomplete):
        return [
            Completion(
                text_type(k), -len(incomplete), display_meta=text_type("/".join(v))
            )
            for k, v in {
                "true": ("1", "true", "t", "yes", "y", "on"),
                "false": ("0", "false", "f", "no", "n", "off"),
            }.items()
            if any(i.startswith(incomplete) for i in v)
        ]

    def _get_completion_from_params(self, autocomplete_ctx, args, param, incomplete):

        choices = []
        param_type = param.type

        # shell_complete method for click.Choice is intorduced in click-v8
        if not HAS_CLICK_V8 and isinstance(param_type, click.Choice):
            choices.extend(
                self._get_completion_from_choices_click_le_7(param, incomplete)
            )

        elif isinstance(param_type, click.types.BoolParamType):
            choices.extend(self._get_completion_for_Boolean_type(param, incomplete))

        elif isinstance(param_type, (click.Path, click.File)):
            choices.extend(self._get_completion_for_Path_types(param, args, incomplete))

        elif getattr(param, AUTO_COMPLETION_PARAM, None) is not None:
            choices.extend(
                self._get_completion_from_autocompletion_functions(
                    param,
                    autocomplete_ctx,
                    args,
                    incomplete,
                )
            )

        return choices

    def _get_completion_for_cmd_args(
        self,
        ctx_command,
        incomplete,
        autocomplete_ctx,
        args,
    ):
        choices = []
        param_called = False

        for param in ctx_command.params:
            if isinstance(param.type, click.types.UnprocessedParamType):
                return []

            elif getattr(param, "hidden", False):
                continue

            elif isinstance(param, click.Option):
                for option in param.opts + param.secondary_opts:
                    # We want to make sure if this parameter was called
                    # If we are inside a parameter that was called, we want to show only
                    # relevant choices
                    if option in args[param.nargs * -1 :]:  # noqa: E203
                        param_called = True
                        break

                    elif option.startswith(incomplete):
                        choices.append(
                            Completion(
                                text_type(option),
                                -len(incomplete),
                                display_meta=text_type(param.help or ""),
                            )
                        )

                if param_called:
                    choices = self._get_completion_from_params(
                        autocomplete_ctx, args, param, incomplete
                    )

            elif isinstance(param, click.Argument):
                choices.extend(
                    self._get_completion_from_params(
                        autocomplete_ctx, args, param, incomplete
                    )
                )

        return choices

    def get_completions(self, document, complete_event=None):
        # Code analogous to click._bashcomplete.do_complete

        args = split_arg_string(document.text_before_cursor, posix=False)

        choices = []
        cursor_within_command = (
            document.text_before_cursor.rstrip() == document.text_before_cursor
        )

        if document.text_before_cursor.startswith(("!", ":")):
            return

        if args and cursor_within_command:
            # We've entered some text and no space, give completions for the
            # current word.
            incomplete = args.pop()
        else:
            # We've not entered anything, either at all or for the current
            # command, so give all relevant completions for this context.
            incomplete = ""

        if self.parsed_args != args:
            self.parsed_args = args
            self.parsed_ctx = _resolve_context(args, self.ctx)
            self.ctx_command = self.parsed_ctx.command

        if getattr(self.ctx_command, "hidden", False):
            return

        try:
            choices.extend(
                self._get_completion_for_cmd_args(
                    self.ctx_command, incomplete, self.parsed_ctx, args
                )
            )

            if isinstance(self.ctx_command, click.MultiCommand):
                incomplete_lower = incomplete.lower()

                for name in self.ctx_command.list_commands(self.parsed_ctx):
                    command = self.ctx_command.get_command(self.parsed_ctx, name)
                    if getattr(command, "hidden", False):
                        continue

                    elif name.lower().startswith(incomplete_lower):
                        choices.append(
                            Completion(
                                text_type(name),
                                -len(incomplete),
                                display_meta=getattr(command, "short_help", ""),
                            )
                        )

        except Exception as e:
            click.echo("{}: {}".format(type(e).__name__, str(e)))

        # If we are inside a parameter that was called, we want to show only
        # relevant choices
        # if param_called:
        #     choices = param_choices

        for item in choices:
            yield item

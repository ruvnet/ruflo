from __future__ import with_statement

import click
import sys
from prompt_toolkit import PromptSession
from prompt_toolkit.history import InMemoryHistory

from ._completer import ClickCompleter
from .exceptions import ClickExit  # type: ignore[attr-defined]
from .exceptions import CommandLineParserError, ExitReplException, InvalidGroupFormat
from .utils import _execute_internal_and_sys_cmds


__all__ = ["bootstrap_prompt", "register_repl", "repl"]


def bootstrap_prompt(
    group,
    prompt_kwargs,
    ctx=None,
):
    """
    Bootstrap prompt_toolkit kwargs or use user defined values.

    :param group: click Group
    :param prompt_kwargs: The user specified prompt kwargs.
    """

    defaults = {
        "history": InMemoryHistory(),
        "completer": ClickCompleter(group, ctx=ctx),
        "message": "> ",
    }

    defaults.update(prompt_kwargs)
    return defaults


def repl(
    old_ctx, prompt_kwargs={}, allow_system_commands=True, allow_internal_commands=True
):
    """
    Start an interactive shell. All subcommands are available in it.

    :param old_ctx: The current Click context.
    :param prompt_kwargs: Parameters passed to
        :py:func:`prompt_toolkit.PromptSession`.

    If stdin is not a TTY, no prompt will be printed, but only commands read
    from stdin.
    """

    group_ctx = old_ctx
    # Switching to the parent context that has a Group as its command
    # as a Group acts as a CLI for all of its subcommands
    if old_ctx.parent is not None and not isinstance(old_ctx.command, click.Group):
        group_ctx = old_ctx.parent

    group = group_ctx.command

    # An Optional click.Argument in the CLI Group, that has no value
    # will consume the first word from the REPL input, causing issues in
    # executing the command
    # So, if there's an empty Optional Argument
    for param in group.params:
        if (
            isinstance(param, click.Argument)
            and group_ctx.params[param.name] is None
            and not param.required
        ):
            raise InvalidGroupFormat(
                f"{type(group).__name__} '{group.name}' requires value for "
                f"an optional argument '{param.name}' in REPL mode"
            )

    isatty = sys.stdin.isatty()

    # Delete the REPL command from those available, as we don't want to allow
    # nesting REPLs (note: pass `None` to `pop` as we don't want to error if
    # REPL command already not present for some reason).
    repl_command_name = old_ctx.command.name
    if isinstance(group_ctx.command, click.CommandCollection):
        available_commands = {
            cmd_name: cmd_obj
            for source in group_ctx.command.sources
            for cmd_name, cmd_obj in source.commands.items()
        }
    else:
        available_commands = group_ctx.command.commands

    original_command = available_commands.pop(repl_command_name, None)

    if isatty:
        prompt_kwargs = bootstrap_prompt(group, prompt_kwargs, group_ctx)
        session = PromptSession(**prompt_kwargs)

        def get_command():
            return session.prompt()

    else:
        get_command = sys.stdin.readline

    while True:
        try:
            command = get_command()
        except KeyboardInterrupt:
            continue
        except EOFError:
            break

        if not command:
            if isatty:
                continue
            else:
                break

        try:
            args = _execute_internal_and_sys_cmds(
                command, allow_internal_commands, allow_system_commands
            )
            if args is None:
                continue

        except CommandLineParserError:
            continue

        except ExitReplException:
            break

        try:
            # The group command will dispatch based on args.
            old_protected_args = group_ctx.protected_args
            try:
                group_ctx.protected_args = args
                group.invoke(group_ctx)
            finally:
                group_ctx.protected_args = old_protected_args
        except click.ClickException as e:
            e.show()
        except (ClickExit, SystemExit):
            pass

        except ExitReplException:
            break

    if original_command is not None:
        available_commands[repl_command_name] = original_command


def register_repl(group, name="repl"):
    """Register :func:`repl()` as sub-command *name* of *group*."""
    group.command(name=name)(click.pass_context(repl))

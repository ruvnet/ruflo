import errno
import inspect
import os
import sys
from enum import Enum
from gettext import gettext as _
from typing import (
    Any,
    Callable,
    Dict,
    List,
    MutableMapping,
    Optional,
    Sequence,
    TextIO,
    Tuple,
    Union,
    cast,
)

import click
import click.core
import click.formatting
import click.parser
import click.shell_completion
import click.types
import click.utils

from ._typing import Literal

MarkupMode = Literal["markdown", "rich", None]

try:
    import rich

    from . import rich_utils

    DEFAULT_MARKUP_MODE: MarkupMode = "rich"

except ImportError:  # pragma: no cover
    rich = None  # type: ignore
    DEFAULT_MARKUP_MODE = None


# Copy from click.parser._split_opt
def _split_opt(opt: str) -> Tuple[str, str]:
    first = opt[:1]
    if first.isalnum():
        return "", opt
    if opt[1:2] == first:
        return opt[:2], opt[2:]
    return first, opt[1:]


def _typer_param_setup_autocompletion_compat(
    self: click.Parameter,
    *,
    autocompletion: Optional[
        Callable[[click.Context, List[str], str], List[Union[Tuple[str, str], str]]]
    ] = None,
) -> None:
    if self._custom_shell_complete is not None:
        import warnings

        warnings.warn(
            "In Typer, only the parameter 'autocompletion' is supported. "
            "The support for 'shell_complete' is deprecated and will be removed in upcoming versions. ",
            DeprecationWarning,
            stacklevel=2,
        )

    if autocompletion is not None:

        def compat_autocompletion(
            ctx: click.Context, param: click.core.Parameter, incomplete: str
        ) -> List["click.shell_completion.CompletionItem"]:
            from click.shell_completion import CompletionItem

            out = []

            for c in autocompletion(ctx, [], incomplete):
                if isinstance(c, tuple):
                    use_completion = CompletionItem(c[0], help=c[1])
                else:
                    assert isinstance(c, str)
                    use_completion = CompletionItem(c)

                if use_completion.value.startswith(incomplete):
                    out.append(use_completion)

            return out

        self._custom_shell_complete = compat_autocompletion


def _get_default_string(
    obj: Union["TyperArgument", "TyperOption"],
    *,
    ctx: click.Context,
    show_default_is_str: bool,
    default_value: Union[List[Any], Tuple[Any, ...], str, Callable[..., Any], Any],
) -> str:
    # Extracted from click.core.Option.get_help_record() to be reused by
    # rich_utils avoiding RegEx hacks
    if show_default_is_str:
        default_string = f"({obj.show_default})"
    elif isinstance(default_value, (list, tuple)):
        default_string = ", ".join(
            _get_default_string(
                obj, ctx=ctx, show_default_is_str=show_default_is_str, default_value=d
            )
            for d in default_value
        )
    elif isinstance(default_value, Enum):
        default_string = str(default_value.value)
    elif inspect.isfunction(default_value):
        default_string = _("(dynamic)")
    elif isinstance(obj, TyperOption) and obj.is_bool_flag and obj.secondary_opts:
        # For boolean flags that have distinct True/False opts,
        # use the opt without prefix instead of the value.
        # Typer override, original commented
        # default_string = click.parser.split_opt(
        #     (self.opts if self.default else self.secondary_opts)[0]
        # )[1]
        if obj.default:
            if obj.opts:
                default_string = _split_opt(obj.opts[0])[1]
            else:
                default_string = str(default_value)
        else:
            default_string = _split_opt(obj.secondary_opts[0])[1]
        # Typer override end
    elif (
        isinstance(obj, TyperOption)
        and obj.is_bool_flag
        and not obj.secondary_opts
        and not default_value
    ):
        default_string = ""
    else:
        default_string = str(default_value)
    return default_string


def _extract_default_help_str(
    obj: Union["TyperArgument", "TyperOption"], *, ctx: click.Context
) -> Optional[Union[Any, Callable[[], Any]]]:
    # Extracted from click.core.Option.get_help_record() to be reused by
    # rich_utils avoiding RegEx hacks
    # Temporarily enable resilient parsing to avoid type casting
    # failing for the default. Might be possible to extend this to
    # help formatting in general.
    resilient = ctx.resilient_parsing
    ctx.resilient_parsing = True

    try:
        default_value = obj.get_default(ctx, call=False)
    finally:
        ctx.resilient_parsing = resilient
    return default_value


def _main(
    self: click.Command,
    *,
    args: Optional[Sequence[str]] = None,
    prog_name: Optional[str] = None,
    complete_var: Optional[str] = None,
    standalone_mode: bool = True,
    windows_expand_args: bool = True,
    rich_markup_mode: MarkupMode = DEFAULT_MARKUP_MODE,
    **extra: Any,
) -> Any:
    # Typer override, duplicated from click.main() to handle custom rich exceptions
    # Verify that the environment is configured correctly, or reject
    # further execution to avoid a broken script.
    if args is None:
        args = sys.argv[1:]

        # Covered in Click tests
        if os.name == "nt" and windows_expand_args:  # pragma: no cover
            args = click.utils._expand_args(args)
    else:
        args = list(args)

    if prog_name is None:
        prog_name = click.utils._detect_program_name()

    # Process shell completion requests and exit early.
    self._main_shell_completion(extra, prog_name, complete_var)

    try:
        try:
            with self.make_context(prog_name, args, **extra) as ctx:
                rv = self.invoke(ctx)
                if not standalone_mode:
                    return rv
                # it's not safe to `ctx.exit(rv)` here!
                # note that `rv` may actually contain data like "1" which
                # has obvious effects
                # more subtle case: `rv=[None, None]` can come out of
                # chained commands which all returned `None` -- so it's not
                # even always obvious that `rv` indicates success/failure
                # by its truthiness/falsiness
                ctx.exit()
        except EOFError as e:
            click.echo(file=sys.stderr)
            raise click.Abort() from e
        except KeyboardInterrupt as e:
            raise click.exceptions.Exit(130) from e
        except click.ClickException as e:
            if not standalone_mode:
                raise
            # Typer override
            if rich and rich_markup_mode is not None:
                rich_utils.rich_format_error(e)
            else:
                e.show()
            # Typer override end
            sys.exit(e.exit_code)
        except OSError as e:
            if e.errno == errno.EPIPE:
                sys.stdout = cast(TextIO, click.utils.PacifyFlushWrapper(sys.stdout))
                sys.stderr = cast(TextIO, click.utils.PacifyFlushWrapper(sys.stderr))
                sys.exit(1)
            else:
                raise
    except click.exceptions.Exit as e:
        if standalone_mode:
            sys.exit(e.exit_code)
        else:
            # in non-standalone mode, return the exit code
            # note that this is only reached if `self.invoke` above raises
            # an Exit explicitly -- thus bypassing the check there which
            # would return its result
            # the results of non-standalone execution may therefore be
            # somewhat ambiguous: if there are codepaths which lead to
            # `ctx.exit(1)` and to `return 1`, the caller won't be able to
            # tell the difference between the two
            return e.exit_code
    except click.Abort:
        if not standalone_mode:
            raise
        # Typer override
        if rich and rich_markup_mode is not None:
            rich_utils.rich_abort_error()
        else:
            click.echo(_("Aborted!"), file=sys.stderr)
        # Typer override end
        sys.exit(1)


class TyperArgument(click.core.Argument):
    def __init__(
        self,
        *,
        # Parameter
        param_decls: List[str],
        type: Optional[Any] = None,
        required: Optional[bool] = None,
        default: Optional[Any] = None,
        callback: Optional[Callable[..., Any]] = None,
        nargs: Optional[int] = None,
        metavar: Optional[str] = None,
        expose_value: bool = True,
        is_eager: bool = False,
        envvar: Optional[Union[str, List[str]]] = None,
        # Note that shell_complete is not fully supported and will be removed in future versions
        # TODO: Remove shell_complete in a future version (after 0.16.0)
        shell_complete: Optional[
            Callable[
                [click.Context, click.Parameter, str],
                Union[List["click.shell_completion.CompletionItem"], List[str]],
            ]
        ] = None,
        autocompletion: Optional[Callable[..., Any]] = None,
        # TyperArgument
        show_default: Union[bool, str] = True,
        show_choices: bool = True,
        show_envvar: bool = True,
        help: Optional[str] = None,
        hidden: bool = False,
        # Rich settings
        rich_help_panel: Union[str, None] = None,
    ):
        self.help = help
        self.show_default = show_default
        self.show_choices = show_choices
        self.show_envvar = show_envvar
        self.hidden = hidden
        self.rich_help_panel = rich_help_panel

        super().__init__(
            param_decls=param_decls,
            type=type,
            required=required,
            default=default,
            callback=callback,
            nargs=nargs,
            metavar=metavar,
            expose_value=expose_value,
            is_eager=is_eager,
            envvar=envvar,
            shell_complete=shell_complete,
        )
        _typer_param_setup_autocompletion_compat(self, autocompletion=autocompletion)

    def _get_default_string(
        self,
        *,
        ctx: click.Context,
        show_default_is_str: bool,
        default_value: Union[List[Any], Tuple[Any, ...], str, Callable[..., Any], Any],
    ) -> str:
        return _get_default_string(
            self,
            ctx=ctx,
            show_default_is_str=show_default_is_str,
            default_value=default_value,
        )

    def _extract_default_help_str(
        self, *, ctx: click.Context
    ) -> Optional[Union[Any, Callable[[], Any]]]:
        return _extract_default_help_str(self, ctx=ctx)

    def get_help_record(self, ctx: click.Context) -> Optional[Tuple[str, str]]:
        # Modified version of click.core.Option.get_help_record()
        # to support Arguments
        if self.hidden:
            return None
        name = self.make_metavar(ctx=ctx)
        help = self.help or ""
        extra = []
        if self.show_envvar:
            envvar = self.envvar
            # allow_from_autoenv is currently not supported in Typer for CLI Arguments
            if envvar is not None:
                var_str = (
                    ", ".join(str(d) for d in envvar)
                    if isinstance(envvar, (list, tuple))
                    else envvar
                )
                extra.append(f"env var: {var_str}")

        # Typer override:
        # Extracted to _extract_default_help_str() to allow re-using it in rich_utils
        default_value = self._extract_default_help_str(ctx=ctx)
        # Typer override end

        show_default_is_str = isinstance(self.show_default, str)

        if show_default_is_str or (
            default_value is not None and (self.show_default or ctx.show_default)
        ):
            # Typer override:
            # Extracted to _get_default_string() to allow re-using it in rich_utils
            default_string = self._get_default_string(
                ctx=ctx,
                show_default_is_str=show_default_is_str,
                default_value=default_value,
            )
            # Typer override end
            if default_string:
                extra.append(_("default: {default}").format(default=default_string))
        if self.required:
            extra.append(_("required"))
        if extra:
            extra_str = "; ".join(extra)
            extra_str = f"[{extra_str}]"
            if rich is not None:
                # This is needed for when we want to export to HTML
                extra_str = rich.markup.escape(extra_str).strip()

            help = f"{help}  {extra_str}" if help else f"{extra_str}"
        return name, help

    def make_metavar(self, ctx: Union[click.Context, None] = None) -> str:
        # Modified version of click.core.Argument.make_metavar()
        # to include Argument name
        if self.metavar is not None:
            return self.metavar
        var = (self.name or "").upper()
        if not self.required:
            var = f"[{var}]"
        # TODO: When deprecating Click < 8.2, remove this
        signature = inspect.signature(self.type.get_metavar)
        if "ctx" in signature.parameters:
            # Click >= 8.2
            type_var = self.type.get_metavar(self, ctx=ctx)  # type: ignore[arg-type]
        else:
            # Click < 8.2
            type_var = self.type.get_metavar(self)  # type: ignore[call-arg]
        # TODO: /When deprecating Click < 8.2, remove this, uncomment the line below
        # type_var = self.type.get_metavar(self, ctx=ctx)
        if type_var:
            var += f":{type_var}"
        if self.nargs != 1:
            var += "..."
        return var


class TyperOption(click.core.Option):
    def __init__(
        self,
        *,
        # Parameter
        param_decls: List[str],
        type: Optional[Union[click.types.ParamType, Any]] = None,
        required: Optional[bool] = None,
        default: Optional[Any] = None,
        callback: Optional[Callable[..., Any]] = None,
        nargs: Optional[int] = None,
        metavar: Optional[str] = None,
        expose_value: bool = True,
        is_eager: bool = False,
        envvar: Optional[Union[str, List[str]]] = None,
        # Note that shell_complete is not fully supported and will be removed in future versions
        # TODO: Remove shell_complete in a future version (after 0.16.0)
        shell_complete: Optional[
            Callable[
                [click.Context, click.Parameter, str],
                Union[List["click.shell_completion.CompletionItem"], List[str]],
            ]
        ] = None,
        autocompletion: Optional[Callable[..., Any]] = None,
        # Option
        show_default: Union[bool, str] = False,
        prompt: Union[bool, str] = False,
        confirmation_prompt: Union[bool, str] = False,
        prompt_required: bool = True,
        hide_input: bool = False,
        is_flag: Optional[bool] = None,
        multiple: bool = False,
        count: bool = False,
        allow_from_autoenv: bool = True,
        help: Optional[str] = None,
        hidden: bool = False,
        show_choices: bool = True,
        show_envvar: bool = False,
        # Rich settings
        rich_help_panel: Union[str, None] = None,
    ):
        super().__init__(
            param_decls=param_decls,
            type=type,
            required=required,
            default=default,
            callback=callback,
            nargs=nargs,
            metavar=metavar,
            expose_value=expose_value,
            is_eager=is_eager,
            envvar=envvar,
            show_default=show_default,
            prompt=prompt,
            confirmation_prompt=confirmation_prompt,
            hide_input=hide_input,
            is_flag=is_flag,
            multiple=multiple,
            count=count,
            allow_from_autoenv=allow_from_autoenv,
            help=help,
            hidden=hidden,
            show_choices=show_choices,
            show_envvar=show_envvar,
            prompt_required=prompt_required,
            shell_complete=shell_complete,
        )
        _typer_param_setup_autocompletion_compat(self, autocompletion=autocompletion)
        self.rich_help_panel = rich_help_panel

    def _get_default_string(
        self,
        *,
        ctx: click.Context,
        show_default_is_str: bool,
        default_value: Union[List[Any], Tuple[Any, ...], str, Callable[..., Any], Any],
    ) -> str:
        return _get_default_string(
            self,
            ctx=ctx,
            show_default_is_str=show_default_is_str,
            default_value=default_value,
        )

    def _extract_default_help_str(
        self, *, ctx: click.Context
    ) -> Optional[Union[Any, Callable[[], Any]]]:
        return _extract_default_help_str(self, ctx=ctx)

    def make_metavar(self, ctx: Union[click.Context, None] = None) -> str:
        signature = inspect.signature(super().make_metavar)
        if "ctx" in signature.parameters:
            # Click >= 8.2
            return super().make_metavar(ctx=ctx)  # type: ignore[arg-type]
        # Click < 8.2
        return super().make_metavar()  # type: ignore[call-arg]

    def get_help_record(self, ctx: click.Context) -> Optional[Tuple[str, str]]:
        # Duplicate all of Click's logic only to modify a single line, to allow boolean
        # flags with only names for False values as it's currently supported by Typer
        # Ref: https://typer.tiangolo.com/tutorial/parameter-types/bool/#only-names-for-false
        if self.hidden:
            return None

        any_prefix_is_slash = False

        def _write_opts(opts: Sequence[str]) -> str:
            nonlocal any_prefix_is_slash

            rv, any_slashes = click.formatting.join_options(opts)

            if any_slashes:
                any_prefix_is_slash = True

            if not self.is_flag and not self.count:
                rv += f" {self.make_metavar(ctx=ctx)}"

            return rv

        rv = [_write_opts(self.opts)]

        if self.secondary_opts:
            rv.append(_write_opts(self.secondary_opts))

        help = self.help or ""
        extra = []

        if self.show_envvar:
            envvar = self.envvar

            if envvar is None:
                if (
                    self.allow_from_autoenv
                    and ctx.auto_envvar_prefix is not None
                    and self.name is not None
                ):
                    envvar = f"{ctx.auto_envvar_prefix}_{self.name.upper()}"

            if envvar is not None:
                var_str = (
                    envvar
                    if isinstance(envvar, str)
                    else ", ".join(str(d) for d in envvar)
                )
                extra.append(_("env var: {var}").format(var=var_str))

        # Typer override:
        # Extracted to _extract_default() to allow re-using it in rich_utils
        default_value = self._extract_default_help_str(ctx=ctx)
        # Typer override end

        show_default_is_str = isinstance(self.show_default, str)

        if show_default_is_str or (
            default_value is not None and (self.show_default or ctx.show_default)
        ):
            # Typer override:
            # Extracted to _get_default_string() to allow re-using it in rich_utils
            default_string = self._get_default_string(
                ctx=ctx,
                show_default_is_str=show_default_is_str,
                default_value=default_value,
            )
            # Typer override end
            if default_string:
                extra.append(_("default: {default}").format(default=default_string))

        if isinstance(self.type, click.types._NumberRangeBase):
            range_str = self.type._describe_range()

            if range_str:
                extra.append(range_str)

        if self.required:
            extra.append(_("required"))

        if extra:
            extra_str = "; ".join(extra)
            extra_str = f"[{extra_str}]"
            if rich is not None:
                # This is needed for when we want to export to HTML
                extra_str = rich.markup.escape(extra_str).strip()

            help = f"{help}  {extra_str}" if help else f"{extra_str}"

        return ("; " if any_prefix_is_slash else " / ").join(rv), help


def _typer_format_options(
    self: click.core.Command, *, ctx: click.Context, formatter: click.HelpFormatter
) -> None:
    args = []
    opts = []
    for param in self.get_params(ctx):
        rv = param.get_help_record(ctx)
        if rv is not None:
            if param.param_type_name == "argument":
                args.append(rv)
            elif param.param_type_name == "option":
                opts.append(rv)

    if args:
        with formatter.section(_("Arguments")):
            formatter.write_dl(args)
    if opts:
        with formatter.section(_("Options")):
            formatter.write_dl(opts)


def _typer_main_shell_completion(
    self: click.core.Command,
    *,
    ctx_args: MutableMapping[str, Any],
    prog_name: str,
    complete_var: Optional[str] = None,
) -> None:
    if complete_var is None:
        complete_var = f"_{prog_name}_COMPLETE".replace("-", "_").upper()

    instruction = os.environ.get(complete_var)

    if not instruction:
        return

    from .completion import shell_complete

    rv = shell_complete(self, ctx_args, prog_name, complete_var, instruction)
    sys.exit(rv)


class TyperCommand(click.core.Command):
    def __init__(
        self,
        name: Optional[str],
        *,
        context_settings: Optional[Dict[str, Any]] = None,
        callback: Optional[Callable[..., Any]] = None,
        params: Optional[List[click.Parameter]] = None,
        help: Optional[str] = None,
        epilog: Optional[str] = None,
        short_help: Optional[str] = None,
        options_metavar: Optional[str] = "[OPTIONS]",
        add_help_option: bool = True,
        no_args_is_help: bool = False,
        hidden: bool = False,
        deprecated: bool = False,
        # Rich settings
        rich_markup_mode: MarkupMode = DEFAULT_MARKUP_MODE,
        rich_help_panel: Union[str, None] = None,
    ) -> None:
        super().__init__(
            name=name,
            context_settings=context_settings,
            callback=callback,
            params=params,
            help=help,
            epilog=epilog,
            short_help=short_help,
            options_metavar=options_metavar,
            add_help_option=add_help_option,
            no_args_is_help=no_args_is_help,
            hidden=hidden,
            deprecated=deprecated,
        )
        self.rich_markup_mode: MarkupMode = rich_markup_mode
        self.rich_help_panel = rich_help_panel

    def format_options(
        self, ctx: click.Context, formatter: click.HelpFormatter
    ) -> None:
        _typer_format_options(self, ctx=ctx, formatter=formatter)

    def _main_shell_completion(
        self,
        ctx_args: MutableMapping[str, Any],
        prog_name: str,
        complete_var: Optional[str] = None,
    ) -> None:
        _typer_main_shell_completion(
            self, ctx_args=ctx_args, prog_name=prog_name, complete_var=complete_var
        )

    def main(
        self,
        args: Optional[Sequence[str]] = None,
        prog_name: Optional[str] = None,
        complete_var: Optional[str] = None,
        standalone_mode: bool = True,
        windows_expand_args: bool = True,
        **extra: Any,
    ) -> Any:
        return _main(
            self,
            args=args,
            prog_name=prog_name,
            complete_var=complete_var,
            standalone_mode=standalone_mode,
            windows_expand_args=windows_expand_args,
            rich_markup_mode=self.rich_markup_mode,
            **extra,
        )

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        if not rich or self.rich_markup_mode is None:
            return super().format_help(ctx, formatter)
        return rich_utils.rich_format_help(
            obj=self,
            ctx=ctx,
            markup_mode=self.rich_markup_mode,
        )


class TyperGroup(click.core.Group):
    def __init__(
        self,
        *,
        name: Optional[str] = None,
        commands: Optional[
            Union[Dict[str, click.Command], Sequence[click.Command]]
        ] = None,
        # Rich settings
        rich_markup_mode: MarkupMode = DEFAULT_MARKUP_MODE,
        rich_help_panel: Union[str, None] = None,
        **attrs: Any,
    ) -> None:
        super().__init__(name=name, commands=commands, **attrs)
        self.rich_markup_mode: MarkupMode = rich_markup_mode
        self.rich_help_panel = rich_help_panel

    def format_options(
        self, ctx: click.Context, formatter: click.HelpFormatter
    ) -> None:
        _typer_format_options(self, ctx=ctx, formatter=formatter)
        self.format_commands(ctx, formatter)

    def _main_shell_completion(
        self,
        ctx_args: MutableMapping[str, Any],
        prog_name: str,
        complete_var: Optional[str] = None,
    ) -> None:
        _typer_main_shell_completion(
            self, ctx_args=ctx_args, prog_name=prog_name, complete_var=complete_var
        )

    def main(
        self,
        args: Optional[Sequence[str]] = None,
        prog_name: Optional[str] = None,
        complete_var: Optional[str] = None,
        standalone_mode: bool = True,
        windows_expand_args: bool = True,
        **extra: Any,
    ) -> Any:
        return _main(
            self,
            args=args,
            prog_name=prog_name,
            complete_var=complete_var,
            standalone_mode=standalone_mode,
            windows_expand_args=windows_expand_args,
            rich_markup_mode=self.rich_markup_mode,
            **extra,
        )

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        if not rich or self.rich_markup_mode is None:
            return super().format_help(ctx, formatter)
        return rich_utils.rich_format_help(
            obj=self,
            ctx=ctx,
            markup_mode=self.rich_markup_mode,
        )

    def list_commands(self, ctx: click.Context) -> List[str]:
        """Returns a list of subcommand names.
        Note that in Click's Group class, these are sorted.
        In Typer, we wish to maintain the original order of creation (cf Issue #933)"""
        return [n for n, c in self.commands.items()]

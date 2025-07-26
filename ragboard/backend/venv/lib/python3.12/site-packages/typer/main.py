import inspect
import os
import platform
import shutil
import subprocess
import sys
import traceback
from datetime import datetime
from enum import Enum
from functools import update_wrapper
from pathlib import Path
from traceback import FrameSummary, StackSummary
from types import TracebackType
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Type, Union
from uuid import UUID

import click
from typer._types import TyperChoice

from ._typing import get_args, get_origin, is_union
from .completion import get_completion_inspect_parameters
from .core import (
    DEFAULT_MARKUP_MODE,
    MarkupMode,
    TyperArgument,
    TyperCommand,
    TyperGroup,
    TyperOption,
)
from .models import (
    AnyType,
    ArgumentInfo,
    CommandFunctionType,
    CommandInfo,
    Default,
    DefaultPlaceholder,
    DeveloperExceptionConfig,
    FileBinaryRead,
    FileBinaryWrite,
    FileText,
    FileTextWrite,
    NoneType,
    OptionInfo,
    ParameterInfo,
    ParamMeta,
    Required,
    TyperInfo,
    TyperPath,
)
from .utils import get_params_from_function

try:
    import rich
    from rich.traceback import Traceback

    from . import rich_utils

    console_stderr = rich_utils._get_rich_console(stderr=True)

except ImportError:  # pragma: no cover
    rich = None  # type: ignore

_original_except_hook = sys.excepthook
_typer_developer_exception_attr_name = "__typer_developer_exception__"


def except_hook(
    exc_type: Type[BaseException], exc_value: BaseException, tb: Optional[TracebackType]
) -> None:
    exception_config: Union[DeveloperExceptionConfig, None] = getattr(
        exc_value, _typer_developer_exception_attr_name, None
    )
    standard_traceback = os.getenv("_TYPER_STANDARD_TRACEBACK")
    if (
        standard_traceback
        or not exception_config
        or not exception_config.pretty_exceptions_enable
    ):
        _original_except_hook(exc_type, exc_value, tb)
        return
    typer_path = os.path.dirname(__file__)
    click_path = os.path.dirname(click.__file__)
    supress_internal_dir_names = [typer_path, click_path]
    exc = exc_value
    if rich:
        from .rich_utils import MAX_WIDTH

        rich_tb = Traceback.from_exception(
            type(exc),
            exc,
            exc.__traceback__,
            show_locals=exception_config.pretty_exceptions_show_locals,
            suppress=supress_internal_dir_names,
            width=MAX_WIDTH,
        )
        console_stderr.print(rich_tb)
        return
    tb_exc = traceback.TracebackException.from_exception(exc)
    stack: List[FrameSummary] = []
    for frame in tb_exc.stack:
        if any(frame.filename.startswith(path) for path in supress_internal_dir_names):
            if not exception_config.pretty_exceptions_short:
                # Hide the line for internal libraries, Typer and Click
                stack.append(
                    traceback.FrameSummary(
                        filename=frame.filename,
                        lineno=frame.lineno,
                        name=frame.name,
                        line="",
                    )
                )
        else:
            stack.append(frame)
    # Type ignore ref: https://github.com/python/typeshed/pull/8244
    final_stack_summary = StackSummary.from_list(stack)
    tb_exc.stack = final_stack_summary
    for line in tb_exc.format():
        print(line, file=sys.stderr)
    return


def get_install_completion_arguments() -> Tuple[click.Parameter, click.Parameter]:
    install_param, show_param = get_completion_inspect_parameters()
    click_install_param, _ = get_click_param(install_param)
    click_show_param, _ = get_click_param(show_param)
    return click_install_param, click_show_param


class Typer:
    def __init__(
        self,
        *,
        name: Optional[str] = Default(None),
        cls: Optional[Type[TyperGroup]] = Default(None),
        invoke_without_command: bool = Default(False),
        no_args_is_help: bool = Default(False),
        subcommand_metavar: Optional[str] = Default(None),
        chain: bool = Default(False),
        result_callback: Optional[Callable[..., Any]] = Default(None),
        # Command
        context_settings: Optional[Dict[Any, Any]] = Default(None),
        callback: Optional[Callable[..., Any]] = Default(None),
        help: Optional[str] = Default(None),
        epilog: Optional[str] = Default(None),
        short_help: Optional[str] = Default(None),
        options_metavar: str = Default("[OPTIONS]"),
        add_help_option: bool = Default(True),
        hidden: bool = Default(False),
        deprecated: bool = Default(False),
        add_completion: bool = True,
        # Rich settings
        rich_markup_mode: MarkupMode = Default(DEFAULT_MARKUP_MODE),
        rich_help_panel: Union[str, None] = Default(None),
        pretty_exceptions_enable: bool = True,
        pretty_exceptions_show_locals: bool = True,
        pretty_exceptions_short: bool = True,
    ):
        self._add_completion = add_completion
        self.rich_markup_mode: MarkupMode = rich_markup_mode
        self.rich_help_panel = rich_help_panel
        self.pretty_exceptions_enable = pretty_exceptions_enable
        self.pretty_exceptions_show_locals = pretty_exceptions_show_locals
        self.pretty_exceptions_short = pretty_exceptions_short
        self.info = TyperInfo(
            name=name,
            cls=cls,
            invoke_without_command=invoke_without_command,
            no_args_is_help=no_args_is_help,
            subcommand_metavar=subcommand_metavar,
            chain=chain,
            result_callback=result_callback,
            context_settings=context_settings,
            callback=callback,
            help=help,
            epilog=epilog,
            short_help=short_help,
            options_metavar=options_metavar,
            add_help_option=add_help_option,
            hidden=hidden,
            deprecated=deprecated,
        )
        self.registered_groups: List[TyperInfo] = []
        self.registered_commands: List[CommandInfo] = []
        self.registered_callback: Optional[TyperInfo] = None

    def callback(
        self,
        *,
        cls: Optional[Type[TyperGroup]] = Default(None),
        invoke_without_command: bool = Default(False),
        no_args_is_help: bool = Default(False),
        subcommand_metavar: Optional[str] = Default(None),
        chain: bool = Default(False),
        result_callback: Optional[Callable[..., Any]] = Default(None),
        # Command
        context_settings: Optional[Dict[Any, Any]] = Default(None),
        help: Optional[str] = Default(None),
        epilog: Optional[str] = Default(None),
        short_help: Optional[str] = Default(None),
        options_metavar: str = Default("[OPTIONS]"),
        add_help_option: bool = Default(True),
        hidden: bool = Default(False),
        deprecated: bool = Default(False),
        # Rich settings
        rich_help_panel: Union[str, None] = Default(None),
    ) -> Callable[[CommandFunctionType], CommandFunctionType]:
        def decorator(f: CommandFunctionType) -> CommandFunctionType:
            self.registered_callback = TyperInfo(
                cls=cls,
                invoke_without_command=invoke_without_command,
                no_args_is_help=no_args_is_help,
                subcommand_metavar=subcommand_metavar,
                chain=chain,
                result_callback=result_callback,
                context_settings=context_settings,
                callback=f,
                help=help,
                epilog=epilog,
                short_help=short_help,
                options_metavar=options_metavar,
                add_help_option=add_help_option,
                hidden=hidden,
                deprecated=deprecated,
                rich_help_panel=rich_help_panel,
            )
            return f

        return decorator

    def command(
        self,
        name: Optional[str] = None,
        *,
        cls: Optional[Type[TyperCommand]] = None,
        context_settings: Optional[Dict[Any, Any]] = None,
        help: Optional[str] = None,
        epilog: Optional[str] = None,
        short_help: Optional[str] = None,
        options_metavar: str = "[OPTIONS]",
        add_help_option: bool = True,
        no_args_is_help: bool = False,
        hidden: bool = False,
        deprecated: bool = False,
        # Rich settings
        rich_help_panel: Union[str, None] = Default(None),
    ) -> Callable[[CommandFunctionType], CommandFunctionType]:
        if cls is None:
            cls = TyperCommand

        def decorator(f: CommandFunctionType) -> CommandFunctionType:
            self.registered_commands.append(
                CommandInfo(
                    name=name,
                    cls=cls,
                    context_settings=context_settings,
                    callback=f,
                    help=help,
                    epilog=epilog,
                    short_help=short_help,
                    options_metavar=options_metavar,
                    add_help_option=add_help_option,
                    no_args_is_help=no_args_is_help,
                    hidden=hidden,
                    deprecated=deprecated,
                    # Rich settings
                    rich_help_panel=rich_help_panel,
                )
            )
            return f

        return decorator

    def add_typer(
        self,
        typer_instance: "Typer",
        *,
        name: Optional[str] = Default(None),
        cls: Optional[Type[TyperGroup]] = Default(None),
        invoke_without_command: bool = Default(False),
        no_args_is_help: bool = Default(False),
        subcommand_metavar: Optional[str] = Default(None),
        chain: bool = Default(False),
        result_callback: Optional[Callable[..., Any]] = Default(None),
        # Command
        context_settings: Optional[Dict[Any, Any]] = Default(None),
        callback: Optional[Callable[..., Any]] = Default(None),
        help: Optional[str] = Default(None),
        epilog: Optional[str] = Default(None),
        short_help: Optional[str] = Default(None),
        options_metavar: str = Default("[OPTIONS]"),
        add_help_option: bool = Default(True),
        hidden: bool = Default(False),
        deprecated: bool = Default(False),
        # Rich settings
        rich_help_panel: Union[str, None] = Default(None),
    ) -> None:
        self.registered_groups.append(
            TyperInfo(
                typer_instance,
                name=name,
                cls=cls,
                invoke_without_command=invoke_without_command,
                no_args_is_help=no_args_is_help,
                subcommand_metavar=subcommand_metavar,
                chain=chain,
                result_callback=result_callback,
                context_settings=context_settings,
                callback=callback,
                help=help,
                epilog=epilog,
                short_help=short_help,
                options_metavar=options_metavar,
                add_help_option=add_help_option,
                hidden=hidden,
                deprecated=deprecated,
                rich_help_panel=rich_help_panel,
            )
        )

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if sys.excepthook != except_hook:
            sys.excepthook = except_hook
        try:
            return get_command(self)(*args, **kwargs)
        except Exception as e:
            # Set a custom attribute to tell the hook to show nice exceptions for user
            # code. An alternative/first implementation was a custom exception with
            # raise custom_exc from e
            # but that means the last error shown is the custom exception, not the
            # actual error. This trick improves developer experience by showing the
            # actual error last.
            setattr(
                e,
                _typer_developer_exception_attr_name,
                DeveloperExceptionConfig(
                    pretty_exceptions_enable=self.pretty_exceptions_enable,
                    pretty_exceptions_show_locals=self.pretty_exceptions_show_locals,
                    pretty_exceptions_short=self.pretty_exceptions_short,
                ),
            )
            raise e


def get_group(typer_instance: Typer) -> TyperGroup:
    group = get_group_from_info(
        TyperInfo(typer_instance),
        pretty_exceptions_short=typer_instance.pretty_exceptions_short,
        rich_markup_mode=typer_instance.rich_markup_mode,
    )
    return group


def get_command(typer_instance: Typer) -> click.Command:
    if typer_instance._add_completion:
        click_install_param, click_show_param = get_install_completion_arguments()
    if (
        typer_instance.registered_callback
        or typer_instance.info.callback
        or typer_instance.registered_groups
        or len(typer_instance.registered_commands) > 1
    ):
        # Create a Group
        click_command: click.Command = get_group(typer_instance)
        if typer_instance._add_completion:
            click_command.params.append(click_install_param)
            click_command.params.append(click_show_param)
        return click_command
    elif len(typer_instance.registered_commands) == 1:
        # Create a single Command
        single_command = typer_instance.registered_commands[0]

        if not single_command.context_settings and not isinstance(
            typer_instance.info.context_settings, DefaultPlaceholder
        ):
            single_command.context_settings = typer_instance.info.context_settings

        click_command = get_command_from_info(
            single_command,
            pretty_exceptions_short=typer_instance.pretty_exceptions_short,
            rich_markup_mode=typer_instance.rich_markup_mode,
        )
        if typer_instance._add_completion:
            click_command.params.append(click_install_param)
            click_command.params.append(click_show_param)
        return click_command
    raise RuntimeError(
        "Could not get a command for this Typer instance"
    )  # pragma: no cover


def solve_typer_info_help(typer_info: TyperInfo) -> str:
    # Priority 1: Explicit value was set in app.add_typer()
    if not isinstance(typer_info.help, DefaultPlaceholder):
        return inspect.cleandoc(typer_info.help or "")
    # Priority 2: Explicit value was set in sub_app.callback()
    try:
        callback_help = typer_info.typer_instance.registered_callback.help
        if not isinstance(callback_help, DefaultPlaceholder):
            return inspect.cleandoc(callback_help or "")
    except AttributeError:
        pass
    # Priority 3: Explicit value was set in sub_app = typer.Typer()
    try:
        instance_help = typer_info.typer_instance.info.help
        if not isinstance(instance_help, DefaultPlaceholder):
            return inspect.cleandoc(instance_help or "")
    except AttributeError:
        pass
    # Priority 4: Implicit inference from callback docstring in app.add_typer()
    if typer_info.callback:
        doc = inspect.getdoc(typer_info.callback)
        if doc:
            return doc
    # Priority 5: Implicit inference from callback docstring in @app.callback()
    try:
        callback = typer_info.typer_instance.registered_callback.callback
        if not isinstance(callback, DefaultPlaceholder):
            doc = inspect.getdoc(callback or "")
            if doc:
                return doc
    except AttributeError:
        pass
    # Priority 6: Implicit inference from callback docstring in typer.Typer()
    try:
        instance_callback = typer_info.typer_instance.info.callback
        if not isinstance(instance_callback, DefaultPlaceholder):
            doc = inspect.getdoc(instance_callback)
            if doc:
                return doc
    except AttributeError:
        pass
    # Value not set, use the default
    return typer_info.help.value


def solve_typer_info_defaults(typer_info: TyperInfo) -> TyperInfo:
    values: Dict[str, Any] = {}
    for name, value in typer_info.__dict__.items():
        # Priority 1: Value was set in app.add_typer()
        if not isinstance(value, DefaultPlaceholder):
            values[name] = value
            continue
        # Priority 2: Value was set in @subapp.callback()
        try:
            callback_value = getattr(
                typer_info.typer_instance.registered_callback,  # type: ignore
                name,
            )
            if not isinstance(callback_value, DefaultPlaceholder):
                values[name] = callback_value
                continue
        except AttributeError:
            pass
        # Priority 3: Value set in subapp = typer.Typer()
        try:
            instance_value = getattr(
                typer_info.typer_instance.info,  # type: ignore
                name,
            )
            if not isinstance(instance_value, DefaultPlaceholder):
                values[name] = instance_value
                continue
        except AttributeError:
            pass
        # Value not set, use the default
        values[name] = value.value
    values["help"] = solve_typer_info_help(typer_info)
    return TyperInfo(**values)


def get_group_from_info(
    group_info: TyperInfo,
    *,
    pretty_exceptions_short: bool,
    rich_markup_mode: MarkupMode,
) -> TyperGroup:
    assert group_info.typer_instance, (
        "A Typer instance is needed to generate a Click Group"
    )
    commands: Dict[str, click.Command] = {}
    for command_info in group_info.typer_instance.registered_commands:
        command = get_command_from_info(
            command_info=command_info,
            pretty_exceptions_short=pretty_exceptions_short,
            rich_markup_mode=rich_markup_mode,
        )
        if command.name:
            commands[command.name] = command
    for sub_group_info in group_info.typer_instance.registered_groups:
        sub_group = get_group_from_info(
            sub_group_info,
            pretty_exceptions_short=pretty_exceptions_short,
            rich_markup_mode=rich_markup_mode,
        )
        if sub_group.name:
            commands[sub_group.name] = sub_group
        else:
            if sub_group.callback:
                import warnings

                warnings.warn(
                    "The 'callback' parameter is not supported by Typer when using `add_typer` without a name",
                    stacklevel=5,
                )
            for sub_command_name, sub_command in sub_group.commands.items():
                commands[sub_command_name] = sub_command
    solved_info = solve_typer_info_defaults(group_info)
    (
        params,
        convertors,
        context_param_name,
    ) = get_params_convertors_ctx_param_name_from_function(solved_info.callback)
    cls = solved_info.cls or TyperGroup
    assert issubclass(cls, TyperGroup), f"{cls} should be a subclass of {TyperGroup}"
    group = cls(
        name=solved_info.name or "",
        commands=commands,
        invoke_without_command=solved_info.invoke_without_command,
        no_args_is_help=solved_info.no_args_is_help,
        subcommand_metavar=solved_info.subcommand_metavar,
        chain=solved_info.chain,
        result_callback=solved_info.result_callback,
        context_settings=solved_info.context_settings,
        callback=get_callback(
            callback=solved_info.callback,
            params=params,
            convertors=convertors,
            context_param_name=context_param_name,
            pretty_exceptions_short=pretty_exceptions_short,
        ),
        params=params,
        help=solved_info.help,
        epilog=solved_info.epilog,
        short_help=solved_info.short_help,
        options_metavar=solved_info.options_metavar,
        add_help_option=solved_info.add_help_option,
        hidden=solved_info.hidden,
        deprecated=solved_info.deprecated,
        rich_markup_mode=rich_markup_mode,
        # Rich settings
        rich_help_panel=solved_info.rich_help_panel,
    )
    return group


def get_command_name(name: str) -> str:
    return name.lower().replace("_", "-")


def get_params_convertors_ctx_param_name_from_function(
    callback: Optional[Callable[..., Any]],
) -> Tuple[List[Union[click.Argument, click.Option]], Dict[str, Any], Optional[str]]:
    params = []
    convertors = {}
    context_param_name = None
    if callback:
        parameters = get_params_from_function(callback)
        for param_name, param in parameters.items():
            if lenient_issubclass(param.annotation, click.Context):
                context_param_name = param_name
                continue
            click_param, convertor = get_click_param(param)
            if convertor:
                convertors[param_name] = convertor
            params.append(click_param)
    return params, convertors, context_param_name


def get_command_from_info(
    command_info: CommandInfo,
    *,
    pretty_exceptions_short: bool,
    rich_markup_mode: MarkupMode,
) -> click.Command:
    assert command_info.callback, "A command must have a callback function"
    name = command_info.name or get_command_name(command_info.callback.__name__)
    use_help = command_info.help
    if use_help is None:
        use_help = inspect.getdoc(command_info.callback)
    else:
        use_help = inspect.cleandoc(use_help)
    (
        params,
        convertors,
        context_param_name,
    ) = get_params_convertors_ctx_param_name_from_function(command_info.callback)
    cls = command_info.cls or TyperCommand
    command = cls(
        name=name,
        context_settings=command_info.context_settings,
        callback=get_callback(
            callback=command_info.callback,
            params=params,
            convertors=convertors,
            context_param_name=context_param_name,
            pretty_exceptions_short=pretty_exceptions_short,
        ),
        params=params,  # type: ignore
        help=use_help,
        epilog=command_info.epilog,
        short_help=command_info.short_help,
        options_metavar=command_info.options_metavar,
        add_help_option=command_info.add_help_option,
        no_args_is_help=command_info.no_args_is_help,
        hidden=command_info.hidden,
        deprecated=command_info.deprecated,
        rich_markup_mode=rich_markup_mode,
        # Rich settings
        rich_help_panel=command_info.rich_help_panel,
    )
    return command


def determine_type_convertor(type_: Any) -> Optional[Callable[[Any], Any]]:
    convertor: Optional[Callable[[Any], Any]] = None
    if lenient_issubclass(type_, Path):
        convertor = param_path_convertor
    if lenient_issubclass(type_, Enum):
        convertor = generate_enum_convertor(type_)
    return convertor


def param_path_convertor(value: Optional[str] = None) -> Optional[Path]:
    if value is not None:
        return Path(value)
    return None


def generate_enum_convertor(enum: Type[Enum]) -> Callable[[Any], Any]:
    val_map = {str(val.value): val for val in enum}

    def convertor(value: Any) -> Any:
        if value is not None:
            val = str(value)
            if val in val_map:
                key = val_map[val]
                return enum(key)

    return convertor


def generate_list_convertor(
    convertor: Optional[Callable[[Any], Any]], default_value: Optional[Any]
) -> Callable[[Sequence[Any]], Optional[List[Any]]]:
    def internal_convertor(value: Sequence[Any]) -> Optional[List[Any]]:
        if default_value is None and len(value) == 0:
            return None
        return [convertor(v) if convertor else v for v in value]

    return internal_convertor


def generate_tuple_convertor(
    types: Sequence[Any],
) -> Callable[[Optional[Tuple[Any, ...]]], Optional[Tuple[Any, ...]]]:
    convertors = [determine_type_convertor(type_) for type_ in types]

    def internal_convertor(
        param_args: Optional[Tuple[Any, ...]],
    ) -> Optional[Tuple[Any, ...]]:
        if param_args is None:
            return None
        return tuple(
            convertor(arg) if convertor else arg
            for (convertor, arg) in zip(convertors, param_args)
        )

    return internal_convertor


def get_callback(
    *,
    callback: Optional[Callable[..., Any]] = None,
    params: Sequence[click.Parameter] = [],
    convertors: Optional[Dict[str, Callable[[str], Any]]] = None,
    context_param_name: Optional[str] = None,
    pretty_exceptions_short: bool,
) -> Optional[Callable[..., Any]]:
    use_convertors = convertors or {}
    if not callback:
        return None
    parameters = get_params_from_function(callback)
    use_params: Dict[str, Any] = {}
    for param_name in parameters:
        use_params[param_name] = None
    for param in params:
        if param.name:
            use_params[param.name] = param.default

    def wrapper(**kwargs: Any) -> Any:
        _rich_traceback_guard = pretty_exceptions_short  # noqa: F841
        for k, v in kwargs.items():
            if k in use_convertors:
                use_params[k] = use_convertors[k](v)
            else:
                use_params[k] = v
        if context_param_name:
            use_params[context_param_name] = click.get_current_context()
        return callback(**use_params)

    update_wrapper(wrapper, callback)
    return wrapper


def get_click_type(
    *, annotation: Any, parameter_info: ParameterInfo
) -> click.ParamType:
    if parameter_info.click_type is not None:
        return parameter_info.click_type

    elif parameter_info.parser is not None:
        return click.types.FuncParamType(parameter_info.parser)

    elif annotation is str:
        return click.STRING
    elif annotation is int:
        if parameter_info.min is not None or parameter_info.max is not None:
            min_ = None
            max_ = None
            if parameter_info.min is not None:
                min_ = int(parameter_info.min)
            if parameter_info.max is not None:
                max_ = int(parameter_info.max)
            return click.IntRange(min=min_, max=max_, clamp=parameter_info.clamp)
        else:
            return click.INT
    elif annotation is float:
        if parameter_info.min is not None or parameter_info.max is not None:
            return click.FloatRange(
                min=parameter_info.min,
                max=parameter_info.max,
                clamp=parameter_info.clamp,
            )
        else:
            return click.FLOAT
    elif annotation is bool:
        return click.BOOL
    elif annotation == UUID:
        return click.UUID
    elif annotation == datetime:
        return click.DateTime(formats=parameter_info.formats)
    elif (
        annotation == Path
        or parameter_info.allow_dash
        or parameter_info.path_type
        or parameter_info.resolve_path
    ):
        return TyperPath(
            exists=parameter_info.exists,
            file_okay=parameter_info.file_okay,
            dir_okay=parameter_info.dir_okay,
            writable=parameter_info.writable,
            readable=parameter_info.readable,
            resolve_path=parameter_info.resolve_path,
            allow_dash=parameter_info.allow_dash,
            path_type=parameter_info.path_type,
        )
    elif lenient_issubclass(annotation, FileTextWrite):
        return click.File(
            mode=parameter_info.mode or "w",
            encoding=parameter_info.encoding,
            errors=parameter_info.errors,
            lazy=parameter_info.lazy,
            atomic=parameter_info.atomic,
        )
    elif lenient_issubclass(annotation, FileText):
        return click.File(
            mode=parameter_info.mode or "r",
            encoding=parameter_info.encoding,
            errors=parameter_info.errors,
            lazy=parameter_info.lazy,
            atomic=parameter_info.atomic,
        )
    elif lenient_issubclass(annotation, FileBinaryRead):
        return click.File(
            mode=parameter_info.mode or "rb",
            encoding=parameter_info.encoding,
            errors=parameter_info.errors,
            lazy=parameter_info.lazy,
            atomic=parameter_info.atomic,
        )
    elif lenient_issubclass(annotation, FileBinaryWrite):
        return click.File(
            mode=parameter_info.mode or "wb",
            encoding=parameter_info.encoding,
            errors=parameter_info.errors,
            lazy=parameter_info.lazy,
            atomic=parameter_info.atomic,
        )
    elif lenient_issubclass(annotation, Enum):
        # The custom TyperChoice is only needed for Click < 8.2.0, to parse the
        # command line values matching them to the enum values. Click 8.2.0 added
        # support for enum values but reading enum names.
        # Passing here the list of enum values (instead of just the enum) accounts for
        # Click < 8.2.0.
        return TyperChoice(
            [item.value for item in annotation],
            case_sensitive=parameter_info.case_sensitive,
        )
    raise RuntimeError(f"Type not yet supported: {annotation}")  # pragma: no cover


def lenient_issubclass(
    cls: Any, class_or_tuple: Union[AnyType, Tuple[AnyType, ...]]
) -> bool:
    return isinstance(cls, type) and issubclass(cls, class_or_tuple)


def get_click_param(
    param: ParamMeta,
) -> Tuple[Union[click.Argument, click.Option], Any]:
    # First, find out what will be:
    # * ParamInfo (ArgumentInfo or OptionInfo)
    # * default_value
    # * required
    default_value = None
    required = False
    if isinstance(param.default, ParameterInfo):
        parameter_info = param.default
        if parameter_info.default == Required:
            required = True
        else:
            default_value = parameter_info.default
    elif param.default == Required or param.default is param.empty:
        required = True
        parameter_info = ArgumentInfo()
    else:
        default_value = param.default
        parameter_info = OptionInfo()
    annotation: Any
    if param.annotation is not param.empty:
        annotation = param.annotation
    else:
        annotation = str
    main_type = annotation
    is_list = False
    is_tuple = False
    parameter_type: Any = None
    is_flag = None
    origin = get_origin(main_type)

    if origin is not None:
        # Handle SomeType | None and Optional[SomeType]
        if is_union(origin):
            types = []
            for type_ in get_args(main_type):
                if type_ is NoneType:
                    continue
                types.append(type_)
            assert len(types) == 1, "Typer Currently doesn't support Union types"
            main_type = types[0]
            origin = get_origin(main_type)
        # Handle Tuples and Lists
        if lenient_issubclass(origin, List):
            main_type = get_args(main_type)[0]
            assert not get_origin(main_type), (
                "List types with complex sub-types are not currently supported"
            )
            is_list = True
        elif lenient_issubclass(origin, Tuple):  # type: ignore
            types = []
            for type_ in get_args(main_type):
                assert not get_origin(type_), (
                    "Tuple types with complex sub-types are not currently supported"
                )
                types.append(
                    get_click_type(annotation=type_, parameter_info=parameter_info)
                )
            parameter_type = tuple(types)
            is_tuple = True
    if parameter_type is None:
        parameter_type = get_click_type(
            annotation=main_type, parameter_info=parameter_info
        )
    convertor = determine_type_convertor(main_type)
    if is_list:
        convertor = generate_list_convertor(
            convertor=convertor, default_value=default_value
        )
    if is_tuple:
        convertor = generate_tuple_convertor(get_args(main_type))
    if isinstance(parameter_info, OptionInfo):
        if main_type is bool:
            is_flag = True
            # Click doesn't accept a flag of type bool, only None, and then it sets it
            # to bool internally
            parameter_type = None
        default_option_name = get_command_name(param.name)
        if is_flag:
            default_option_declaration = (
                f"--{default_option_name}/--no-{default_option_name}"
            )
        else:
            default_option_declaration = f"--{default_option_name}"
        param_decls = [param.name]
        if parameter_info.param_decls:
            param_decls.extend(parameter_info.param_decls)
        else:
            param_decls.append(default_option_declaration)
        return (
            TyperOption(
                # Option
                param_decls=param_decls,
                show_default=parameter_info.show_default,
                prompt=parameter_info.prompt,
                confirmation_prompt=parameter_info.confirmation_prompt,
                prompt_required=parameter_info.prompt_required,
                hide_input=parameter_info.hide_input,
                is_flag=is_flag,
                multiple=is_list,
                count=parameter_info.count,
                allow_from_autoenv=parameter_info.allow_from_autoenv,
                type=parameter_type,
                help=parameter_info.help,
                hidden=parameter_info.hidden,
                show_choices=parameter_info.show_choices,
                show_envvar=parameter_info.show_envvar,
                # Parameter
                required=required,
                default=default_value,
                callback=get_param_callback(
                    callback=parameter_info.callback, convertor=convertor
                ),
                metavar=parameter_info.metavar,
                expose_value=parameter_info.expose_value,
                is_eager=parameter_info.is_eager,
                envvar=parameter_info.envvar,
                shell_complete=parameter_info.shell_complete,
                autocompletion=get_param_completion(parameter_info.autocompletion),
                # Rich settings
                rich_help_panel=parameter_info.rich_help_panel,
            ),
            convertor,
        )
    elif isinstance(parameter_info, ArgumentInfo):
        param_decls = [param.name]
        nargs = None
        if is_list:
            nargs = -1
        return (
            TyperArgument(
                # Argument
                param_decls=param_decls,
                type=parameter_type,
                required=required,
                nargs=nargs,
                # TyperArgument
                show_default=parameter_info.show_default,
                show_choices=parameter_info.show_choices,
                show_envvar=parameter_info.show_envvar,
                help=parameter_info.help,
                hidden=parameter_info.hidden,
                # Parameter
                default=default_value,
                callback=get_param_callback(
                    callback=parameter_info.callback, convertor=convertor
                ),
                metavar=parameter_info.metavar,
                expose_value=parameter_info.expose_value,
                is_eager=parameter_info.is_eager,
                envvar=parameter_info.envvar,
                shell_complete=parameter_info.shell_complete,
                autocompletion=get_param_completion(parameter_info.autocompletion),
                # Rich settings
                rich_help_panel=parameter_info.rich_help_panel,
            ),
            convertor,
        )
    raise AssertionError("A click.Parameter should be returned")  # pragma: no cover


def get_param_callback(
    *,
    callback: Optional[Callable[..., Any]] = None,
    convertor: Optional[Callable[..., Any]] = None,
) -> Optional[Callable[..., Any]]:
    if not callback:
        return None
    parameters = get_params_from_function(callback)
    ctx_name = None
    click_param_name = None
    value_name = None
    untyped_names: List[str] = []
    for param_name, param_sig in parameters.items():
        if lenient_issubclass(param_sig.annotation, click.Context):
            ctx_name = param_name
        elif lenient_issubclass(param_sig.annotation, click.Parameter):
            click_param_name = param_name
        else:
            untyped_names.append(param_name)
    # Extract value param name first
    if untyped_names:
        value_name = untyped_names.pop()
    # If context and Click param were not typed (old/Click callback style) extract them
    if untyped_names:
        if ctx_name is None:
            ctx_name = untyped_names.pop(0)
        if click_param_name is None:
            if untyped_names:
                click_param_name = untyped_names.pop(0)
        if untyped_names:
            raise click.ClickException(
                "Too many CLI parameter callback function parameters"
            )

    def wrapper(ctx: click.Context, param: click.Parameter, value: Any) -> Any:
        use_params: Dict[str, Any] = {}
        if ctx_name:
            use_params[ctx_name] = ctx
        if click_param_name:
            use_params[click_param_name] = param
        if value_name:
            if convertor:
                use_value = convertor(value)
            else:
                use_value = value
            use_params[value_name] = use_value
        return callback(**use_params)

    update_wrapper(wrapper, callback)
    return wrapper


def get_param_completion(
    callback: Optional[Callable[..., Any]] = None,
) -> Optional[Callable[..., Any]]:
    if not callback:
        return None
    parameters = get_params_from_function(callback)
    ctx_name = None
    args_name = None
    incomplete_name = None
    unassigned_params = list(parameters.values())
    for param_sig in unassigned_params[:]:
        origin = get_origin(param_sig.annotation)
        if lenient_issubclass(param_sig.annotation, click.Context):
            ctx_name = param_sig.name
            unassigned_params.remove(param_sig)
        elif lenient_issubclass(origin, List):
            args_name = param_sig.name
            unassigned_params.remove(param_sig)
        elif lenient_issubclass(param_sig.annotation, str):
            incomplete_name = param_sig.name
            unassigned_params.remove(param_sig)
    # If there are still unassigned parameters (not typed), extract by name
    for param_sig in unassigned_params[:]:
        if ctx_name is None and param_sig.name == "ctx":
            ctx_name = param_sig.name
            unassigned_params.remove(param_sig)
        elif args_name is None and param_sig.name == "args":
            args_name = param_sig.name
            unassigned_params.remove(param_sig)
        elif incomplete_name is None and param_sig.name == "incomplete":
            incomplete_name = param_sig.name
            unassigned_params.remove(param_sig)
    # Extract value param name first
    if unassigned_params:
        show_params = " ".join([param.name for param in unassigned_params])
        raise click.ClickException(
            f"Invalid autocompletion callback parameters: {show_params}"
        )

    def wrapper(ctx: click.Context, args: List[str], incomplete: Optional[str]) -> Any:
        use_params: Dict[str, Any] = {}
        if ctx_name:
            use_params[ctx_name] = ctx
        if args_name:
            use_params[args_name] = args
        if incomplete_name:
            use_params[incomplete_name] = incomplete
        return callback(**use_params)

    update_wrapper(wrapper, callback)
    return wrapper


def run(function: Callable[..., Any]) -> None:
    app = Typer(add_completion=False)
    app.command()(function)
    app()


def _is_macos() -> bool:
    return platform.system() == "Darwin"


def _is_linux_or_bsd() -> bool:
    if platform.system() == "Linux":
        return True

    return "BSD" in platform.system()


def launch(url: str, wait: bool = False, locate: bool = False) -> int:
    """This function launches the given URL (or filename) in the default
    viewer application for this file type.  If this is an executable, it
    might launch the executable in a new session.  The return value is
    the exit code of the launched application.  Usually, ``0`` indicates
    success.

    This function handles url in different operating systems separately:
    - On macOS (Darwin), it uses the 'open' command.
    - On Linux and BSD, it uses 'xdg-open' if available.
    - On Windows (and other OSes), it uses the standard webbrowser module.

    The function avoids, when possible, using the webbrowser module on Linux and macOS
    to prevent spammy terminal messages from some browsers (e.g., Chrome).

    Examples::

        typer.launch("https://typer.tiangolo.com/")
        typer.launch("/my/downloaded/file", locate=True)

    :param url: URL or filename of the thing to launch.
    :param wait: Wait for the program to exit before returning. This
        only works if the launched program blocks. In particular,
        ``xdg-open`` on Linux does not block.
    :param locate: if this is set to `True` then instead of launching the
                   application associated with the URL it will attempt to
                   launch a file manager with the file located.  This
                   might have weird effects if the URL does not point to
                   the filesystem.
    """

    if url.startswith("http://") or url.startswith("https://"):
        if _is_macos():
            return subprocess.Popen(
                ["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT
            ).wait()

        has_xdg_open = _is_linux_or_bsd() and shutil.which("xdg-open") is not None

        if has_xdg_open:
            return subprocess.Popen(
                ["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT
            ).wait()

        import webbrowser

        webbrowser.open(url)

        return 0

    else:
        return click.launch(url)

import configparser
import dataclasses
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from typing import ClassVar
from typing import Optional
from typing import Union

from .helpers import make_path


class ConfigError(BaseException):
    pass


class MissingConfig(ConfigError):
    pass


class MissingConfigSection(ConfigError):
    pass


class MissingConfigItem(ConfigError):
    pass


class ConfigValueTypeError(ConfigError):
    pass


class _GetterDispatch:
    def __init__(self, initialdata, default_getter: Callable):
        self.default_getter = default_getter
        self.data = initialdata

    def get_fn_for_type(self, type_):
        return self.data.get(type_, self.default_getter)

    def get_typed_value(self, type_, name):
        get_fn = self.get_fn_for_type(type_)
        return get_fn(name)


def _parse_cfg_file(filespec: Union[Path, str]):
    cfg = configparser.ConfigParser()
    try:
        filepath = make_path(filespec, check_exists=True)
    except FileNotFoundError as e:
        raise MissingConfig(f"No config file found at {filespec}") from e
    else:
        with open(filepath, encoding="utf-8") as f:
            cfg.read_file(f)
        return cfg


def _build_getter(cfg_obj, cfg_section, method, converter=None):
    def caller(option, **kwargs):
        try:
            rv = getattr(cfg_obj, method)(cfg_section, option, **kwargs)
        except configparser.NoSectionError as nse:
            raise MissingConfigSection(
                f"No config section named {cfg_section}"
            ) from nse
        except configparser.NoOptionError as noe:
            raise MissingConfigItem(f"No config item for {option}") from noe
        except ValueError as ve:
            # ConfigParser.getboolean, .getint, .getfloat raise ValueError
            # on bad types
            raise ConfigValueTypeError(
                f"Wrong value type for {option}"
            ) from ve
        else:
            if converter:
                try:
                    rv = converter(rv)
                except Exception as e:
                    raise ConfigValueTypeError(
                        f"Wrong value type for {option}"
                    ) from e
            return rv

    return caller


def _build_getter_dispatch(cfg_obj, cfg_section, converters=None):
    converters = converters or {}

    default_getter = _build_getter(cfg_obj, cfg_section, "get")

    # support ConfigParser builtins
    getters = {
        int: _build_getter(cfg_obj, cfg_section, "getint"),
        bool: _build_getter(cfg_obj, cfg_section, "getboolean"),
        float: _build_getter(cfg_obj, cfg_section, "getfloat"),
        str: default_getter,
    }

    # use ConfigParser.get and convert value
    getters.update(
        {
            type_: _build_getter(
                cfg_obj, cfg_section, "get", converter=converter_fn
            )
            for type_, converter_fn in converters.items()
        }
    )

    return _GetterDispatch(getters, default_getter)


@dataclass
class ReadsCfg:
    section_header: ClassVar[str]
    converters: ClassVar[Optional[dict]] = None

    @classmethod
    def from_cfg_file(cls, filespec: Union[Path, str]):
        cfg = _parse_cfg_file(filespec)
        dispatch = _build_getter_dispatch(
            cfg, cls.section_header, converters=cls.converters
        )
        kwargs = {
            field.name: dispatch.get_typed_value(field.type, field.name)
            for field in dataclasses.fields(cls)
        }
        return cls(**kwargs)

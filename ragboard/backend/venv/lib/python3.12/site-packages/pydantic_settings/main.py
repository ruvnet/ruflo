from __future__ import annotations as _annotations

from pathlib import Path
from typing import Any, ClassVar

from pydantic import ConfigDict
from pydantic._internal._config import config_keys
from pydantic._internal._utils import deep_update
from pydantic.main import BaseModel

from .sources import (
    ENV_FILE_SENTINEL,
    DotEnvSettingsSource,
    DotenvType,
    EnvSettingsSource,
    InitSettingsSource,
    PydanticBaseSettingsSource,
    SecretsSettingsSource,
)


class SettingsConfigDict(ConfigDict, total=False):
    case_sensitive: bool
    env_prefix: str
    env_file: DotenvType | None
    env_file_encoding: str | None
    env_nested_delimiter: str | None
    secrets_dir: str | Path | None


# Extend `config_keys` by pydantic settings config keys to
# support setting config through class kwargs.
# Pydantic uses `config_keys` in `pydantic._internal._config.ConfigWrapper.for_model`
# to extract config keys from model kwargs, So, by adding pydantic settings keys to
# `config_keys`, they will be considered as valid config keys and will be collected
# by Pydantic.
config_keys |= set(SettingsConfigDict.__annotations__.keys())


class BaseSettings(BaseModel):
    """
    Base class for settings, allowing values to be overridden by environment variables.

    This is useful in production for secrets you do not wish to save in code, it plays nicely with docker(-compose),
    Heroku and any 12 factor app design.

    All the below attributes can be set via `model_config`.

    Args:
        _case_sensitive: Whether environment variables names should be read with case-sensitivity. Defaults to `None`.
        _env_prefix: Prefix for all environment variables. Defaults to `None`.
        _env_file: The env file(s) to load settings values from. Defaults to `Path('')`, which
            means that the value from `model_config['env_file']` should be used. You can also pass
            `None` to indicate that environment variables should not be loaded from an env file.
        _env_file_encoding: The env file encoding, e.g. `'latin-1'`. Defaults to `None`.
        _env_nested_delimiter: The nested env values delimiter. Defaults to `None`.
        _secrets_dir: The secret files directory. Defaults to `None`.
    """

    def __init__(
        __pydantic_self__,
        _case_sensitive: bool | None = None,
        _env_prefix: str | None = None,
        _env_file: DotenvType | None = ENV_FILE_SENTINEL,
        _env_file_encoding: str | None = None,
        _env_nested_delimiter: str | None = None,
        _secrets_dir: str | Path | None = None,
        **values: Any,
    ) -> None:
        # Uses something other than `self` the first arg to allow "self" as a settable attribute
        super().__init__(
            **__pydantic_self__._settings_build_values(
                values,
                _case_sensitive=_case_sensitive,
                _env_prefix=_env_prefix,
                _env_file=_env_file,
                _env_file_encoding=_env_file_encoding,
                _env_nested_delimiter=_env_nested_delimiter,
                _secrets_dir=_secrets_dir,
            )
        )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """
        Define the sources and their order for loading the settings values.

        Args:
            settings_cls: The Settings class.
            init_settings: The `InitSettingsSource` instance.
            env_settings: The `EnvSettingsSource` instance.
            dotenv_settings: The `DotEnvSettingsSource` instance.
            file_secret_settings: The `SecretsSettingsSource` instance.

        Returns:
            A tuple containing the sources and their order for loading the settings values.
        """
        return init_settings, env_settings, dotenv_settings, file_secret_settings

    def _settings_build_values(
        self,
        init_kwargs: dict[str, Any],
        _case_sensitive: bool | None = None,
        _env_prefix: str | None = None,
        _env_file: DotenvType | None = None,
        _env_file_encoding: str | None = None,
        _env_nested_delimiter: str | None = None,
        _secrets_dir: str | Path | None = None,
    ) -> dict[str, Any]:
        # Determine settings config values
        case_sensitive = _case_sensitive if _case_sensitive is not None else self.model_config.get('case_sensitive')
        env_prefix = _env_prefix if _env_prefix is not None else self.model_config.get('env_prefix')
        env_file = _env_file if _env_file != ENV_FILE_SENTINEL else self.model_config.get('env_file')
        env_file_encoding = (
            _env_file_encoding if _env_file_encoding is not None else self.model_config.get('env_file_encoding')
        )
        env_nested_delimiter = (
            _env_nested_delimiter
            if _env_nested_delimiter is not None
            else self.model_config.get('env_nested_delimiter')
        )
        secrets_dir = _secrets_dir if _secrets_dir is not None else self.model_config.get('secrets_dir')

        # Configure built-in sources
        init_settings = InitSettingsSource(self.__class__, init_kwargs=init_kwargs)
        env_settings = EnvSettingsSource(
            self.__class__,
            case_sensitive=case_sensitive,
            env_prefix=env_prefix,
            env_nested_delimiter=env_nested_delimiter,
        )
        dotenv_settings = DotEnvSettingsSource(
            self.__class__,
            env_file=env_file,
            env_file_encoding=env_file_encoding,
            case_sensitive=case_sensitive,
            env_prefix=env_prefix,
            env_nested_delimiter=env_nested_delimiter,
        )

        file_secret_settings = SecretsSettingsSource(
            self.__class__, secrets_dir=secrets_dir, case_sensitive=case_sensitive, env_prefix=env_prefix
        )
        # Provide a hook to set built-in sources priority and add / remove sources
        sources = self.settings_customise_sources(
            self.__class__,
            init_settings=init_settings,
            env_settings=env_settings,
            dotenv_settings=dotenv_settings,
            file_secret_settings=file_secret_settings,
        )
        if sources:
            return deep_update(*reversed([source() for source in sources]))
        else:
            # no one should mean to do this, but I think returning an empty dict is marginally preferable
            # to an informative error and much better than a confusing error
            return {}

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        extra='forbid',
        arbitrary_types_allowed=True,
        validate_default=True,
        case_sensitive=False,
        env_prefix='',
        env_file=None,
        env_file_encoding=None,
        env_nested_delimiter=None,
        secrets_dir=None,
        protected_namespaces=('model_', 'settings_'),
    )

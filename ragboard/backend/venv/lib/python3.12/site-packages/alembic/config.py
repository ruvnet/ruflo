from __future__ import annotations

from argparse import ArgumentParser
from argparse import Namespace
from configparser import ConfigParser
import inspect
import os
import sys
from typing import Any
from typing import cast
from typing import Dict
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import TextIO
from typing import Union

from typing_extensions import TypedDict

from . import __version__
from . import command
from . import util
from .util import compat


class Config:
    r"""Represent an Alembic configuration.

    Within an ``env.py`` script, this is available
    via the :attr:`.EnvironmentContext.config` attribute,
    which in turn is available at ``alembic.context``::

        from alembic import context

        some_param = context.config.get_main_option("my option")

    When invoking Alembic programmatically, a new
    :class:`.Config` can be created by passing
    the name of an .ini file to the constructor::

        from alembic.config import Config
        alembic_cfg = Config("/path/to/yourapp/alembic.ini")

    With a :class:`.Config` object, you can then
    run Alembic commands programmatically using the directives
    in :mod:`alembic.command`.

    The :class:`.Config` object can also be constructed without
    a filename.   Values can be set programmatically, and
    new sections will be created as needed::

        from alembic.config import Config
        alembic_cfg = Config()
        alembic_cfg.set_main_option("script_location", "myapp:migrations")
        alembic_cfg.set_main_option("sqlalchemy.url", "postgresql://foo/bar")
        alembic_cfg.set_section_option("mysection", "foo", "bar")

    .. warning::

       When using programmatic configuration, make sure the
       ``env.py`` file in use is compatible with the target configuration;
       including that the call to Python ``logging.fileConfig()`` is
       omitted if the programmatic configuration doesn't actually include
       logging directives.

    For passing non-string values to environments, such as connections and
    engines, use the :attr:`.Config.attributes` dictionary::

        with engine.begin() as connection:
            alembic_cfg.attributes['connection'] = connection
            command.upgrade(alembic_cfg, "head")

    :param file\_: name of the .ini file to open.
    :param ini_section: name of the main Alembic section within the
     .ini file
    :param output_buffer: optional file-like input buffer which
     will be passed to the :class:`.MigrationContext` - used to redirect
     the output of "offline generation" when using Alembic programmatically.
    :param stdout: buffer where the "print" output of commands will be sent.
     Defaults to ``sys.stdout``.

    :param config_args: A dictionary of keys and values that will be used
     for substitution in the alembic config file.  The dictionary as given
     is **copied** to a new one, stored locally as the attribute
     ``.config_args``. When the :attr:`.Config.file_config` attribute is
     first invoked, the replacement variable ``here`` will be added to this
     dictionary before the dictionary is passed to ``ConfigParser()``
     to parse the .ini file.

    :param attributes: optional dictionary of arbitrary Python keys/values,
     which will be populated into the :attr:`.Config.attributes` dictionary.

     .. seealso::

        :ref:`connection_sharing`

    """

    def __init__(
        self,
        file_: Union[str, os.PathLike[str], None] = None,
        ini_section: str = "alembic",
        output_buffer: Optional[TextIO] = None,
        stdout: TextIO = sys.stdout,
        cmd_opts: Optional[Namespace] = None,
        config_args: Mapping[str, Any] = util.immutabledict(),
        attributes: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Construct a new :class:`.Config`"""
        self.config_file_name = file_
        self.config_ini_section = ini_section
        self.output_buffer = output_buffer
        self.stdout = stdout
        self.cmd_opts = cmd_opts
        self.config_args = dict(config_args)
        if attributes:
            self.attributes.update(attributes)

    cmd_opts: Optional[Namespace] = None
    """The command-line options passed to the ``alembic`` script.

    Within an ``env.py`` script this can be accessed via the
    :attr:`.EnvironmentContext.config` attribute.

    .. seealso::

        :meth:`.EnvironmentContext.get_x_argument`

    """

    config_file_name: Union[str, os.PathLike[str], None] = None
    """Filesystem path to the .ini file in use."""

    config_ini_section: str = None  # type:ignore[assignment]
    """Name of the config file section to read basic configuration
    from.  Defaults to ``alembic``, that is the ``[alembic]`` section
    of the .ini file.  This value is modified using the ``-n/--name``
    option to the Alembic runner.

    """

    @util.memoized_property
    def attributes(self) -> Dict[str, Any]:
        """A Python dictionary for storage of additional state.


        This is a utility dictionary which can include not just strings but
        engines, connections, schema objects, or anything else.
        Use this to pass objects into an env.py script, such as passing
        a :class:`sqlalchemy.engine.base.Connection` when calling
        commands from :mod:`alembic.command` programmatically.

        .. seealso::

            :ref:`connection_sharing`

            :paramref:`.Config.attributes`

        """
        return {}

    def print_stdout(self, text: str, *arg: Any) -> None:
        """Render a message to standard out.

        When :meth:`.Config.print_stdout` is called with additional args
        those arguments will formatted against the provided text,
        otherwise we simply output the provided text verbatim.

        This is a no-op when the``quiet`` messaging option is enabled.

        e.g.::

            >>> config.print_stdout('Some text %s', 'arg')
            Some Text arg

        """

        if arg:
            output = str(text) % arg
        else:
            output = str(text)

        util.write_outstream(self.stdout, output, "\n", **self.messaging_opts)

    @util.memoized_property
    def file_config(self) -> ConfigParser:
        """Return the underlying ``ConfigParser`` object.

        Direct access to the .ini file is available here,
        though the :meth:`.Config.get_section` and
        :meth:`.Config.get_main_option`
        methods provide a possibly simpler interface.

        """

        if self.config_file_name:
            here = os.path.abspath(os.path.dirname(self.config_file_name))
        else:
            here = ""
        self.config_args["here"] = here
        file_config = ConfigParser(self.config_args)
        if self.config_file_name:
            compat.read_config_parser(file_config, [self.config_file_name])
        else:
            file_config.add_section(self.config_ini_section)
        return file_config

    def get_template_directory(self) -> str:
        """Return the directory where Alembic setup templates are found.

        This method is used by the alembic ``init`` and ``list_templates``
        commands.

        """
        import alembic

        package_dir = os.path.abspath(os.path.dirname(alembic.__file__))
        return os.path.join(package_dir, "templates")

    @overload
    def get_section(
        self, name: str, default: None = ...
    ) -> Optional[Dict[str, str]]:
        ...

    # "default" here could also be a TypeVar
    # _MT = TypeVar("_MT", bound=Mapping[str, str]),
    # however mypy wasn't handling that correctly (pyright was)
    @overload
    def get_section(
        self, name: str, default: Dict[str, str]
    ) -> Dict[str, str]:
        ...

    @overload
    def get_section(
        self, name: str, default: Mapping[str, str]
    ) -> Union[Dict[str, str], Mapping[str, str]]:
        ...

    def get_section(
        self, name: str, default: Optional[Mapping[str, str]] = None
    ) -> Optional[Mapping[str, str]]:
        """Return all the configuration options from a given .ini file section
        as a dictionary.

        If the given section does not exist, the value of ``default``
        is returned, which is expected to be a dictionary or other mapping.

        """
        if not self.file_config.has_section(name):
            return default

        return dict(self.file_config.items(name))

    def set_main_option(self, name: str, value: str) -> None:
        """Set an option programmatically within the 'main' section.

        This overrides whatever was in the .ini file.

        :param name: name of the value

        :param value: the value.  Note that this value is passed to
         ``ConfigParser.set``, which supports variable interpolation using
         pyformat (e.g. ``%(some_value)s``).   A raw percent sign not part of
         an interpolation symbol must therefore be escaped, e.g. ``%%``.
         The given value may refer to another value already in the file
         using the interpolation format.

        """
        self.set_section_option(self.config_ini_section, name, value)

    def remove_main_option(self, name: str) -> None:
        self.file_config.remove_option(self.config_ini_section, name)

    def set_section_option(self, section: str, name: str, value: str) -> None:
        """Set an option programmatically within the given section.

        The section is created if it doesn't exist already.
        The value here will override whatever was in the .ini
        file.

        :param section: name of the section

        :param name: name of the value

        :param value: the value.  Note that this value is passed to
         ``ConfigParser.set``, which supports variable interpolation using
         pyformat (e.g. ``%(some_value)s``).   A raw percent sign not part of
         an interpolation symbol must therefore be escaped, e.g. ``%%``.
         The given value may refer to another value already in the file
         using the interpolation format.

        """

        if not self.file_config.has_section(section):
            self.file_config.add_section(section)
        self.file_config.set(section, name, value)

    def get_section_option(
        self, section: str, name: str, default: Optional[str] = None
    ) -> Optional[str]:
        """Return an option from the given section of the .ini file."""
        if not self.file_config.has_section(section):
            raise util.CommandError(
                "No config file %r found, or file has no "
                "'[%s]' section" % (self.config_file_name, section)
            )
        if self.file_config.has_option(section, name):
            return self.file_config.get(section, name)
        else:
            return default

    @overload
    def get_main_option(self, name: str, default: str) -> str:
        ...

    @overload
    def get_main_option(
        self, name: str, default: Optional[str] = None
    ) -> Optional[str]:
        ...

    def get_main_option(
        self, name: str, default: Optional[str] = None
    ) -> Optional[str]:
        """Return an option from the 'main' section of the .ini file.

        This defaults to being a key from the ``[alembic]``
        section, unless the ``-n/--name`` flag were used to
        indicate a different section.

        """
        return self.get_section_option(self.config_ini_section, name, default)

    @util.memoized_property
    def messaging_opts(self) -> MessagingOptions:
        """The messaging options."""
        return cast(
            MessagingOptions,
            util.immutabledict(
                {"quiet": getattr(self.cmd_opts, "quiet", False)}
            ),
        )


class MessagingOptions(TypedDict, total=False):
    quiet: bool


class CommandLine:
    def __init__(self, prog: Optional[str] = None) -> None:
        self._generate_args(prog)

    def _generate_args(self, prog: Optional[str]) -> None:
        def add_options(
            fn: Any, parser: Any, positional: Any, kwargs: Any
        ) -> None:
            kwargs_opts = {
                "template": (
                    "-t",
                    "--template",
                    dict(
                        default="generic",
                        type=str,
                        help="Setup template for use with 'init'",
                    ),
                ),
                "message": (
                    "-m",
                    "--message",
                    dict(
                        type=str, help="Message string to use with 'revision'"
                    ),
                ),
                "sql": (
                    "--sql",
                    dict(
                        action="store_true",
                        help="Don't emit SQL to database - dump to "
                        "standard output/file instead. See docs on "
                        "offline mode.",
                    ),
                ),
                "tag": (
                    "--tag",
                    dict(
                        type=str,
                        help="Arbitrary 'tag' name - can be used by "
                        "custom env.py scripts.",
                    ),
                ),
                "head": (
                    "--head",
                    dict(
                        type=str,
                        help="Specify head revision or <branchname>@head "
                        "to base new revision on.",
                    ),
                ),
                "splice": (
                    "--splice",
                    dict(
                        action="store_true",
                        help="Allow a non-head revision as the "
                        "'head' to splice onto",
                    ),
                ),
                "depends_on": (
                    "--depends-on",
                    dict(
                        action="append",
                        help="Specify one or more revision identifiers "
                        "which this revision should depend on.",
                    ),
                ),
                "rev_id": (
                    "--rev-id",
                    dict(
                        type=str,
                        help="Specify a hardcoded revision id instead of "
                        "generating one",
                    ),
                ),
                "version_path": (
                    "--version-path",
                    dict(
                        type=str,
                        help="Specify specific path from config for "
                        "version file",
                    ),
                ),
                "branch_label": (
                    "--branch-label",
                    dict(
                        type=str,
                        help="Specify a branch label to apply to the "
                        "new revision",
                    ),
                ),
                "verbose": (
                    "-v",
                    "--verbose",
                    dict(action="store_true", help="Use more verbose output"),
                ),
                "resolve_dependencies": (
                    "--resolve-dependencies",
                    dict(
                        action="store_true",
                        help="Treat dependency versions as down revisions",
                    ),
                ),
                "autogenerate": (
                    "--autogenerate",
                    dict(
                        action="store_true",
                        help="Populate revision script with candidate "
                        "migration operations, based on comparison "
                        "of database to model.",
                    ),
                ),
                "rev_range": (
                    "-r",
                    "--rev-range",
                    dict(
                        action="store",
                        help="Specify a revision range; "
                        "format is [start]:[end]",
                    ),
                ),
                "indicate_current": (
                    "-i",
                    "--indicate-current",
                    dict(
                        action="store_true",
                        help="Indicate the current revision",
                    ),
                ),
                "purge": (
                    "--purge",
                    dict(
                        action="store_true",
                        help="Unconditionally erase the version table "
                        "before stamping",
                    ),
                ),
                "package": (
                    "--package",
                    dict(
                        action="store_true",
                        help="Write empty __init__.py files to the "
                        "environment and version locations",
                    ),
                ),
            }
            positional_help = {
                "directory": "location of scripts directory",
                "revision": "revision identifier",
                "revisions": "one or more revisions, or 'heads' for all heads",
            }
            for arg in kwargs:
                if arg in kwargs_opts:
                    args = kwargs_opts[arg]
                    args, kw = args[0:-1], args[-1]
                    parser.add_argument(*args, **kw)

            for arg in positional:
                if (
                    arg == "revisions"
                    or fn in positional_translations
                    and positional_translations[fn][arg] == "revisions"
                ):
                    subparser.add_argument(
                        "revisions",
                        nargs="+",
                        help=positional_help.get("revisions"),
                    )
                else:
                    subparser.add_argument(arg, help=positional_help.get(arg))

        parser = ArgumentParser(prog=prog)

        parser.add_argument(
            "--version", action="version", version="%%(prog)s %s" % __version__
        )
        parser.add_argument(
            "-c",
            "--config",
            type=str,
            default=os.environ.get("ALEMBIC_CONFIG", "alembic.ini"),
            help="Alternate config file; defaults to value of "
            'ALEMBIC_CONFIG environment variable, or "alembic.ini"',
        )
        parser.add_argument(
            "-n",
            "--name",
            type=str,
            default="alembic",
            help="Name of section in .ini file to " "use for Alembic config",
        )
        parser.add_argument(
            "-x",
            action="append",
            help="Additional arguments consumed by "
            "custom env.py scripts, e.g. -x "
            "setting1=somesetting -x setting2=somesetting",
        )
        parser.add_argument(
            "--raiseerr",
            action="store_true",
            help="Raise a full stack trace on error",
        )
        parser.add_argument(
            "-q",
            "--quiet",
            action="store_true",
            help="Do not log to std output.",
        )
        subparsers = parser.add_subparsers()

        positional_translations: Dict[Any, Any] = {
            command.stamp: {"revision": "revisions"}
        }

        for fn in [getattr(command, n) for n in dir(command)]:
            if (
                inspect.isfunction(fn)
                and fn.__name__[0] != "_"
                and fn.__module__ == "alembic.command"
            ):
                spec = compat.inspect_getfullargspec(fn)
                if spec[3] is not None:
                    positional = spec[0][1 : -len(spec[3])]
                    kwarg = spec[0][-len(spec[3]) :]
                else:
                    positional = spec[0][1:]
                    kwarg = []

                if fn in positional_translations:
                    positional = [
                        positional_translations[fn].get(name, name)
                        for name in positional
                    ]

                # parse first line(s) of helptext without a line break
                help_ = fn.__doc__
                if help_:
                    help_text = []
                    for line in help_.split("\n"):
                        if not line.strip():
                            break
                        else:
                            help_text.append(line.strip())
                else:
                    help_text = []
                subparser = subparsers.add_parser(
                    fn.__name__, help=" ".join(help_text)
                )
                add_options(fn, subparser, positional, kwarg)
                subparser.set_defaults(cmd=(fn, positional, kwarg))
        self.parser = parser

    def run_cmd(self, config: Config, options: Namespace) -> None:
        fn, positional, kwarg = options.cmd

        try:
            fn(
                config,
                *[getattr(options, k, None) for k in positional],
                **{k: getattr(options, k, None) for k in kwarg},
            )
        except util.CommandError as e:
            if options.raiseerr:
                raise
            else:
                util.err(str(e), **config.messaging_opts)

    def main(self, argv: Optional[Sequence[str]] = None) -> None:
        options = self.parser.parse_args(argv)
        if not hasattr(options, "cmd"):
            # see http://bugs.python.org/issue9253, argparse
            # behavior changed incompatibly in py3.3
            self.parser.error("too few arguments")
        else:
            cfg = Config(
                file_=options.config,
                ini_section=options.name,
                cmd_opts=options,
            )
            self.run_cmd(cfg, options)


def main(
    argv: Optional[Sequence[str]] = None,
    prog: Optional[str] = None,
    **kwargs: Any,
) -> None:
    """The console runner function for Alembic."""

    CommandLine(prog=prog).main(argv=argv)


if __name__ == "__main__":
    main()

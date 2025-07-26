import importlib.machinery
import os
import shutil
import textwrap

from sqlalchemy.testing import config
from sqlalchemy.testing import provision

from . import util as testing_util
from .. import command
from .. import script
from .. import util
from ..script import Script
from ..script import ScriptDirectory


def _get_staging_directory():
    if provision.FOLLOWER_IDENT:
        return "scratch_%s" % provision.FOLLOWER_IDENT
    else:
        return "scratch"


def staging_env(create=True, template="generic", sourceless=False):
    cfg = _testing_config()
    if create:
        path = os.path.join(_get_staging_directory(), "scripts")
        assert not os.path.exists(path), (
            "staging directory %s already exists; poor cleanup?" % path
        )

        command.init(cfg, path, template=template)
        if sourceless:
            try:
                # do an import so that a .pyc/.pyo is generated.
                util.load_python_file(path, "env.py")
            except AttributeError:
                # we don't have the migration context set up yet
                # so running the .env py throws this exception.
                # theoretically we could be using py_compiler here to
                # generate .pyc/.pyo without importing but not really
                # worth it.
                pass
            assert sourceless in (
                "pep3147_envonly",
                "simple",
                "pep3147_everything",
            ), sourceless
            make_sourceless(
                os.path.join(path, "env.py"),
                "pep3147" if "pep3147" in sourceless else "simple",
            )

    sc = script.ScriptDirectory.from_config(cfg)
    return sc


def clear_staging_env():
    from sqlalchemy.testing import engines

    engines.testing_reaper.close_all()
    shutil.rmtree(_get_staging_directory(), True)


def script_file_fixture(txt):
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    path = os.path.join(dir_, "script.py.mako")
    with open(path, "w") as f:
        f.write(txt)


def env_file_fixture(txt):
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    txt = (
        """
from alembic import context

config = context.config
"""
        + txt
    )

    path = os.path.join(dir_, "env.py")
    pyc_path = util.pyc_file_from_path(path)
    if pyc_path:
        os.unlink(pyc_path)

    with open(path, "w") as f:
        f.write(txt)


def _sqlite_file_db(tempname="foo.db", future=False, scope=None, **options):
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    url = "sqlite:///%s/%s" % (dir_, tempname)
    if scope and util.sqla_14:
        options["scope"] = scope
    return testing_util.testing_engine(url=url, future=future, options=options)


def _sqlite_testing_config(sourceless=False, future=False):
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    url = "sqlite:///%s/foo.db" % dir_

    sqlalchemy_future = future or ("future" in config.db.__class__.__module__)

    return _write_config_file(
        """
[alembic]
script_location = %s
sqlalchemy.url = %s
sourceless = %s
%s

[loggers]
keys = root,sqlalchemy

[handlers]
keys = console

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = DEBUG
handlers =
qualname = sqlalchemy.engine

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatters]
keys = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
datefmt = %%H:%%M:%%S
    """
        % (
            dir_,
            url,
            "true" if sourceless else "false",
            "sqlalchemy.future = true" if sqlalchemy_future else "",
        )
    )


def _multi_dir_testing_config(sourceless=False, extra_version_location=""):
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    sqlalchemy_future = "future" in config.db.__class__.__module__

    url = "sqlite:///%s/foo.db" % dir_

    return _write_config_file(
        """
[alembic]
script_location = %s
sqlalchemy.url = %s
sqlalchemy.future = %s
sourceless = %s
version_locations = %%(here)s/model1/ %%(here)s/model2/ %%(here)s/model3/ %s

[loggers]
keys = root

[handlers]
keys = console

[logger_root]
level = WARN
handlers = console
qualname =

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatters]
keys = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
datefmt = %%H:%%M:%%S
    """
        % (
            dir_,
            url,
            "true" if sqlalchemy_future else "false",
            "true" if sourceless else "false",
            extra_version_location,
        )
    )


def _no_sql_testing_config(dialect="postgresql", directives=""):
    """use a postgresql url with no host so that
    connections guaranteed to fail"""
    dir_ = os.path.join(_get_staging_directory(), "scripts")
    return _write_config_file(
        """
[alembic]
script_location = %s
sqlalchemy.url = %s://
%s

[loggers]
keys = root

[handlers]
keys = console

[logger_root]
level = WARN
handlers = console
qualname =

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatters]
keys = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
datefmt = %%H:%%M:%%S

"""
        % (dir_, dialect, directives)
    )


def _write_config_file(text):
    cfg = _testing_config()
    with open(cfg.config_file_name, "w") as f:
        f.write(text)
    return cfg


def _testing_config():
    from alembic.config import Config

    if not os.access(_get_staging_directory(), os.F_OK):
        os.mkdir(_get_staging_directory())
    return Config(os.path.join(_get_staging_directory(), "test_alembic.ini"))


def write_script(
    scriptdir, rev_id, content, encoding="ascii", sourceless=False
):
    old = scriptdir.revision_map.get_revision(rev_id)
    path = old.path

    content = textwrap.dedent(content)
    if encoding:
        content = content.encode(encoding)
    with open(path, "wb") as fp:
        fp.write(content)
    pyc_path = util.pyc_file_from_path(path)
    if pyc_path:
        os.unlink(pyc_path)
    script = Script._from_path(scriptdir, path)
    old = scriptdir.revision_map.get_revision(script.revision)
    if old.down_revision != script.down_revision:
        raise Exception(
            "Can't change down_revision " "on a refresh operation."
        )
    scriptdir.revision_map.add_revision(script, _replace=True)

    if sourceless:
        make_sourceless(
            path, "pep3147" if sourceless == "pep3147_everything" else "simple"
        )


def make_sourceless(path, style):
    import py_compile

    py_compile.compile(path)

    if style == "simple":
        pyc_path = util.pyc_file_from_path(path)
        suffix = importlib.machinery.BYTECODE_SUFFIXES[0]
        filepath, ext = os.path.splitext(path)
        simple_pyc_path = filepath + suffix
        shutil.move(pyc_path, simple_pyc_path)
        pyc_path = simple_pyc_path
    else:
        assert style in ("pep3147", "simple")
        pyc_path = util.pyc_file_from_path(path)

    assert os.access(pyc_path, os.F_OK)

    os.unlink(path)


def three_rev_fixture(cfg):
    a = util.rev_id()
    b = util.rev_id()
    c = util.rev_id()

    script = ScriptDirectory.from_config(cfg)
    script.generate_revision(a, "revision a", refresh=True, head="base")
    write_script(
        script,
        a,
        """\
"Rev A"
revision = '%s'
down_revision = None

from alembic import op


def upgrade():
    op.execute("CREATE STEP 1")


def downgrade():
    op.execute("DROP STEP 1")

"""
        % a,
    )

    script.generate_revision(b, "revision b", refresh=True, head=a)
    write_script(
        script,
        b,
        f"""# coding: utf-8
"Rev B, méil, %3"
revision = '{b}'
down_revision = '{a}'

from alembic import op


def upgrade():
    op.execute("CREATE STEP 2")


def downgrade():
    op.execute("DROP STEP 2")

""",
        encoding="utf-8",
    )

    script.generate_revision(c, "revision c", refresh=True, head=b)
    write_script(
        script,
        c,
        """\
"Rev C"
revision = '%s'
down_revision = '%s'

from alembic import op


def upgrade():
    op.execute("CREATE STEP 3")


def downgrade():
    op.execute("DROP STEP 3")

"""
        % (c, b),
    )
    return a, b, c


def multi_heads_fixture(cfg, a, b, c):
    """Create a multiple head fixture from the three-revs fixture"""

    # a->b->c
    #     -> d -> e
    #     -> f
    d = util.rev_id()
    e = util.rev_id()
    f = util.rev_id()

    script = ScriptDirectory.from_config(cfg)
    script.generate_revision(
        d, "revision d from b", head=b, splice=True, refresh=True
    )
    write_script(
        script,
        d,
        """\
"Rev D"
revision = '%s'
down_revision = '%s'

from alembic import op


def upgrade():
    op.execute("CREATE STEP 4")


def downgrade():
    op.execute("DROP STEP 4")

"""
        % (d, b),
    )

    script.generate_revision(
        e, "revision e from d", head=d, splice=True, refresh=True
    )
    write_script(
        script,
        e,
        """\
"Rev E"
revision = '%s'
down_revision = '%s'

from alembic import op


def upgrade():
    op.execute("CREATE STEP 5")


def downgrade():
    op.execute("DROP STEP 5")

"""
        % (e, d),
    )

    script.generate_revision(
        f, "revision f from b", head=b, splice=True, refresh=True
    )
    write_script(
        script,
        f,
        """\
"Rev F"
revision = '%s'
down_revision = '%s'

from alembic import op


def upgrade():
    op.execute("CREATE STEP 6")


def downgrade():
    op.execute("DROP STEP 6")

"""
        % (f, b),
    )

    return d, e, f


def _multidb_testing_config(engines):
    """alembic.ini fixture to work exactly with the 'multidb' template"""

    dir_ = os.path.join(_get_staging_directory(), "scripts")

    sqlalchemy_future = "future" in config.db.__class__.__module__

    databases = ", ".join(engines.keys())
    engines = "\n\n".join(
        "[%s]\n" "sqlalchemy.url = %s" % (key, value.url)
        for key, value in engines.items()
    )

    return _write_config_file(
        """
[alembic]
script_location = %s
sourceless = false
sqlalchemy.future = %s
databases = %s

%s
[loggers]
keys = root

[handlers]
keys = console

[logger_root]
level = WARN
handlers = console
qualname =

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatters]
keys = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
datefmt = %%H:%%M:%%S
    """
        % (dir_, "true" if sqlalchemy_future else "false", databases, engines)
    )

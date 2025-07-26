import pytest

from mako.ext.beaker_cache import has_beaker
from mako.util import update_wrapper


try:
    import babel.messages.extract as babel
except ImportError:
    babel = None


try:
    import lingua
except ImportError:
    lingua = None


try:
    import dogpile.cache  # noqa
except ImportError:
    has_dogpile_cache = False
else:
    has_dogpile_cache = True


requires_beaker = pytest.mark.skipif(
    not has_beaker, reason="Beaker is required for these tests."
)


requires_babel = pytest.mark.skipif(
    babel is None, reason="babel not installed: skipping babelplugin test"
)


requires_lingua = pytest.mark.skipif(
    lingua is None, reason="lingua not installed: skipping linguaplugin test"
)


requires_dogpile_cache = pytest.mark.skipif(
    not has_dogpile_cache,
    reason="dogpile.cache is required to run these tests",
)


def _pygments_version():
    try:
        import pygments

        version = pygments.__version__
    except:
        version = "0"
    return version


requires_pygments_14 = pytest.mark.skipif(
    _pygments_version() < "1.4", reason="Requires pygments 1.4 or greater"
)


# def requires_pygments_14(fn):

#     return skip_if(
#         lambda: version < "1.4", "Requires pygments 1.4 or greater"
#     )(fn)


def requires_no_pygments_exceptions(fn):
    def go(*arg, **kw):
        from mako import exceptions

        exceptions._install_fallback()
        try:
            return fn(*arg, **kw)
        finally:
            exceptions._install_highlighting()

    return update_wrapper(go, fn)

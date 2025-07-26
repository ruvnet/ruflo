import os

from mako.cache import CacheImpl
from mako.cache import register_plugin
from mako.template import Template
from .assertions import eq_
from .config import config


class TemplateTest:
    def _file_template(self, filename, **kw):
        filepath = self._file_path(filename)
        return Template(
            uri=filename,
            filename=filepath,
            module_directory=config.module_base,
            **kw,
        )

    def _file_path(self, filename):
        name, ext = os.path.splitext(filename)
        py3k_path = os.path.join(config.template_base, name + "_py3k" + ext)
        if os.path.exists(py3k_path):
            return py3k_path

        return os.path.join(config.template_base, filename)

    def _do_file_test(
        self,
        filename,
        expected,
        filters=None,
        unicode_=True,
        template_args=None,
        **kw,
    ):
        t1 = self._file_template(filename, **kw)
        self._do_test(
            t1,
            expected,
            filters=filters,
            unicode_=unicode_,
            template_args=template_args,
        )

    def _do_memory_test(
        self,
        source,
        expected,
        filters=None,
        unicode_=True,
        template_args=None,
        **kw,
    ):
        t1 = Template(text=source, **kw)
        self._do_test(
            t1,
            expected,
            filters=filters,
            unicode_=unicode_,
            template_args=template_args,
        )

    def _do_test(
        self,
        template,
        expected,
        filters=None,
        template_args=None,
        unicode_=True,
    ):
        if template_args is None:
            template_args = {}
        if unicode_:
            output = template.render_unicode(**template_args)
        else:
            output = template.render(**template_args)

        if filters:
            output = filters(output)
        eq_(output, expected)

    def indicates_unbound_local_error(self, rendered_output, unbound_var):
        var = f"&#39;{unbound_var}&#39;"
        error_msgs = (
            # < 3.11
            f"local variable {var} referenced before assignment",
            # >= 3.11
            f"cannot access local variable {var} where it is not associated",
        )
        return any((msg in rendered_output) for msg in error_msgs)


class PlainCacheImpl(CacheImpl):
    """Simple memory cache impl so that tests which
    use caching can run without beaker."""

    def __init__(self, cache):
        self.cache = cache
        self.data = {}

    def get_or_create(self, key, creation_function, **kw):
        if key in self.data:
            return self.data[key]
        else:
            self.data[key] = data = creation_function(**kw)
            return data

    def put(self, key, value, **kw):
        self.data[key] = value

    def get(self, key, **kw):
        return self.data[key]

    def invalidate(self, key, **kw):
        del self.data[key]


register_plugin("plain", __name__, "PlainCacheImpl")

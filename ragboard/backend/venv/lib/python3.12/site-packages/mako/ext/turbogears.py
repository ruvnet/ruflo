# ext/turbogears.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

from mako import compat
from mako.lookup import TemplateLookup
from mako.template import Template


class TGPlugin:

    """TurboGears compatible Template Plugin."""

    def __init__(self, extra_vars_func=None, options=None, extension="mak"):
        self.extra_vars_func = extra_vars_func
        self.extension = extension
        if not options:
            options = {}

        # Pull the options out and initialize the lookup
        lookup_options = {}
        for k, v in options.items():
            if k.startswith("mako."):
                lookup_options[k[5:]] = v
            elif k in ["directories", "filesystem_checks", "module_directory"]:
                lookup_options[k] = v
        self.lookup = TemplateLookup(**lookup_options)

        self.tmpl_options = {}
        # transfer lookup args to template args, based on those available
        # in getargspec
        for kw in compat.inspect_getargspec(Template.__init__)[0]:
            if kw in lookup_options:
                self.tmpl_options[kw] = lookup_options[kw]

    def load_template(self, templatename, template_string=None):
        """Loads a template from a file or a string"""
        if template_string is not None:
            return Template(template_string, **self.tmpl_options)
        # Translate TG dot notation to normal / template path
        if "/" not in templatename:
            templatename = (
                "/" + templatename.replace(".", "/") + "." + self.extension
            )

        # Lookup template
        return self.lookup.get_template(templatename)

    def render(
        self, info, format="html", fragment=False, template=None  # noqa
    ):
        if isinstance(template, str):
            template = self.load_template(template)

        # Load extra vars func if provided
        if self.extra_vars_func:
            info.update(self.extra_vars_func())

        return template.render(**info)

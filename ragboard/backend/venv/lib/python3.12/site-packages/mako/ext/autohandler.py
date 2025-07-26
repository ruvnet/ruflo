# ext/autohandler.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""adds autohandler functionality to Mako templates.

requires that the TemplateLookup class is used with templates.

usage::

    <%!
        from mako.ext.autohandler import autohandler
    %>
    <%inherit file="${autohandler(template, context)}"/>


or with custom autohandler filename::

    <%!
        from mako.ext.autohandler import autohandler
    %>
    <%inherit file="${autohandler(template, context, name='somefilename')}"/>

"""

import os
import posixpath
import re


def autohandler(template, context, name="autohandler"):
    lookup = context.lookup
    _template_uri = template.module._template_uri
    if not lookup.filesystem_checks:
        try:
            return lookup._uri_cache[(autohandler, _template_uri, name)]
        except KeyError:
            pass

    tokens = re.findall(r"([^/]+)", posixpath.dirname(_template_uri)) + [name]
    while len(tokens):
        path = "/" + "/".join(tokens)
        if path != _template_uri and _file_exists(lookup, path):
            if not lookup.filesystem_checks:
                return lookup._uri_cache.setdefault(
                    (autohandler, _template_uri, name), path
                )
            else:
                return path
        if len(tokens) == 1:
            break
        tokens[-2:] = [name]

    if not lookup.filesystem_checks:
        return lookup._uri_cache.setdefault(
            (autohandler, _template_uri, name), None
        )
    else:
        return None


def _file_exists(lookup, path):
    psub = re.sub(r"^/", "", path)
    for d in lookup.directories:
        if os.path.exists(d + "/" + psub):
            return True
    else:
        return False

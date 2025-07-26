# ext/babelplugin.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""gettext message extraction via Babel: https://pypi.org/project/Babel/"""
from babel.messages.extract import extract_python

from mako.ext.extract import MessageExtractor


class BabelMakoExtractor(MessageExtractor):
    def __init__(self, keywords, comment_tags, options):
        self.keywords = keywords
        self.options = options
        self.config = {
            "comment-tags": " ".join(comment_tags),
            "encoding": options.get(
                "input_encoding", options.get("encoding", None)
            ),
        }
        super().__init__()

    def __call__(self, fileobj):
        return self.process_file(fileobj)

    def process_python(self, code, code_lineno, translator_strings):
        comment_tags = self.config["comment-tags"]
        for (
            lineno,
            funcname,
            messages,
            python_translator_comments,
        ) in extract_python(code, self.keywords, comment_tags, self.options):
            yield (
                code_lineno + (lineno - 1),
                funcname,
                messages,
                translator_strings + python_translator_comments,
            )


def extract(fileobj, keywords, comment_tags, options):
    """Extract messages from Mako templates.

    :param fileobj: the file-like object the messages should be extracted from
    :param keywords: a list of keywords (i.e. function names) that should be
                     recognized as translation functions
    :param comment_tags: a list of translator tags to search for and include
                         in the results
    :param options: a dictionary of additional options (optional)
    :return: an iterator over ``(lineno, funcname, message, comments)`` tuples
    :rtype: ``iterator``
    """
    extractor = BabelMakoExtractor(keywords, comment_tags, options)
    yield from extractor(fileobj)

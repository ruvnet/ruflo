# ext/linguaplugin.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

import contextlib
import io

from lingua.extractors import Extractor
from lingua.extractors import get_extractor
from lingua.extractors import Message

from mako.ext.extract import MessageExtractor


class LinguaMakoExtractor(Extractor, MessageExtractor):
    """Mako templates"""

    use_bytes = False
    extensions = [".mako"]
    default_config = {"encoding": "utf-8", "comment-tags": ""}

    def __call__(self, filename, options, fileobj=None):
        self.options = options
        self.filename = filename
        self.python_extractor = get_extractor("x.py")
        if fileobj is None:
            ctx = open(filename, "r")
        else:
            ctx = contextlib.nullcontext(fileobj)
        with ctx as file_:
            yield from self.process_file(file_)

    def process_python(self, code, code_lineno, translator_strings):
        source = code.getvalue().strip()
        if source.endswith(":"):
            if source in ("try:", "else:") or source.startswith("except"):
                source = ""  # Ignore try/except and else
            elif source.startswith("elif"):
                source = source[2:]  # Replace "elif" with "if"
            source += "pass"
        code = io.StringIO(source)
        for msg in self.python_extractor(
            self.filename, self.options, code, code_lineno - 1
        ):
            if translator_strings:
                msg = Message(
                    msg.msgctxt,
                    msg.msgid,
                    msg.msgid_plural,
                    msg.flags,
                    " ".join(translator_strings + [msg.comment]),
                    msg.tcomment,
                    msg.location,
                )
            yield msg

import sys


# This can only be tested by using different python versions, therefore it is not covered by coverage.py
if sys.version_info.major == 3 and sys.version_info.minor >= 4: # pragma: no cover
    # Python 3.4+
    from html import unescape
else: # pragma: no cover
    if sys.version_info.major <= 2:
        # Python 2
        import HTMLParser

        html_parser = HTMLParser.HTMLParser()
    else:
        # Python 3.0 - 3.3
        import html.parser

        html_parser = html.parser.HTMLParser()

    def unescape(string):
        return html_parser.unescape(string)

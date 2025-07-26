# Copyright 2012-2013 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
#     http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
from html.parser import HTMLParser
from itertools import zip_longest

PRIORITY_PARENT_TAGS = ('code', 'a')
OMIT_NESTED_TAGS = ('span', 'i', 'code', 'a')
OMIT_SELF_TAGS = ('i', 'b')
HTML_BLOCK_DISPLAY_TAGS = ('p', 'note', 'ul', 'li')


class DocStringParser(HTMLParser):
    """
    A simple HTML parser.  Focused on converting the subset of HTML
    that appears in the documentation strings of the JSON models into
    simple ReST format.
    """

    def __init__(self, doc):
        self.tree = None
        self.doc = doc
        super().__init__()

    def reset(self):
        HTMLParser.reset(self)
        self.tree = HTMLTree(self.doc)

    def feed(self, data):
        super().feed(data)
        self.tree.write()
        self.tree = HTMLTree(self.doc)

    def close(self):
        super().close()
        # Write if there is anything remaining.
        self.tree.write()
        self.tree = HTMLTree(self.doc)

    def handle_starttag(self, tag, attrs):
        self.tree.add_tag(tag, attrs=attrs)

    def handle_endtag(self, tag):
        self.tree.add_tag(tag, is_start=False)

    def handle_data(self, data):
        self.tree.add_data(data)


class HTMLTree:
    """
    A tree which handles HTML nodes. Designed to work with a python HTML parser,
    meaning that the current_node will be the most recently opened tag. When
    a tag is closed, the current_node moves up to the parent node.
    """

    def __init__(self, doc):
        self.doc = doc
        self.head = StemNode()
        self.current_node = self.head
        self.unhandled_tags = []

    def add_tag(self, tag, attrs=None, is_start=True):
        if not self._doc_has_handler(tag, is_start):
            self.unhandled_tags.append(tag)
            return

        if is_start:
            node = TagNode(tag, attrs)
            self.current_node.add_child(node)
            self.current_node = node
        else:
            self.current_node = self.current_node.parent

    def _doc_has_handler(self, tag, is_start):
        if is_start:
            handler_name = f'start_{tag}'
        else:
            handler_name = f'end_{tag}'

        return hasattr(self.doc.style, handler_name)

    def add_data(self, data):
        self.current_node.add_child(DataNode(data))

    def write(self):
        self.head.write(self.doc)


class Node:
    def __init__(self, parent=None):
        self.parent = parent

    def write(self, doc):
        raise NotImplementedError


class StemNode(Node):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.children = []

    def add_child(self, child):
        child.parent = self
        self.children.append(child)

    def write(self, doc):
        self.collapse_whitespace()
        self._write_children(doc)

    def _write_children(self, doc):
        for child, next_child in zip_longest(self.children, self.children[1:]):
            if isinstance(child, TagNode) and next_child is not None:
                child.write(doc, next_child)
            else:
                child.write(doc)

    def is_whitespace(self):
        return all(child.is_whitespace() for child in self.children)

    def startswith_whitespace(self):
        return self.children and self.children[0].startswith_whitespace()

    def endswith_whitespace(self):
        return self.children and self.children[-1].endswith_whitespace()

    def lstrip(self):
        while self.children and self.children[0].is_whitespace():
            self.children = self.children[1:]
        if self.children:
            self.children[0].lstrip()

    def rstrip(self):
        while self.children and self.children[-1].is_whitespace():
            self.children = self.children[:-1]
        if self.children:
            self.children[-1].rstrip()

    def collapse_whitespace(self):
        """Remove collapsible white-space from HTML.

        HTML in docstrings often contains extraneous white-space around tags,
        for readability. Browsers would collapse this white-space before
        rendering. If not removed before conversion to RST where white-space is
        part of the syntax, for example for indentation, it can result in
        incorrect output.
        """
        self.lstrip()
        self.rstrip()
        for child in self.children:
            child.collapse_whitespace()


class TagNode(StemNode):
    """
    A generic Tag node. It will verify that handlers exist before writing.
    """

    def __init__(self, tag, attrs=None, parent=None):
        super().__init__(parent)
        self.attrs = attrs
        self.tag = tag

    def _has_nested_tags(self):
        # Returns True if any children are TagNodes and False otherwise.
        return any(isinstance(child, TagNode) for child in self.children)

    def write(self, doc, next_child=None):
        prioritize_nested_tags = (
            self.tag in OMIT_SELF_TAGS and self._has_nested_tags()
        )
        prioritize_parent_tag = (
            isinstance(self.parent, TagNode)
            and self.parent.tag in PRIORITY_PARENT_TAGS
            and self.tag in OMIT_NESTED_TAGS
        )
        if prioritize_nested_tags or prioritize_parent_tag:
            self._write_children(doc)
            return

        self._write_start(doc)
        self._write_children(doc)
        self._write_end(doc, next_child)

    def collapse_whitespace(self):
        """Remove collapsible white-space.

        All tags collapse internal whitespace. Block-display HTML tags also
        strip all leading and trailing whitespace.

        Approximately follows the specification used in browsers:
        https://www.w3.org/TR/css-text-3/#white-space-rules
        https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
        """
        if self.tag in HTML_BLOCK_DISPLAY_TAGS:
            self.lstrip()
            self.rstrip()
        # Collapse whitespace in situations like ``</b> <i> foo</i>`` into
        # ``</b><i> foo</i>``.
        for prev, cur in zip(self.children[:-1], self.children[1:]):
            if (
                isinstance(prev, DataNode)
                and prev.endswith_whitespace()
                and cur.startswith_whitespace()
            ):
                cur.lstrip()
        # Same logic, but for situations like ``<b>bar </b> <i>``:
        for cur, nxt in zip(self.children[:-1], self.children[1:]):
            if (
                isinstance(nxt, DataNode)
                and cur.endswith_whitespace()
                and nxt.startswith_whitespace()
            ):
                cur.rstrip()
        # Recurse into children
        for child in self.children:
            child.collapse_whitespace()

    def _write_start(self, doc):
        handler_name = f'start_{self.tag}'
        if hasattr(doc.style, handler_name):
            getattr(doc.style, handler_name)(self.attrs)

    def _write_end(self, doc, next_child):
        handler_name = f'end_{self.tag}'
        if hasattr(doc.style, handler_name):
            if handler_name == 'end_a':
                # We use lookahead to determine if a space is needed after a link node
                getattr(doc.style, handler_name)(next_child)
            else:
                getattr(doc.style, handler_name)()


class DataNode(Node):
    """
    A Node that contains only string data.
    """

    def __init__(self, data, parent=None):
        super().__init__(parent)
        if not isinstance(data, str):
            raise ValueError(f"Expecting string type, {type(data)} given.")
        self._leading_whitespace = ''
        self._trailing_whitespace = ''
        self._stripped_data = ''
        if data == '':
            return
        if data.isspace():
            self._trailing_whitespace = data
            return
        first_non_space = next(
            idx for idx, ch in enumerate(data) if not ch.isspace()
        )
        last_non_space = len(data) - next(
            idx for idx, ch in enumerate(reversed(data)) if not ch.isspace()
        )
        self._leading_whitespace = data[:first_non_space]
        self._trailing_whitespace = data[last_non_space:]
        self._stripped_data = data[first_non_space:last_non_space]

    @property
    def data(self):
        return (
            f'{self._leading_whitespace}{self._stripped_data}'
            f'{self._trailing_whitespace}'
        )

    def is_whitespace(self):
        return self._stripped_data == '' and (
            self._leading_whitespace != '' or self._trailing_whitespace != ''
        )

    def startswith_whitespace(self):
        return self._leading_whitespace != '' or (
            self._stripped_data == '' and self._trailing_whitespace != ''
        )

    def endswith_whitespace(self):
        return self._trailing_whitespace != '' or (
            self._stripped_data == '' and self._leading_whitespace != ''
        )

    def lstrip(self):
        if self._leading_whitespace != '':
            self._leading_whitespace = ''
        elif self._stripped_data == '':
            self.rstrip()

    def rstrip(self):
        if self._trailing_whitespace != '':
            self._trailing_whitespace = ''
        elif self._stripped_data == '':
            self.lstrip()

    def collapse_whitespace(self):
        """Noop, ``DataNode.write`` always collapses whitespace"""
        return

    def write(self, doc):
        words = doc.translate_words(self._stripped_data.split())
        str_data = (
            f'{self._leading_whitespace}{" ".join(words)}'
            f'{self._trailing_whitespace}'
        )
        if str_data != '':
            doc.handle_data(str_data)

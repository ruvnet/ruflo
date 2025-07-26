import itertools
import os
import re
from string import Template
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Tuple

from tokenizers import Encoding, Tokenizer


dirname = os.path.dirname(__file__)
css_filename = os.path.join(dirname, "visualizer-styles.css")
with open(css_filename) as f:
    css = f.read()


class Annotation:
    start: int
    end: int
    label: int

    def __init__(self, start: int, end: int, label: str):
        self.start = start
        self.end = end
        self.label = label


AnnotationList = List[Annotation]
PartialIntList = List[Optional[int]]


class CharStateKey(NamedTuple):
    token_ix: Optional[int]
    anno_ix: Optional[int]


class CharState:
    char_ix: Optional[int]

    def __init__(self, char_ix):
        self.char_ix = char_ix

        self.anno_ix: Optional[int] = None
        self.tokens: List[int] = []

    @property
    def token_ix(self):
        return self.tokens[0] if len(self.tokens) > 0 else None

    @property
    def is_multitoken(self):
        """
        BPE tokenizers can output more than one token for a char
        """
        return len(self.tokens) > 1

    def partition_key(self) -> CharStateKey:
        return CharStateKey(
            token_ix=self.token_ix,
            anno_ix=self.anno_ix,
        )


class Aligned:
    pass


class EncodingVisualizer:
    """
    Build an EncodingVisualizer

    Args:

         tokenizer (:class:`~tokenizers.Tokenizer`):
            A tokenizer instance

         default_to_notebook (:obj:`bool`):
            Whether to render html output in a notebook by default

         annotation_converter (:obj:`Callable`, `optional`):
            An optional (lambda) function that takes an annotation in any format and returns
            an Annotation object
    """

    unk_token_regex = re.compile("(.{1}\b)?(unk|oov)(\b.{1})?", flags=re.IGNORECASE)

    def __init__(
        self,
        tokenizer: Tokenizer,
        default_to_notebook: bool = True,
        annotation_converter: Optional[Callable[[Any], Annotation]] = None,
    ):
        if default_to_notebook:
            try:
                from IPython.core.display import HTML, display
            except ImportError:
                raise Exception(
                    """We couldn't import IPython utils for html display.
                        Are you running in a notebook?
                        You can also pass `default_to_notebook=False` to get back raw HTML
                    """
                )

        self.tokenizer = tokenizer
        self.default_to_notebook = default_to_notebook
        self.annotation_coverter = annotation_converter
        pass

    def __call__(
        self,
        text: str,
        annotations: AnnotationList = [],
        default_to_notebook: Optional[bool] = None,
    ) -> Optional[str]:
        """
        Build a visualization of the given text

        Args:
            text (:obj:`str`):
                The text to tokenize

            annotations (:obj:`List[Annotation]`, `optional`):
                An optional list of annotations of the text. The can either be an annotation class
                or anything else if you instantiated the visualizer with a converter function

            default_to_notebook (:obj:`bool`, `optional`, defaults to `False`):
                If True, will render the html in a notebook. Otherwise returns an html string.

        Returns:
            The HTML string if default_to_notebook is False, otherwise (default) returns None and
            renders the HTML in the notebook

        """
        final_default_to_notebook = self.default_to_notebook
        if default_to_notebook is not None:
            final_default_to_notebook = default_to_notebook
        if final_default_to_notebook:
            try:
                from IPython.core.display import HTML, display
            except ImportError:
                raise Exception(
                    """We couldn't import IPython utils for html display.
                    Are you running in a notebook?"""
                )
        if self.annotation_coverter is not None:
            annotations = list(map(self.annotation_coverter, annotations))
        encoding = self.tokenizer.encode(text)
        html = EncodingVisualizer.__make_html(text, encoding, annotations)
        if final_default_to_notebook:
            display(HTML(html))
        else:
            return html

    @staticmethod
    def calculate_label_colors(annotations: AnnotationList) -> Dict[str, str]:
        """
        Generates a color palette for all the labels in a given set of annotations

        Args:
          annotations (:obj:`Annotation`):
            A list of annotations

        Returns:
            :obj:`dict`: A dictionary mapping labels to colors in HSL format
        """
        if len(annotations) == 0:
            return {}
        labels = set(map(lambda x: x.label, annotations))
        num_labels = len(labels)
        h_step = int(255 / num_labels)
        if h_step < 20:
            h_step = 20
        s = 32
        l = 64  # noqa: E741
        h = 10
        colors = {}

        for label in sorted(labels):  # sort so we always get the same colors for a given set of labels
            colors[label] = f"hsl({h},{s}%,{l}%"
            h += h_step
        return colors

    @staticmethod
    def consecutive_chars_to_html(
        consecutive_chars_list: List[CharState],
        text: str,
        encoding: Encoding,
    ):
        """
        Converts a list of "consecutive chars" into a single HTML element.
        Chars are consecutive if they fall under the same word, token and annotation.
        The CharState class is a named tuple with a "partition_key" method that makes it easy to
        compare if two chars are consecutive.

        Args:
            consecutive_chars_list (:obj:`List[CharState]`):
                A list of CharStates that have been grouped together

            text (:obj:`str`):
                The original text being processed

            encoding (:class:`~tokenizers.Encoding`):
                The encoding returned from the tokenizer

        Returns:
            :obj:`str`: The HTML span for a set of consecutive chars
        """
        first = consecutive_chars_list[0]
        if first.char_ix is None:
            # its a special token
            stoken = encoding.tokens[first.token_ix]
            # special tokens are represented as empty spans. We use the data attribute and css
            # magic to display it
            return f'<span class="special-token" data-stoken={stoken}></span>'
        # We're not in a special token so this group has a start and end.
        last = consecutive_chars_list[-1]
        start = first.char_ix
        end = last.char_ix + 1
        span_text = text[start:end]
        css_classes = []  # What css classes will we apply on the resulting span
        data_items = {}  # What data attributes will we apply on the result span
        if first.token_ix is not None:
            # We can either be in a token or not (e.g. in white space)
            css_classes.append("token")
            if first.is_multitoken:
                css_classes.append("multi-token")
            if first.token_ix % 2:
                # We use this to color alternating tokens.
                # A token might be split by an annotation that ends in the middle of it, so this
                # lets us visually indicate a consecutive token despite its possible splitting in
                # the html markup
                css_classes.append("odd-token")
            else:
                # Like above, but a different color so we can see the tokens alternate
                css_classes.append("even-token")
            if EncodingVisualizer.unk_token_regex.search(encoding.tokens[first.token_ix]) is not None:
                # This is a special token that is in the text. probably UNK
                css_classes.append("special-token")
                # TODO is this the right name for the data attribute ?
                data_items["stok"] = encoding.tokens[first.token_ix]
        else:
            # In this case we are looking at a group/single char that is not tokenized.
            # e.g. white space
            css_classes.append("non-token")
        css = f'''class="{" ".join(css_classes)}"'''
        data = ""
        for key, val in data_items.items():
            data += f' data-{key}="{val}"'
        return f"<span {css} {data} >{span_text}</span>"

    @staticmethod
    def __make_html(text: str, encoding: Encoding, annotations: AnnotationList) -> str:
        char_states = EncodingVisualizer.__make_char_states(text, encoding, annotations)
        current_consecutive_chars = [char_states[0]]
        prev_anno_ix = char_states[0].anno_ix
        spans = []
        label_colors_dict = EncodingVisualizer.calculate_label_colors(annotations)
        cur_anno_ix = char_states[0].anno_ix
        if cur_anno_ix is not None:
            # If we started in an  annotation make a span for it
            anno = annotations[cur_anno_ix]
            label = anno.label
            color = label_colors_dict[label]
            spans.append(f'<span class="annotation" style="color:{color}" data-label="{label}">')

        for cs in char_states[1:]:
            cur_anno_ix = cs.anno_ix
            if cur_anno_ix != prev_anno_ix:
                # If we've transitioned in or out of an annotation
                spans.append(
                    # Create a span from the current consecutive characters
                    EncodingVisualizer.consecutive_chars_to_html(
                        current_consecutive_chars,
                        text=text,
                        encoding=encoding,
                    )
                )
                current_consecutive_chars = [cs]

                if prev_anno_ix is not None:
                    # if we transitioned out of an annotation close it's span
                    spans.append("</span>")
                if cur_anno_ix is not None:
                    # If we entered a new annotation make a span for it
                    anno = annotations[cur_anno_ix]
                    label = anno.label
                    color = label_colors_dict[label]
                    spans.append(f'<span class="annotation" style="color:{color}" data-label="{label}">')
            prev_anno_ix = cur_anno_ix

            if cs.partition_key() == current_consecutive_chars[0].partition_key():
                # If the current charchter is in the same "group" as the previous one
                current_consecutive_chars.append(cs)
            else:
                # Otherwise we make a span for the previous group
                spans.append(
                    EncodingVisualizer.consecutive_chars_to_html(
                        current_consecutive_chars,
                        text=text,
                        encoding=encoding,
                    )
                )
                # An reset the consecutive_char_list to form a new group
                current_consecutive_chars = [cs]
        # All that's left is to fill out the final span
        # TODO I think there is an edge case here where an annotation's span might not close
        spans.append(
            EncodingVisualizer.consecutive_chars_to_html(
                current_consecutive_chars,
                text=text,
                encoding=encoding,
            )
        )
        res = HTMLBody(spans)  # Send the list of spans to the body of our html
        return res

    @staticmethod
    def __make_anno_map(text: str, annotations: AnnotationList) -> PartialIntList:
        """
        Args:
            text (:obj:`str`):
                The raw text we want to align to

            annotations (:obj:`AnnotationList`):
                A (possibly empty) list of annotations

        Returns:
            A list of  length len(text) whose entry at index i is None if there is no annotation on
            character i or k, the index of the annotation that covers index i where k is with
            respect to the list of annotations
        """
        annotation_map = [None] * len(text)
        for anno_ix, a in enumerate(annotations):
            for i in range(a.start, a.end):
                annotation_map[i] = anno_ix
        return annotation_map

    @staticmethod
    def __make_char_states(text: str, encoding: Encoding, annotations: AnnotationList) -> List[CharState]:
        """
        For each character in the original text, we emit a tuple representing it's "state":

            * which token_ix it corresponds to
            * which word_ix it corresponds to
            * which annotation_ix it corresponds to

        Args:
            text (:obj:`str`):
                The raw text we want to align to

            annotations (:obj:`List[Annotation]`):
                A (possibly empty) list of annotations

            encoding: (:class:`~tokenizers.Encoding`):
                The encoding returned from the tokenizer

        Returns:
            :obj:`List[CharState]`: A list of CharStates, indicating for each char in the text what
            it's state is
        """
        annotation_map = EncodingVisualizer.__make_anno_map(text, annotations)
        # Todo make this a dataclass or named tuple
        char_states: List[CharState] = [CharState(char_ix) for char_ix in range(len(text))]
        for token_ix, token in enumerate(encoding.tokens):
            offsets = encoding.token_to_chars(token_ix)
            if offsets is not None:
                start, end = offsets
                for i in range(start, end):
                    char_states[i].tokens.append(token_ix)
        for char_ix, anno_ix in enumerate(annotation_map):
            char_states[char_ix].anno_ix = anno_ix

        return char_states


def HTMLBody(children: List[str], css_styles=css) -> str:
    """
    Generates the full html with css from a list of html spans

    Args:
        children (:obj:`List[str]`):
            A list of strings, assumed to be html elements

        css_styles (:obj:`str`, `optional`):
            Optional alternative implementation of the css

    Returns:
        :obj:`str`: An HTML string with style markup
    """
    children_text = "".join(children)
    return f"""
    <html>
        <head>
            <style>
                {css_styles}
            </style>
        </head>
        <body>
            <div class="tokenized-text" dir=auto>
            {children_text}
            </div>
        </body>
    </html>
    """

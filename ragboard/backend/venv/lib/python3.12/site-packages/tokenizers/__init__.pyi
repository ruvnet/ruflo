# Generated content DO NOT EDIT
class AddedToken:
    """
    Represents a token that can be be added to a :class:`~tokenizers.Tokenizer`.
    It can have special options that defines the way it should behave.

    Args:
        content (:obj:`str`): The content of the token

        single_word (:obj:`bool`, defaults to :obj:`False`):
            Defines whether this token should only match single words. If :obj:`True`, this
            token will never match inside of a word. For example the token ``ing`` would match
            on ``tokenizing`` if this option is :obj:`False`, but not if it is :obj:`True`.
            The notion of "`inside of a word`" is defined by the word boundaries pattern in
            regular expressions (ie. the token should start and end with word boundaries).

        lstrip (:obj:`bool`, defaults to :obj:`False`):
            Defines whether this token should strip all potential whitespaces on its left side.
            If :obj:`True`, this token will greedily match any whitespace on its left. For
            example if we try to match the token ``[MASK]`` with ``lstrip=True``, in the text
            ``"I saw a [MASK]"``, we would match on ``" [MASK]"``. (Note the space on the left).

        rstrip (:obj:`bool`, defaults to :obj:`False`):
            Defines whether this token should strip all potential whitespaces on its right
            side. If :obj:`True`, this token will greedily match any whitespace on its right.
            It works just like :obj:`lstrip` but on the right.

        normalized (:obj:`bool`, defaults to :obj:`True` with :meth:`~tokenizers.Tokenizer.add_tokens` and :obj:`False` with :meth:`~tokenizers.Tokenizer.add_special_tokens`):
            Defines whether this token should match against the normalized version of the input
            text. For example, with the added token ``"yesterday"``, and a normalizer in charge of
            lowercasing the text, the token could be extract from the input ``"I saw a lion
            Yesterday"``.
        special (:obj:`bool`, defaults to :obj:`False` with :meth:`~tokenizers.Tokenizer.add_tokens` and :obj:`False` with :meth:`~tokenizers.Tokenizer.add_special_tokens`):
            Defines whether this token should be skipped when decoding.

    """
    def __init__(self, content, single_word=False, lstrip=False, rstrip=False, normalized=True, special=False):
        pass

    @property
    def content(self):
        """
        Get the content of this :obj:`AddedToken`
        """
        pass

    @property
    def lstrip(self):
        """
        Get the value of the :obj:`lstrip` option
        """
        pass

    @property
    def normalized(self):
        """
        Get the value of the :obj:`normalized` option
        """
        pass

    @property
    def rstrip(self):
        """
        Get the value of the :obj:`rstrip` option
        """
        pass

    @property
    def single_word(self):
        """
        Get the value of the :obj:`single_word` option
        """
        pass

    @property
    def special(self):
        """
        Get the value of the :obj:`special` option
        """
        pass

class Encoding:
    """
    The :class:`~tokenizers.Encoding` represents the output of a :class:`~tokenizers.Tokenizer`.
    """
    @property
    def attention_mask(self):
        """
        The attention mask

        This indicates to the LM which tokens should be attended to, and which should not.
        This is especially important when batching sequences, where we need to applying
        padding.

        Returns:
           :obj:`List[int]`: The attention mask
        """
        pass

    def char_to_token(self, char_pos, sequence_index=0):
        """
        Get the token that contains the char at the given position in the input sequence.

        Args:
            char_pos (:obj:`int`):
                The position of a char in the input string
            sequence_index (:obj:`int`, defaults to :obj:`0`):
                The index of the sequence that contains the target char

        Returns:
            :obj:`int`: The index of the token that contains this char in the encoded sequence
        """
        pass

    def char_to_word(self, char_pos, sequence_index=0):
        """
        Get the word that contains the char at the given position in the input sequence.

        Args:
            char_pos (:obj:`int`):
                The position of a char in the input string
            sequence_index (:obj:`int`, defaults to :obj:`0`):
                The index of the sequence that contains the target char

        Returns:
            :obj:`int`: The index of the word that contains this char in the input sequence
        """
        pass

    @property
    def ids(self):
        """
        The generated IDs

        The IDs are the main input to a Language Model. They are the token indices,
        the numerical representations that a LM understands.

        Returns:
            :obj:`List[int]`: The list of IDs
        """
        pass

    @staticmethod
    def merge(encodings, growing_offsets=True):
        """
        Merge the list of encodings into one final :class:`~tokenizers.Encoding`

        Args:
            encodings (A :obj:`List` of :class:`~tokenizers.Encoding`):
                The list of encodings that should be merged in one

            growing_offsets (:obj:`bool`, defaults to :obj:`True`):
                Whether the offsets should accumulate while merging

        Returns:
            :class:`~tokenizers.Encoding`: The resulting Encoding
        """
        pass

    @property
    def n_sequences(self):
        """
        The number of sequences represented

        Returns:
            :obj:`int`: The number of sequences in this :class:`~tokenizers.Encoding`
        """
        pass

    @property
    def offsets(self):
        """
        The offsets associated to each token

        These offsets let's you slice the input string, and thus retrieve the original
        part that led to producing the corresponding token.

        Returns:
            A :obj:`List` of :obj:`Tuple[int, int]`: The list of offsets
        """
        pass

    @property
    def overflowing(self):
        """
        A :obj:`List` of overflowing :class:`~tokenizers.Encoding`

        When using truncation, the :class:`~tokenizers.Tokenizer` takes care of splitting
        the output into as many pieces as required to match the specified maximum length.
        This field lets you retrieve all the subsequent pieces.

        When you use pairs of sequences, the overflowing pieces will contain enough
        variations to cover all the possible combinations, while respecting the provided
        maximum length.
        """
        pass

    def pad(self, length, direction="right", pad_id=0, pad_type_id=0, pad_token="[PAD]"):
        """
        Pad the :class:`~tokenizers.Encoding` at the given length

        Args:
            length (:obj:`int`):
                The desired length

            direction: (:obj:`str`, defaults to :obj:`right`):
                The expected padding direction. Can be either :obj:`right` or :obj:`left`

            pad_id (:obj:`int`, defaults to :obj:`0`):
                The ID corresponding to the padding token

            pad_type_id (:obj:`int`, defaults to :obj:`0`):
                The type ID corresponding to the padding token

            pad_token (:obj:`str`, defaults to `[PAD]`):
                The pad token to use
        """
        pass

    @property
    def sequence_ids(self):
        """
        The generated sequence indices.

        They represent the index of the input sequence associated to each token.
        The sequence id can be None if the token is not related to any input sequence,
        like for example with special tokens.

        Returns:
            A :obj:`List` of :obj:`Optional[int]`: A list of optional sequence index.
        """
        pass

    def set_sequence_id(self, sequence_id):
        """
        Set the given sequence index

        Set the given sequence index for the whole range of tokens contained in this
        :class:`~tokenizers.Encoding`.
        """
        pass

    @property
    def special_tokens_mask(self):
        """
        The special token mask

        This indicates which tokens are special tokens, and which are not.

        Returns:
            :obj:`List[int]`: The special tokens mask
        """
        pass

    def token_to_chars(self, token_index):
        """
        Get the offsets of the token at the given index.

        The returned offsets are related to the input sequence that contains the
        token.  In order to determine in which input sequence it belongs, you
        must call :meth:`~tokenizers.Encoding.token_to_sequence()`.

        Args:
            token_index (:obj:`int`):
                The index of a token in the encoded sequence.

        Returns:
            :obj:`Tuple[int, int]`: The token offsets :obj:`(first, last + 1)`
        """
        pass

    def token_to_sequence(self, token_index):
        """
        Get the index of the sequence represented by the given token.

        In the general use case, this method returns :obj:`0` for a single sequence or
        the first sequence of a pair, and :obj:`1` for the second sequence of a pair

        Args:
            token_index (:obj:`int`):
                The index of a token in the encoded sequence.

        Returns:
            :obj:`int`: The sequence id of the given token
        """
        pass

    def token_to_word(self, token_index):
        """
        Get the index of the word that contains the token in one of the input sequences.

        The returned word index is related to the input sequence that contains
        the token.  In order to determine in which input sequence it belongs, you
        must call :meth:`~tokenizers.Encoding.token_to_sequence()`.

        Args:
            token_index (:obj:`int`):
                The index of a token in the encoded sequence.

        Returns:
            :obj:`int`: The index of the word in the relevant input sequence.
        """
        pass

    @property
    def tokens(self):
        """
        The generated tokens

        They are the string representation of the IDs.

        Returns:
            :obj:`List[str]`: The list of tokens
        """
        pass

    def truncate(self, max_length, stride=0, direction="right"):
        """
        Truncate the :class:`~tokenizers.Encoding` at the given length

        If this :class:`~tokenizers.Encoding` represents multiple sequences, when truncating
        this information is lost. It will be considered as representing a single sequence.

        Args:
            max_length (:obj:`int`):
                The desired length

            stride (:obj:`int`, defaults to :obj:`0`):
                The length of previous content to be included in each overflowing piece

            direction (:obj:`str`, defaults to :obj:`right`):
                Truncate direction
        """
        pass

    @property
    def type_ids(self):
        """
        The generated type IDs

        Generally used for tasks like sequence classification or question answering,
        these tokens let the LM know which input sequence corresponds to each tokens.

        Returns:
            :obj:`List[int]`: The list of type ids
        """
        pass

    @property
    def word_ids(self):
        """
        The generated word indices.

        They represent the index of the word associated to each token.
        When the input is pre-tokenized, they correspond to the ID of the given input label,
        otherwise they correspond to the words indices as defined by the
        :class:`~tokenizers.pre_tokenizers.PreTokenizer` that was used.

        For special tokens and such (any token that was generated from something that was
        not part of the input), the output is :obj:`None`

        Returns:
            A :obj:`List` of :obj:`Optional[int]`: A list of optional word index.
        """
        pass

    def word_to_chars(self, word_index, sequence_index=0):
        """
        Get the offsets of the word at the given index in one of the input sequences.

        Args:
            word_index (:obj:`int`):
                The index of a word in one of the input sequences.
            sequence_index (:obj:`int`, defaults to :obj:`0`):
                The index of the sequence that contains the target word

        Returns:
            :obj:`Tuple[int, int]`: The range of characters (span) :obj:`(first, last + 1)`
        """
        pass

    def word_to_tokens(self, word_index, sequence_index=0):
        """
        Get the encoded tokens corresponding to the word at the given index
        in one of the input sequences.

        Args:
            word_index (:obj:`int`):
                The index of a word in one of the input sequences.
            sequence_index (:obj:`int`, defaults to :obj:`0`):
                The index of the sequence that contains the target word

        Returns:
            :obj:`Tuple[int, int]`: The range of tokens: :obj:`(first, last + 1)`
        """
        pass

    @property
    def words(self):
        """
        The generated word indices.

        .. warning::
            This is deprecated and will be removed in a future version.
            Please use :obj:`~tokenizers.Encoding.word_ids` instead.

        They represent the index of the word associated to each token.
        When the input is pre-tokenized, they correspond to the ID of the given input label,
        otherwise they correspond to the words indices as defined by the
        :class:`~tokenizers.pre_tokenizers.PreTokenizer` that was used.

        For special tokens and such (any token that was generated from something that was
        not part of the input), the output is :obj:`None`

        Returns:
            A :obj:`List` of :obj:`Optional[int]`: A list of optional word index.
        """
        pass

class NormalizedString:
    """
    NormalizedString

    A NormalizedString takes care of modifying an "original" string, to obtain a "normalized" one.
    While making all the requested modifications, it keeps track of the alignment information
    between the two versions of the string.

    Args:
        sequence: str:
            The string sequence used to initialize this NormalizedString
    """
    def append(self, s):
        """
        Append the given sequence to the string
        """
        pass

    def clear(self):
        """
        Clears the string
        """
        pass

    def filter(self, func):
        """
        Filter each character of the string using the given func
        """
        pass

    def for_each(self, func):
        """
        Calls the given function for each character of the string
        """
        pass

    def lowercase(self):
        """
        Lowercase the string
        """
        pass

    def lstrip(self):
        """
        Strip the left of the string
        """
        pass

    def map(self, func):
        """
        Calls the given function for each character of the string

        Replaces each character of the string using the returned value. Each
        returned value **must** be a str of length 1 (ie a character).
        """
        pass

    def nfc(self):
        """
        Runs the NFC normalization
        """
        pass

    def nfd(self):
        """
        Runs the NFD normalization
        """
        pass

    def nfkc(self):
        """
        Runs the NFKC normalization
        """
        pass

    def nfkd(self):
        """
        Runs the NFKD normalization
        """
        pass

    @property
    def normalized(self):
        """
        The normalized part of the string
        """
        pass

    def prepend(self, s):
        """
        Prepend the given sequence to the string
        """
        pass

    def replace(self, pattern, content):
        """
        Replace the content of the given pattern with the provided content

        Args:
            pattern: Pattern:
                A pattern used to match the string. Usually a string or a Regex

            content: str:
                The content to be used as replacement
        """
        pass

    def rstrip(self):
        """
        Strip the right of the string
        """
        pass

    def slice(self, range):
        """
        Slice the string using the given range
        """
        pass

    def split(self, pattern, behavior):
        """
        Split the NormalizedString using the given pattern and the specified behavior

        Args:
            pattern: Pattern:
                A pattern used to split the string. Usually a string or a regex built with `tokenizers.Regex`

            behavior: SplitDelimiterBehavior:
                The behavior to use when splitting.
                Choices: "removed", "isolated", "merged_with_previous", "merged_with_next",
                "contiguous"

        Returns:
            A list of NormalizedString, representing each split
        """
        pass

    def strip(self):
        """
        Strip both ends of the string
        """
        pass

    def uppercase(self):
        """
        Uppercase the string
        """
        pass

class PreTokenizedString:
    """
    PreTokenizedString

    Wrapper over a string, that provides a way to normalize, pre-tokenize, tokenize the
    underlying string, while keeping track of the alignment information (offsets).

    The PreTokenizedString manages what we call `splits`. Each split represents a substring
    which is a subpart of the original string, with the relevant offsets and tokens.

    When calling one of the methods used to modify the PreTokenizedString (namely one of
    `split`, `normalize` or `tokenize), only the `splits` that don't have any associated
    tokens will get modified.

    Args:
        sequence: str:
            The string sequence used to initialize this PreTokenizedString
    """
    def __init__(self, sequence):
        pass

    def get_splits(self, offset_referential="original", offset_type="char"):
        """
        Get the splits currently managed by the PreTokenizedString

        Args:
            offset_referential: :obj:`str`
                Whether the returned splits should have offsets expressed relative
                to the original string, or the normalized one. choices: "original", "normalized".

            offset_type: :obj:`str`
                Whether the returned splits should have offsets expressed in bytes or chars.
                When slicing an str, we usually want to use chars, which is the default value.
                Now in some cases it might be interesting to get these offsets expressed in bytes,
                so it is possible to change this here.
                choices: "char", "bytes"

        Returns
            A list of splits
        """
        pass

    def normalize(self, func):
        """
        Normalize each split of the `PreTokenizedString` using the given `func`

        Args:
            func: Callable[[NormalizedString], None]:
                The function used to normalize each underlying split. This function
                does not need to return anything, just calling the methods on the provided
                NormalizedString allow its modification.
        """
        pass

    def split(self, func):
        """
        Split the PreTokenizedString using the given `func`

        Args:
            func: Callable[[index, NormalizedString], List[NormalizedString]]:
                The function used to split each underlying split.
                It is expected to return a list of `NormalizedString`, that represent the new
                splits. If the given `NormalizedString` does not need any splitting, we can
                just return it directly.
                In order for the offsets to be tracked accurately, any returned `NormalizedString`
                should come from calling either `.split` or `.slice` on the received one.
        """
        pass

    def to_encoding(self, type_id=0, word_idx=None):
        """
        Return an Encoding generated from this PreTokenizedString

        Args:
            type_id: int = 0:
                The type_id to be used on the generated Encoding.

            word_idx: Optional[int] = None:
                An optional word index to be used for each token of this Encoding. If provided,
                all the word indices in the generated Encoding will use this value, instead
                of the one automatically tracked during pre-tokenization.

        Returns:
            An Encoding
        """
        pass

    def tokenize(self, func):
        """
        Tokenize each split of the `PreTokenizedString` using the given `func`

        Args:
            func: Callable[[str], List[Token]]:
                The function used to tokenize each underlying split. This function must return
                a list of Token generated from the input str.
        """
        pass

class Regex:
    """
    Instantiate a new Regex with the given pattern
    """
    def __init__(self, pattern):
        pass

class Token:
    pass

class Tokenizer:
    """
    A :obj:`Tokenizer` works as a pipeline. It processes some raw text as input
    and outputs an :class:`~tokenizers.Encoding`.

    Args:
        model (:class:`~tokenizers.models.Model`):
            The core algorithm that this :obj:`Tokenizer` should be using.

    """
    def __init__(self, model):
        pass

    def add_special_tokens(self, tokens):
        """
        Add the given special tokens to the Tokenizer.

        If these tokens are already part of the vocabulary, it just let the Tokenizer know about
        them. If they don't exist, the Tokenizer creates them, giving them a new id.

        These special tokens will never be processed by the model (ie won't be split into
        multiple tokens), and they can be removed from the output when decoding.

        Args:
            tokens (A :obj:`List` of :class:`~tokenizers.AddedToken` or :obj:`str`):
                The list of special tokens we want to add to the vocabulary. Each token can either
                be a string or an instance of :class:`~tokenizers.AddedToken` for more
                customization.

        Returns:
            :obj:`int`: The number of tokens that were created in the vocabulary
        """
        pass

    def add_tokens(self, tokens):
        """
        Add the given tokens to the vocabulary

        The given tokens are added only if they don't already exist in the vocabulary.
        Each token then gets a new attributed id.

        Args:
            tokens (A :obj:`List` of :class:`~tokenizers.AddedToken` or :obj:`str`):
                The list of tokens we want to add to the vocabulary. Each token can be either a
                string or an instance of :class:`~tokenizers.AddedToken` for more customization.

        Returns:
            :obj:`int`: The number of tokens that were created in the vocabulary
        """
        pass

    def decode(self, ids, skip_special_tokens=True):
        """
        Decode the given list of ids back to a string

        This is used to decode anything coming back from a Language Model

        Args:
            ids (A :obj:`List/Tuple` of :obj:`int`):
                The list of ids that we want to decode

            skip_special_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether the special tokens should be removed from the decoded string

        Returns:
            :obj:`str`: The decoded string
        """
        pass

    def decode_batch(self, sequences, skip_special_tokens=True):
        """
        Decode a batch of ids back to their corresponding string

        Args:
            sequences (:obj:`List` of :obj:`List[int]`):
                The batch of sequences we want to decode

            skip_special_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether the special tokens should be removed from the decoded strings

        Returns:
            :obj:`List[str]`: A list of decoded strings
        """
        pass

    @property
    def decoder(self):
        """
        The `optional` :class:`~tokenizers.decoders.Decoder` in use by the Tokenizer
        """
        pass

    def enable_padding(
        self, direction="right", pad_id=0, pad_type_id=0, pad_token="[PAD]", length=None, pad_to_multiple_of=None
    ):
        """
        Enable the padding

        Args:
            direction (:obj:`str`, `optional`, defaults to :obj:`right`):
                The direction in which to pad. Can be either ``right`` or ``left``

            pad_to_multiple_of (:obj:`int`, `optional`):
                If specified, the padding length should always snap to the next multiple of the
                given value. For example if we were going to pad witha length of 250 but
                ``pad_to_multiple_of=8`` then we will pad to 256.

            pad_id (:obj:`int`, defaults to 0):
                The id to be used when padding

            pad_type_id (:obj:`int`, defaults to 0):
                The type id to be used when padding

            pad_token (:obj:`str`, defaults to :obj:`[PAD]`):
                The pad token to be used when padding

            length (:obj:`int`, `optional`):
                If specified, the length at which to pad. If not specified we pad using the size of
                the longest sequence in a batch.
        """
        pass

    def enable_truncation(self, max_length, stride=0, strategy="longest_first", direction="right"):
        """
        Enable truncation

        Args:
            max_length (:obj:`int`):
                The max length at which to truncate

            stride (:obj:`int`, `optional`):
                The length of the previous first sequence to be included in the overflowing
                sequence

            strategy (:obj:`str`, `optional`, defaults to :obj:`longest_first`):
                The strategy used to truncation. Can be one of ``longest_first``, ``only_first`` or
                ``only_second``.

            direction (:obj:`str`, defaults to :obj:`right`):
                Truncate direction
        """
        pass

    def encode(self, sequence, pair=None, is_pretokenized=False, add_special_tokens=True):
        """
        Encode the given sequence and pair. This method can process raw text sequences
        as well as already pre-tokenized sequences.

        Example:
            Here are some examples of the inputs that are accepted::

                encode("A single sequence")`
                encode("A sequence", "And its pair")`
                encode([ "A", "pre", "tokenized", "sequence" ], is_pretokenized=True)`
                encode(
                    [ "A", "pre", "tokenized", "sequence" ], [ "And", "its", "pair" ],
                    is_pretokenized=True
                )

        Args:
            sequence (:obj:`~tokenizers.InputSequence`):
                The main input sequence we want to encode. This sequence can be either raw
                text or pre-tokenized, according to the ``is_pretokenized`` argument:

                - If ``is_pretokenized=False``: :class:`~tokenizers.TextInputSequence`
                - If ``is_pretokenized=True``: :class:`~tokenizers.PreTokenizedInputSequence`

            pair (:obj:`~tokenizers.InputSequence`, `optional`):
                An optional input sequence. The expected format is the same that for ``sequence``.

            is_pretokenized (:obj:`bool`, defaults to :obj:`False`):
                Whether the input is already pre-tokenized

            add_special_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether to add the special tokens

        Returns:
            :class:`~tokenizers.Encoding`: The encoded result

        """
        pass

    def encode_batch(self, input, is_pretokenized=False, add_special_tokens=True):
        """
        Encode the given batch of inputs. This method accept both raw text sequences
        as well as already pre-tokenized sequences. The reason we use `PySequence` is
        because it allows type checking with zero-cost (according to PyO3) as we don't
        have to convert to check.

        Example:
            Here are some examples of the inputs that are accepted::

                encode_batch([
                    "A single sequence",
                    ("A tuple with a sequence", "And its pair"),
                    [ "A", "pre", "tokenized", "sequence" ],
                    ([ "A", "pre", "tokenized", "sequence" ], "And its pair")
                ])

        Args:
            input (A :obj:`List`/:obj:`Tuple` of :obj:`~tokenizers.EncodeInput`):
                A list of single sequences or pair sequences to encode. Each sequence
                can be either raw text or pre-tokenized, according to the ``is_pretokenized``
                argument:

                - If ``is_pretokenized=False``: :class:`~tokenizers.TextEncodeInput`
                - If ``is_pretokenized=True``: :class:`~tokenizers.PreTokenizedEncodeInput`

            is_pretokenized (:obj:`bool`, defaults to :obj:`False`):
                Whether the input is already pre-tokenized

            add_special_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether to add the special tokens

        Returns:
            A :obj:`List` of :class:`~tokenizers.Encoding`: The encoded batch

        """
        pass

    def encode_batch_fast(self, input, is_pretokenized=False, add_special_tokens=True):
        """
        Encode the given batch of inputs. This method is faster than `encode_batch`
        because it doesn't keep track of offsets, they will be all zeros.

        Example:
            Here are some examples of the inputs that are accepted::

                encode_batch_fast([
                    "A single sequence",
                    ("A tuple with a sequence", "And its pair"),
                    [ "A", "pre", "tokenized", "sequence" ],
                    ([ "A", "pre", "tokenized", "sequence" ], "And its pair")
                ])

        Args:
            input (A :obj:`List`/:obj:`Tuple` of :obj:`~tokenizers.EncodeInput`):
                A list of single sequences or pair sequences to encode. Each sequence
                can be either raw text or pre-tokenized, according to the ``is_pretokenized``
                argument:

                - If ``is_pretokenized=False``: :class:`~tokenizers.TextEncodeInput`
                - If ``is_pretokenized=True``: :class:`~tokenizers.PreTokenizedEncodeInput`

            is_pretokenized (:obj:`bool`, defaults to :obj:`False`):
                Whether the input is already pre-tokenized

            add_special_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether to add the special tokens

        Returns:
            A :obj:`List` of :class:`~tokenizers.Encoding`: The encoded batch

        """
        pass

    @property
    def encode_special_tokens(self):
        """
        Modifies the tokenizer in order to use or not the special tokens
        during encoding.

        Args:
            value (:obj:`bool`):
                Whether to use the special tokens or not

        """
        pass

    @staticmethod
    def from_buffer(buffer):
        """
        Instantiate a new :class:`~tokenizers.Tokenizer` from the given buffer.

        Args:
            buffer (:obj:`bytes`):
                A buffer containing a previously serialized :class:`~tokenizers.Tokenizer`

        Returns:
            :class:`~tokenizers.Tokenizer`: The new tokenizer
        """
        pass

    @staticmethod
    def from_file(path):
        """
        Instantiate a new :class:`~tokenizers.Tokenizer` from the file at the given path.

        Args:
            path (:obj:`str`):
                A path to a local JSON file representing a previously serialized
                :class:`~tokenizers.Tokenizer`

        Returns:
            :class:`~tokenizers.Tokenizer`: The new tokenizer
        """
        pass

    @staticmethod
    def from_pretrained(identifier, revision="main", token=None):
        """
        Instantiate a new :class:`~tokenizers.Tokenizer` from an existing file on the
        Hugging Face Hub.

        Args:
            identifier (:obj:`str`):
                The identifier of a Model on the Hugging Face Hub, that contains
                a tokenizer.json file
            revision (:obj:`str`, defaults to `main`):
                A branch or commit id
            token (:obj:`str`, `optional`, defaults to `None`):
                An optional auth token used to access private repositories on the
                Hugging Face Hub

        Returns:
            :class:`~tokenizers.Tokenizer`: The new tokenizer
        """
        pass

    @staticmethod
    def from_str(json):
        """
        Instantiate a new :class:`~tokenizers.Tokenizer` from the given JSON string.

        Args:
            json (:obj:`str`):
                A valid JSON string representing a previously serialized
                :class:`~tokenizers.Tokenizer`

        Returns:
            :class:`~tokenizers.Tokenizer`: The new tokenizer
        """
        pass

    def get_added_tokens_decoder(self):
        """
        Get the underlying vocabulary

        Returns:
            :obj:`Dict[int, AddedToken]`: The vocabulary
        """
        pass

    def get_vocab(self, with_added_tokens=True):
        """
        Get the underlying vocabulary

        Args:
            with_added_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether to include the added tokens

        Returns:
            :obj:`Dict[str, int]`: The vocabulary
        """
        pass

    def get_vocab_size(self, with_added_tokens=True):
        """
        Get the size of the underlying vocabulary

        Args:
            with_added_tokens (:obj:`bool`, defaults to :obj:`True`):
                Whether to include the added tokens

        Returns:
            :obj:`int`: The size of the vocabulary
        """
        pass

    def id_to_token(self, id):
        """
        Convert the given id to its corresponding token if it exists

        Args:
            id (:obj:`int`):
                The id to convert

        Returns:
            :obj:`Optional[str]`: An optional token, :obj:`None` if out of vocabulary
        """
        pass

    @property
    def model(self):
        """
        The :class:`~tokenizers.models.Model` in use by the Tokenizer
        """
        pass

    def no_padding(self):
        """
        Disable padding
        """
        pass

    def no_truncation(self):
        """
        Disable truncation
        """
        pass

    @property
    def normalizer(self):
        """
        The `optional` :class:`~tokenizers.normalizers.Normalizer` in use by the Tokenizer
        """
        pass

    def num_special_tokens_to_add(self, is_pair):
        """
        Return the number of special tokens that would be added for single/pair sentences.
        :param is_pair: Boolean indicating if the input would be a single sentence or a pair
        :return:
        """
        pass

    @property
    def padding(self):
        """
        Get the current padding parameters

        `Cannot be set, use` :meth:`~tokenizers.Tokenizer.enable_padding` `instead`

        Returns:
            (:obj:`dict`, `optional`):
                A dict with the current padding parameters if padding is enabled
        """
        pass

    def post_process(self, encoding, pair=None, add_special_tokens=True):
        """
        Apply all the post-processing steps to the given encodings.

        The various steps are:

            1. Truncate according to the set truncation params (provided with
               :meth:`~tokenizers.Tokenizer.enable_truncation`)
            2. Apply the :class:`~tokenizers.processors.PostProcessor`
            3. Pad according to the set padding params (provided with
               :meth:`~tokenizers.Tokenizer.enable_padding`)

        Args:
            encoding (:class:`~tokenizers.Encoding`):
                The :class:`~tokenizers.Encoding` corresponding to the main sequence.

            pair (:class:`~tokenizers.Encoding`, `optional`):
                An optional :class:`~tokenizers.Encoding` corresponding to the pair sequence.

            add_special_tokens (:obj:`bool`):
                Whether to add the special tokens

        Returns:
            :class:`~tokenizers.Encoding`: The final post-processed encoding
        """
        pass

    @property
    def post_processor(self):
        """
        The `optional` :class:`~tokenizers.processors.PostProcessor` in use by the Tokenizer
        """
        pass

    @property
    def pre_tokenizer(self):
        """
        The `optional` :class:`~tokenizers.pre_tokenizers.PreTokenizer` in use by the Tokenizer
        """
        pass

    def save(self, path, pretty=True):
        """
        Save the :class:`~tokenizers.Tokenizer` to the file at the given path.

        Args:
            path (:obj:`str`):
                A path to a file in which to save the serialized tokenizer.

            pretty (:obj:`bool`, defaults to :obj:`True`):
                Whether the JSON file should be pretty formatted.
        """
        pass

    def to_str(self, pretty=False):
        """
        Gets a serialized string representing this :class:`~tokenizers.Tokenizer`.

        Args:
            pretty (:obj:`bool`, defaults to :obj:`False`):
                Whether the JSON string should be pretty formatted.

        Returns:
            :obj:`str`: A string representing the serialized Tokenizer
        """
        pass

    def token_to_id(self, token):
        """
        Convert the given token to its corresponding id if it exists

        Args:
            token (:obj:`str`):
                The token to convert

        Returns:
            :obj:`Optional[int]`: An optional id, :obj:`None` if out of vocabulary
        """
        pass

    def train(self, files, trainer=None):
        """
        Train the Tokenizer using the given files.

        Reads the files line by line, while keeping all the whitespace, even new lines.
        If you want to train from data store in-memory, you can check
        :meth:`~tokenizers.Tokenizer.train_from_iterator`

        Args:
            files (:obj:`List[str]`):
                A list of path to the files that we should use for training

            trainer (:obj:`~tokenizers.trainers.Trainer`, `optional`):
                An optional trainer that should be used to train our Model
        """
        pass

    def train_from_iterator(self, iterator, trainer=None, length=None):
        """
        Train the Tokenizer using the provided iterator.

        You can provide anything that is a Python Iterator

            * A list of sequences :obj:`List[str]`
            * A generator that yields :obj:`str` or :obj:`List[str]`
            * A Numpy array of strings
            * ...

        Args:
            iterator (:obj:`Iterator`):
                Any iterator over strings or list of strings

            trainer (:obj:`~tokenizers.trainers.Trainer`, `optional`):
                An optional trainer that should be used to train our Model

            length (:obj:`int`, `optional`):
                The total number of sequences in the iterator. This is used to
                provide meaningful progress tracking
        """
        pass

    @property
    def truncation(self):
        """
        Get the currently set truncation parameters

        `Cannot set, use` :meth:`~tokenizers.Tokenizer.enable_truncation` `instead`

        Returns:
            (:obj:`dict`, `optional`):
                A dict with the current truncation parameters if truncation is enabled
        """
        pass

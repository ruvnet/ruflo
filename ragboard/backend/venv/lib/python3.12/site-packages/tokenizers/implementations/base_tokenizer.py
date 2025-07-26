from typing import Dict, List, Optional, Tuple, Union

from tokenizers import AddedToken, EncodeInput, Encoding, InputSequence, Tokenizer
from tokenizers.decoders import Decoder
from tokenizers.models import Model
from tokenizers.normalizers import Normalizer
from tokenizers.pre_tokenizers import PreTokenizer
from tokenizers.processors import PostProcessor


Offsets = Tuple[int, int]


class BaseTokenizer:
    def __init__(self, tokenizer: Tokenizer, parameters=None):
        self._tokenizer = tokenizer
        self._parameters = parameters if parameters is not None else {}

    def __repr__(self):
        return "Tokenizer(vocabulary_size={}, {})".format(
            self._tokenizer.get_vocab_size(),
            ", ".join(k + "=" + str(v) for k, v in self._parameters.items()),
        )

    def num_special_tokens_to_add(self, is_pair: bool) -> int:
        """
        Return the number of special tokens that would be added for single/pair sentences.
        :param is_pair: Boolean indicating if the input would be a single sentence or a pair
        :return:
        """
        return self._tokenizer.num_special_tokens_to_add(is_pair)

    def get_vocab(self, with_added_tokens: bool = True) -> Dict[str, int]:
        """Returns the vocabulary

        Args:
            with_added_tokens: boolean:
                Whether to include the added tokens in the vocabulary

        Returns:
            The vocabulary
        """
        return self._tokenizer.get_vocab(with_added_tokens=with_added_tokens)

    def get_added_tokens_decoder(self) -> Dict[int, AddedToken]:
        """Returns the added reverse vocabulary

        Returns:
            The added vocabulary mapping ints to AddedTokens
        """
        return self._tokenizer.get_added_tokens_decoder()

    def get_vocab_size(self, with_added_tokens: bool = True) -> int:
        """Return the size of vocabulary, with or without added tokens.

        Args:
            with_added_tokens: (`optional`) bool:
                Whether to count in added special tokens or not

        Returns:
            Size of vocabulary
        """
        return self._tokenizer.get_vocab_size(with_added_tokens=with_added_tokens)

    def enable_padding(
        self,
        direction: Optional[str] = "right",
        pad_to_multiple_of: Optional[int] = None,
        pad_id: Optional[int] = 0,
        pad_type_id: Optional[int] = 0,
        pad_token: Optional[str] = "[PAD]",
        length: Optional[int] = None,
    ):
        """Change the padding strategy

        Args:
            direction: (`optional`) str:
                Can be one of: `right` or `left`

            pad_to_multiple_of: (`optional`) unsigned int:
                If specified, the padding length should always snap to the next multiple of
                the given value. For example if we were going to pad with a length of 250 but
                `pad_to_multiple_of=8` then we will pad to 256.

            pad_id: (`optional`) unsigned int:
                The indice to be used when padding

            pad_type_id: (`optional`) unsigned int:
                The type indice to be used when padding

            pad_token: (`optional`) str:
                The pad token to be used when padding

            length: (`optional`) unsigned int:
                If specified, the length at which to pad. If not specified
                we pad using the size of the longest sequence in a batch
        """
        return self._tokenizer.enable_padding(
            direction=direction,
            pad_to_multiple_of=pad_to_multiple_of,
            pad_id=pad_id,
            pad_type_id=pad_type_id,
            pad_token=pad_token,
            length=length,
        )

    def no_padding(self):
        """Disable padding"""
        return self._tokenizer.no_padding()

    @property
    def padding(self) -> Optional[dict]:
        """Get the current padding parameters

        Returns:
            None if padding is disabled, a dict with the currently set parameters
            if the padding is enabled.
        """
        return self._tokenizer.padding

    def enable_truncation(self, max_length: int, stride: Optional[int] = 0, strategy: Optional[str] = "longest_first"):
        """Change the truncation options

        Args:
            max_length: unsigned int:
                The maximum length at which to truncate

            stride: (`optional`) unsigned int:
                The length of the previous first sequence to be included
                in the overflowing sequence

            strategy: (`optional`) str:
                Can be one of `longest_first`, `only_first` or `only_second`
        """
        return self._tokenizer.enable_truncation(max_length, stride=stride, strategy=strategy)

    def no_truncation(self):
        """Disable truncation"""
        return self._tokenizer.no_truncation()

    @property
    def truncation(self) -> Optional[dict]:
        """Get the current truncation parameters

        Returns:
            None if truncation is disabled, a dict with the current truncation parameters if
            truncation is enabled
        """
        return self._tokenizer.truncation

    def add_tokens(self, tokens: List[Union[str, AddedToken]]) -> int:
        """Add the given tokens to the vocabulary

        Args:
            tokens: List[Union[str, AddedToken]]:
                A list of tokens to add to the vocabulary. Each token can either be
                a string, or an instance of AddedToken

        Returns:
            The number of tokens that were added to the vocabulary
        """
        return self._tokenizer.add_tokens(tokens)

    def add_special_tokens(self, special_tokens: List[Union[str, AddedToken]]) -> int:
        """Add the given special tokens to the vocabulary, and treat them as special tokens.

        The special tokens will never be processed by the model, and will be
        removed while decoding.

        Args:
            tokens: List[Union[str, AddedToken]]:
                A list of special tokens to add to the vocabulary. Each token can either be
                a string, or an instance of AddedToken

        Returns:
            The number of tokens that were added to the vocabulary
        """
        return self._tokenizer.add_special_tokens(special_tokens)

    def normalize(self, sequence: str) -> str:
        """Normalize the given sequence

        Args:
            sequence: str:
                The sequence to normalize

        Returns:
            The normalized string
        """
        return self._tokenizer.normalize(sequence)

    def encode(
        self,
        sequence: InputSequence,
        pair: Optional[InputSequence] = None,
        is_pretokenized: bool = False,
        add_special_tokens: bool = True,
    ) -> Encoding:
        """Encode the given sequence and pair. This method can process raw text sequences as well
        as already pre-tokenized sequences.

        Args:
            sequence: InputSequence:
                The sequence we want to encode. This sequence can be either raw text or
                pre-tokenized, according to the `is_pretokenized` argument:

                - If `is_pretokenized=False`: `InputSequence` is expected to be `str`
                - If `is_pretokenized=True`: `InputSequence` is expected to be
                    `Union[List[str], Tuple[str]]`

            is_pretokenized: bool:
                Whether the input is already pre-tokenized.

            add_special_tokens: bool:
                Whether to add the special tokens while encoding.

        Returns:
            An Encoding
        """
        if sequence is None:
            raise ValueError("encode: `sequence` can't be `None`")

        return self._tokenizer.encode(sequence, pair, is_pretokenized, add_special_tokens)

    def encode_batch(
        self,
        inputs: List[EncodeInput],
        is_pretokenized: bool = False,
        add_special_tokens: bool = True,
    ) -> List[Encoding]:
        """Encode the given inputs. This method accept both raw text sequences as well as already
        pre-tokenized sequences.

        Args:
            inputs: List[EncodeInput]:
                A list of single sequences or pair sequences to encode. Each `EncodeInput` is
                expected to be of the following form:
                    `Union[InputSequence, Tuple[InputSequence, InputSequence]]`

                Each `InputSequence` can either be raw text or pre-tokenized,
                according to the `is_pretokenized` argument:

                - If `is_pretokenized=False`: `InputSequence` is expected to be `str`
                - If `is_pretokenized=True`: `InputSequence` is expected to be
                    `Union[List[str], Tuple[str]]`

            is_pretokenized: bool:
                Whether the input is already pre-tokenized.

            add_special_tokens: bool:
                Whether to add the special tokens while encoding.

        Returns:
            A list of Encoding
        """

        if inputs is None:
            raise ValueError("encode_batch: `inputs` can't be `None`")

        return self._tokenizer.encode_batch(inputs, is_pretokenized, add_special_tokens)

    def decode(self, ids: List[int], skip_special_tokens: Optional[bool] = True) -> str:
        """Decode the given list of ids to a string sequence

        Args:
            ids: List[unsigned int]:
                A list of ids to be decoded

            skip_special_tokens: (`optional`) boolean:
                Whether to remove all the special tokens from the output string

        Returns:
            The decoded string
        """
        if ids is None:
            raise ValueError("None input is not valid. Should be a list of integers.")

        return self._tokenizer.decode(ids, skip_special_tokens=skip_special_tokens)

    def decode_batch(self, sequences: List[List[int]], skip_special_tokens: Optional[bool] = True) -> str:
        """Decode the list of sequences to a list of string sequences

        Args:
            sequences: List[List[unsigned int]]:
                A list of sequence of ids to be decoded

            skip_special_tokens: (`optional`) boolean:
                Whether to remove all the special tokens from the output strings

        Returns:
            A list of decoded strings
        """
        if sequences is None:
            raise ValueError("None input is not valid. Should be list of list of integers.")

        return self._tokenizer.decode_batch(sequences, skip_special_tokens=skip_special_tokens)

    def token_to_id(self, token: str) -> Optional[int]:
        """Convert the given token to its corresponding id

        Args:
            token: str:
                The token to convert

        Returns:
            The corresponding id if it exists, None otherwise
        """
        return self._tokenizer.token_to_id(token)

    def id_to_token(self, id: int) -> Optional[str]:
        """Convert the given token id to its corresponding string

        Args:
            token: id:
                The token id to convert

        Returns:
            The corresponding string if it exists, None otherwise
        """
        return self._tokenizer.id_to_token(id)

    def save_model(self, directory: str, prefix: Optional[str] = None):
        """Save the current model to the given directory

        Args:
            directory: str:
                A path to the destination directory

            prefix: (Optional) str:
                An optional prefix, used to prefix each file name
        """
        return self._tokenizer.model.save(directory, prefix=prefix)

    def save(self, path: str, pretty: bool = True):
        """Save the current Tokenizer at the given path

        Args:
            path: str:
                A path to the destination Tokenizer file
        """
        return self._tokenizer.save(path, pretty)

    def to_str(self, pretty: bool = False):
        """Get a serialized JSON version of the Tokenizer as a str

        Args:
            pretty: bool:
                Whether the JSON string should be prettified

        Returns:
            str
        """
        return self._tokenizer.to_str(pretty)

    def post_process(
        self, encoding: Encoding, pair: Optional[Encoding] = None, add_special_tokens: bool = True
    ) -> Encoding:
        """Apply all the post-processing steps to the given encodings.

        The various steps are:
            1. Truncate according to global params (provided to `enable_truncation`)
            2. Apply the PostProcessor
            3. Pad according to global params. (provided to `enable_padding`)

        Args:
            encoding: Encoding:
                The main Encoding to post process

            pair: Optional[Encoding]:
                An optional pair Encoding

            add_special_tokens: bool:
                Whether to add special tokens

        Returns:
            The resulting Encoding
        """
        return self._tokenizer.post_process(encoding, pair, add_special_tokens)

    @property
    def model(self) -> Model:
        return self._tokenizer.model

    @model.setter
    def model(self, model: Model):
        self._tokenizer.model = model

    @property
    def normalizer(self) -> Normalizer:
        return self._tokenizer.normalizer

    @normalizer.setter
    def normalizer(self, normalizer: Normalizer):
        self._tokenizer.normalizer = normalizer

    @property
    def pre_tokenizer(self) -> PreTokenizer:
        return self._tokenizer.pre_tokenizer

    @pre_tokenizer.setter
    def pre_tokenizer(self, pre_tokenizer: PreTokenizer):
        self._tokenizer.pre_tokenizer = pre_tokenizer

    @property
    def post_processor(self) -> PostProcessor:
        return self._tokenizer.post_processor

    @post_processor.setter
    def post_processor(self, post_processor: PostProcessor):
        self._tokenizer.post_processor = post_processor

    @property
    def decoder(self) -> Decoder:
        return self._tokenizer.decoder

    @decoder.setter
    def decoder(self, decoder: Decoder):
        self._tokenizer.decoder = decoder

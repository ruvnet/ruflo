from typing import Dict, Iterator, List, Optional, Tuple, Union

from .. import AddedToken, Tokenizer, decoders, pre_tokenizers, trainers
from ..models import BPE
from ..normalizers import BertNormalizer, Lowercase, Sequence, unicode_normalizer_from_str
from .base_tokenizer import BaseTokenizer


class CharBPETokenizer(BaseTokenizer):
    """Original BPE Tokenizer

    Represents the BPE algorithm, as introduced by Rico Sennrich
    (https://arxiv.org/abs/1508.07909)

    The defaults settings corresponds to OpenAI GPT BPE tokenizers and differs from the original
    Sennrich subword-nmt implementation by the following options that you can deactivate:
        - adding a normalizer to clean up the text (deactivate with `bert_normalizer=False`) by:
            * removing any control characters and replacing all whitespaces by the classic one.
            * handle chinese chars by putting spaces around them.
            * strip all accents.
        - spitting on punctuation in addition to whitespaces (deactivate it with
          `split_on_whitespace_only=True`)
    """

    def __init__(
        self,
        vocab: Optional[Union[str, Dict[str, int]]] = None,
        merges: Optional[Union[str, List[Tuple[str, str]]]] = None,
        unk_token: Union[str, AddedToken] = "<unk>",
        suffix: str = "</w>",
        dropout: Optional[float] = None,
        lowercase: bool = False,
        unicode_normalizer: Optional[str] = None,
        bert_normalizer: bool = True,
        split_on_whitespace_only: bool = False,
    ):
        if vocab is not None and merges is not None:
            tokenizer = Tokenizer(
                BPE(
                    vocab,
                    merges,
                    dropout=dropout,
                    unk_token=str(unk_token),
                    end_of_word_suffix=suffix,
                )
            )
        else:
            tokenizer = Tokenizer(BPE(unk_token=str(unk_token), dropout=dropout, end_of_word_suffix=suffix))

        if tokenizer.token_to_id(str(unk_token)) is not None:
            tokenizer.add_special_tokens([str(unk_token)])

        # Check for Unicode normalization first (before everything else)
        normalizers = []

        if unicode_normalizer:
            normalizers += [unicode_normalizer_from_str(unicode_normalizer)]

        if bert_normalizer:
            normalizers += [BertNormalizer(lowercase=False)]

        if lowercase:
            normalizers += [Lowercase()]

        # Create the normalizer structure
        if len(normalizers) > 0:
            if len(normalizers) > 1:
                tokenizer.normalizer = Sequence(normalizers)
            else:
                tokenizer.normalizer = normalizers[0]

        if split_on_whitespace_only:
            tokenizer.pre_tokenizer = pre_tokenizers.WhitespaceSplit()
        else:
            tokenizer.pre_tokenizer = pre_tokenizers.BertPreTokenizer()

        tokenizer.decoder = decoders.BPEDecoder(suffix=suffix)

        parameters = {
            "model": "BPE",
            "unk_token": unk_token,
            "suffix": suffix,
            "dropout": dropout,
            "lowercase": lowercase,
            "unicode_normalizer": unicode_normalizer,
            "bert_normalizer": bert_normalizer,
            "split_on_whitespace_only": split_on_whitespace_only,
        }

        super().__init__(tokenizer, parameters)

    @staticmethod
    def from_file(vocab_filename: str, merges_filename: str, **kwargs):
        vocab, merges = BPE.read_file(vocab_filename, merges_filename)
        return CharBPETokenizer(vocab, merges, **kwargs)

    def train(
        self,
        files: Union[str, List[str]],
        vocab_size: int = 30000,
        min_frequency: int = 2,
        special_tokens: List[Union[str, AddedToken]] = ["<unk>"],
        limit_alphabet: int = 1000,
        initial_alphabet: List[str] = [],
        suffix: Optional[str] = "</w>",
        show_progress: bool = True,
    ):
        """Train the model using the given files"""

        trainer = trainers.BpeTrainer(
            vocab_size=vocab_size,
            min_frequency=min_frequency,
            special_tokens=special_tokens,
            limit_alphabet=limit_alphabet,
            initial_alphabet=initial_alphabet,
            end_of_word_suffix=suffix,
            show_progress=show_progress,
        )
        if isinstance(files, str):
            files = [files]
        self._tokenizer.train(files, trainer=trainer)

    def train_from_iterator(
        self,
        iterator: Union[Iterator[str], Iterator[Iterator[str]]],
        vocab_size: int = 30000,
        min_frequency: int = 2,
        special_tokens: List[Union[str, AddedToken]] = ["<unk>"],
        limit_alphabet: int = 1000,
        initial_alphabet: List[str] = [],
        suffix: Optional[str] = "</w>",
        show_progress: bool = True,
        length: Optional[int] = None,
    ):
        """Train the model using the given iterator"""

        trainer = trainers.BpeTrainer(
            vocab_size=vocab_size,
            min_frequency=min_frequency,
            special_tokens=special_tokens,
            limit_alphabet=limit_alphabet,
            initial_alphabet=initial_alphabet,
            end_of_word_suffix=suffix,
            show_progress=show_progress,
        )
        self._tokenizer.train_from_iterator(
            iterator,
            trainer=trainer,
            length=length,
        )

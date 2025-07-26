from typing import Dict, Iterator, List, Optional, Tuple, Union

from tokenizers import AddedToken, Tokenizer, decoders, pre_tokenizers, trainers
from tokenizers.models import BPE
from tokenizers.normalizers import NFKC

from .base_tokenizer import BaseTokenizer


class SentencePieceBPETokenizer(BaseTokenizer):
    """SentencePiece BPE Tokenizer

    Represents the BPE algorithm, with the pretokenization used by SentencePiece
    """

    def __init__(
        self,
        vocab: Optional[Union[str, Dict[str, int]]] = None,
        merges: Optional[Union[str, List[Tuple[str, str]]]] = None,
        unk_token: Union[str, AddedToken] = "<unk>",
        replacement: str = "▁",
        add_prefix_space: bool = True,
        dropout: Optional[float] = None,
        fuse_unk: Optional[bool] = False,
    ):
        if vocab is not None and merges is not None:
            tokenizer = Tokenizer(BPE(vocab, merges, dropout=dropout, unk_token=unk_token, fuse_unk=fuse_unk))
        else:
            tokenizer = Tokenizer(BPE(dropout=dropout, unk_token=unk_token, fuse_unk=fuse_unk))

        if tokenizer.token_to_id(str(unk_token)) is not None:
            tokenizer.add_special_tokens([str(unk_token)])

        tokenizer.normalizer = NFKC()
        prepend_scheme = "always" if add_prefix_space else "never"
        tokenizer.pre_tokenizer = pre_tokenizers.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)
        tokenizer.decoder = decoders.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)

        parameters = {
            "model": "SentencePieceBPE",
            "unk_token": unk_token,
            "replacement": replacement,
            "add_prefix_space": add_prefix_space,
            "dropout": dropout,
        }

        super().__init__(tokenizer, parameters)

    @staticmethod
    def from_file(vocab_filename: str, merges_filename: str, **kwargs):
        vocab, merges = BPE.read_file(vocab_filename, merges_filename)
        return SentencePieceBPETokenizer(vocab, merges, **kwargs)

    def train(
        self,
        files: Union[str, List[str]],
        vocab_size: int = 30000,
        min_frequency: int = 2,
        special_tokens: List[Union[str, AddedToken]] = ["<unk>"],
        limit_alphabet: int = 1000,
        initial_alphabet: List[str] = [],
        show_progress: bool = True,
    ):
        """Train the model using the given files"""

        trainer = trainers.BpeTrainer(
            vocab_size=vocab_size,
            min_frequency=min_frequency,
            special_tokens=special_tokens,
            limit_alphabet=limit_alphabet,
            initial_alphabet=initial_alphabet,
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
            show_progress=show_progress,
        )
        self._tokenizer.train_from_iterator(
            iterator,
            trainer=trainer,
            length=length,
        )

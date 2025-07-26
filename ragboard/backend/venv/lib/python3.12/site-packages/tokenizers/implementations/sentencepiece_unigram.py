import json
import os
from typing import Iterator, List, Optional, Union, Tuple

from tokenizers import AddedToken, Regex, Tokenizer, decoders, normalizers, pre_tokenizers, trainers
from tokenizers.models import Unigram

from .base_tokenizer import BaseTokenizer


class SentencePieceUnigramTokenizer(BaseTokenizer):
    """SentencePiece Unigram Tokenizer

    Represents the Unigram algorithm, with the pretokenization used by SentencePiece
    """

    def __init__(
        self,
        vocab: Optional[List[Tuple[str, float]]] = None,
        replacement: str = "▁",
        add_prefix_space: bool = True,
    ):
        if vocab is not None:
            # Let Unigram(..) fail if only one of them is None
            tokenizer = Tokenizer(Unigram(vocab))
        else:
            tokenizer = Tokenizer(Unigram())

        tokenizer.normalizer = normalizers.Sequence(
            [normalizers.Nmt(), normalizers.NFKC(), normalizers.Replace(Regex(" {2,}"), " ")]
        )
        prepend_scheme = "always" if add_prefix_space else "never"
        tokenizer.pre_tokenizer = pre_tokenizers.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)
        tokenizer.decoder = decoders.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)

        parameters = {
            "model": "SentencePieceUnigram",
            "replacement": replacement,
            "add_prefix_space": add_prefix_space,
        }

        super().__init__(tokenizer, parameters)

    def train(
        self,
        files: Union[str, List[str]],
        vocab_size: int = 8000,
        show_progress: bool = True,
        special_tokens: Optional[List[Union[str, AddedToken]]] = None,
        initial_alphabet: Optional[List[str]] = None,
        unk_token: Optional[str] = None,
    ):
        """
        Train the model using the given files

        Args:
            files (:obj:`List[str]`):
                A list of path to the files that we should use for training
            vocab_size (:obj:`int`):
                The size of the final vocabulary, including all tokens and alphabet.
            show_progress (:obj:`bool`):
                Whether to show progress bars while training.
            special_tokens (:obj:`List[Union[str, AddedToken]]`, `optional`):
                A list of special tokens the model should know of.
            initial_alphabet (:obj:`List[str]`, `optional`):
                A list of characters to include in the initial alphabet, even
                if not seen in the training dataset.
                If the strings contain more than one character, only the first one
                is kept.
            unk_token (:obj:`str`, `optional`):
                The unknown token to be used by the model.
        """

        if special_tokens is None:
            special_tokens = []

        if initial_alphabet is None:
            initial_alphabet = []

        trainer = trainers.UnigramTrainer(
            vocab_size=vocab_size,
            special_tokens=special_tokens,
            show_progress=show_progress,
            initial_alphabet=initial_alphabet,
            unk_token=unk_token,
        )

        if isinstance(files, str):
            files = [files]
        self._tokenizer.train(files, trainer=trainer)

    def train_from_iterator(
        self,
        iterator: Union[Iterator[str], Iterator[Iterator[str]]],
        vocab_size: int = 8000,
        show_progress: bool = True,
        special_tokens: Optional[List[Union[str, AddedToken]]] = None,
        initial_alphabet: Optional[List[str]] = None,
        unk_token: Optional[str] = None,
        length: Optional[int] = None,
    ):
        """
        Train the model using the given iterator

        Args:
            iterator (:obj:`Union[Iterator[str], Iterator[Iterator[str]]]`):
                Any iterator over strings or list of strings
            vocab_size (:obj:`int`):
                The size of the final vocabulary, including all tokens and alphabet.
            show_progress (:obj:`bool`):
                Whether to show progress bars while training.
            special_tokens (:obj:`List[Union[str, AddedToken]]`, `optional`):
                A list of special tokens the model should know of.
            initial_alphabet (:obj:`List[str]`, `optional`):
                A list of characters to include in the initial alphabet, even
                if not seen in the training dataset.
                If the strings contain more than one character, only the first one
                is kept.
            unk_token (:obj:`str`, `optional`):
                The unknown token to be used by the model.
            length (:obj:`int`, `optional`):
                The total number of sequences in the iterator. This is used to
                provide meaningful progress tracking
        """

        if special_tokens is None:
            special_tokens = []

        if initial_alphabet is None:
            initial_alphabet = []

        trainer = trainers.UnigramTrainer(
            vocab_size=vocab_size,
            special_tokens=special_tokens,
            show_progress=show_progress,
            initial_alphabet=initial_alphabet,
            unk_token=unk_token,
        )

        self._tokenizer.train_from_iterator(
            iterator,
            trainer=trainer,
            length=length,
        )

    @staticmethod
    def from_spm(filename: str):
        try:
            import sys

            sys.path.append(".")

            import sentencepiece_model_pb2 as model
        except Exception:
            raise Exception(
                "You don't seem to have the required protobuf file, in order to use this function you need to run `pip install protobuf` and `wget https://raw.githubusercontent.com/google/sentencepiece/master/python/src/sentencepiece/sentencepiece_model_pb2.py` for us to be able to read the intrinsics of your spm_file. `pip install sentencepiece` is not required."
            )

        m = model.ModelProto()
        m.ParseFromString(open(filename, "rb").read())

        precompiled_charsmap = m.normalizer_spec.precompiled_charsmap
        vocab = [(piece.piece, piece.score) for piece in m.pieces]
        unk_id = m.trainer_spec.unk_id
        model_type = m.trainer_spec.model_type
        byte_fallback = m.trainer_spec.byte_fallback
        if model_type != 1:
            raise Exception(
                "You're trying to run a `Unigram` model but you're file was trained with a different algorithm"
            )

        replacement = "▁"
        add_prefix_space = True

        tokenizer = Tokenizer(Unigram(vocab, unk_id, byte_fallback))

        if precompiled_charsmap:
            tokenizer.normalizer = normalizers.Sequence(
                [
                    normalizers.Precompiled(precompiled_charsmap),
                    normalizers.Replace(Regex(" {2,}"), " "),
                ]
            )
        else:
            tokenizer.normalizer = normalizers.Sequence([normalizers.Replace(Regex(" {2,}"), " ")])
        prepend_scheme = "always" if add_prefix_space else "never"
        tokenizer.pre_tokenizer = pre_tokenizers.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)
        tokenizer.decoder = decoders.Metaspace(replacement=replacement, prepend_scheme=prepend_scheme)

        parameters = {
            "model": "SentencePieceUnigram",
        }

        obj = BaseTokenizer.__new__(SentencePieceUnigramTokenizer, tokenizer, parameters)
        BaseTokenizer.__init__(obj, tokenizer, parameters)
        return obj

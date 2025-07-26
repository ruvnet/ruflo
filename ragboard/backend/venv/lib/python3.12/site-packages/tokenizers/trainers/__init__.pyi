# Generated content DO NOT EDIT
class Trainer:
    """
    Base class for all trainers

    This class is not supposed to be instantiated directly. Instead, any implementation of a
    Trainer will return an instance of this class when instantiated.
    """

class BpeTrainer(Trainer):
    """
    Trainer capable of training a BPE model

    Args:
        vocab_size (:obj:`int`, `optional`):
            The size of the final vocabulary, including all tokens and alphabet.

        min_frequency (:obj:`int`, `optional`):
            The minimum frequency a pair should have in order to be merged.

        show_progress (:obj:`bool`, `optional`):
            Whether to show progress bars while training.

        special_tokens (:obj:`List[Union[str, AddedToken]]`, `optional`):
            A list of special tokens the model should know of.

        limit_alphabet (:obj:`int`, `optional`):
            The maximum different characters to keep in the alphabet.

        initial_alphabet (:obj:`List[str]`, `optional`):
            A list of characters to include in the initial alphabet, even
            if not seen in the training dataset.
            If the strings contain more than one character, only the first one
            is kept.

        continuing_subword_prefix (:obj:`str`, `optional`):
            A prefix to be used for every subword that is not a beginning-of-word.

        end_of_word_suffix (:obj:`str`, `optional`):
            A suffix to be used for every subword that is a end-of-word.

        max_token_length (:obj:`int`, `optional`):
            Prevents creating tokens longer than the specified size.
            This can help with reducing polluting your vocabulary with
            highly repetitive tokens like `======` for wikipedia

    """

class UnigramTrainer(Trainer):
    """
    Trainer capable of training a Unigram model

    Args:
        vocab_size (:obj:`int`):
            The size of the final vocabulary, including all tokens and alphabet.

        show_progress (:obj:`bool`):
            Whether to show progress bars while training.

        special_tokens (:obj:`List[Union[str, AddedToken]]`):
            A list of special tokens the model should know of.

        initial_alphabet (:obj:`List[str]`):
            A list of characters to include in the initial alphabet, even
            if not seen in the training dataset.
            If the strings contain more than one character, only the first one
            is kept.

        shrinking_factor (:obj:`float`):
            The shrinking factor used at each step of the training to prune the
            vocabulary.

        unk_token (:obj:`str`):
            The token used for out-of-vocabulary tokens.

        max_piece_length (:obj:`int`):
            The maximum length of a given token.

        n_sub_iterations (:obj:`int`):
            The number of iterations of the EM algorithm to perform before
            pruning the vocabulary.
    """
    def __init__(
        self,
        vocab_size=8000,
        show_progress=True,
        special_tokens=[],
        shrinking_factor=0.75,
        unk_token=None,
        max_piece_length=16,
        n_sub_iterations=2,
    ):
        pass

class WordLevelTrainer(Trainer):
    """
    Trainer capable of training a WorldLevel model

    Args:
        vocab_size (:obj:`int`, `optional`):
            The size of the final vocabulary, including all tokens and alphabet.

        min_frequency (:obj:`int`, `optional`):
            The minimum frequency a pair should have in order to be merged.

        show_progress (:obj:`bool`, `optional`):
            Whether to show progress bars while training.

        special_tokens (:obj:`List[Union[str, AddedToken]]`):
            A list of special tokens the model should know of.
    """

class WordPieceTrainer(Trainer):
    """
    Trainer capable of training a WordPiece model

    Args:
        vocab_size (:obj:`int`, `optional`):
            The size of the final vocabulary, including all tokens and alphabet.

        min_frequency (:obj:`int`, `optional`):
            The minimum frequency a pair should have in order to be merged.

        show_progress (:obj:`bool`, `optional`):
            Whether to show progress bars while training.

        special_tokens (:obj:`List[Union[str, AddedToken]]`, `optional`):
            A list of special tokens the model should know of.

        limit_alphabet (:obj:`int`, `optional`):
            The maximum different characters to keep in the alphabet.

        initial_alphabet (:obj:`List[str]`, `optional`):
            A list of characters to include in the initial alphabet, even
            if not seen in the training dataset.
            If the strings contain more than one character, only the first one
            is kept.

        continuing_subword_prefix (:obj:`str`, `optional`):
            A prefix to be used for every subword that is not a beginning-of-word.

        end_of_word_suffix (:obj:`str`, `optional`):
            A suffix to be used for every subword that is a end-of-word.
    """
    def __init__(
        self,
        vocab_size=30000,
        min_frequency=0,
        show_progress=True,
        special_tokens=[],
        limit_alphabet=None,
        initial_alphabet=[],
        continuing_subword_prefix="##",
        end_of_word_suffix=None,
    ):
        pass

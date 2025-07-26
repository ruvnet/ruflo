# Generated content DO NOT EDIT
class Model:
    """
    Base class for all models

    The model represents the actual tokenization algorithm. This is the part that
    will contain and manage the learned vocabulary.

    This class cannot be constructed directly. Please use one of the concrete models.
    """
    def get_trainer(self):
        """
        Get the associated :class:`~tokenizers.trainers.Trainer`

        Retrieve the :class:`~tokenizers.trainers.Trainer` associated to this
        :class:`~tokenizers.models.Model`.

        Returns:
            :class:`~tokenizers.trainers.Trainer`: The Trainer used to train this model
        """
        pass

    def id_to_token(self, id):
        """
        Get the token associated to an ID

        Args:
            id (:obj:`int`):
                An ID to convert to a token

        Returns:
            :obj:`str`: The token associated to the ID
        """
        pass

    def save(self, folder, prefix):
        """
        Save the current model

        Save the current model in the given folder, using the given prefix for the various
        files that will get created.
        Any file with the same name that already exists in this folder will be overwritten.

        Args:
            folder (:obj:`str`):
                The path to the target folder in which to save the various files

            prefix (:obj:`str`, `optional`):
                An optional prefix, used to prefix each file name

        Returns:
            :obj:`List[str]`: The list of saved files
        """
        pass

    def token_to_id(self, tokens):
        """
        Get the ID associated to a token

        Args:
            token (:obj:`str`):
                A token to convert to an ID

        Returns:
            :obj:`int`: The ID associated to the token
        """
        pass

    def tokenize(self, sequence):
        """
        Tokenize a sequence

        Args:
            sequence (:obj:`str`):
                A sequence to tokenize

        Returns:
            A :obj:`List` of :class:`~tokenizers.Token`: The generated tokens
        """
        pass

class BPE(Model):
    """
    An implementation of the BPE (Byte-Pair Encoding) algorithm

    Args:
        vocab (:obj:`Dict[str, int]`, `optional`):
            A dictionary of string keys and their ids :obj:`{"am": 0,...}`

        merges (:obj:`List[Tuple[str, str]]`, `optional`):
            A list of pairs of tokens (:obj:`Tuple[str, str]`) :obj:`[("a", "b"),...]`

        cache_capacity (:obj:`int`, `optional`):
            The number of words that the BPE cache can contain. The cache allows
            to speed-up the process by keeping the result of the merge operations
            for a number of words.

        dropout (:obj:`float`, `optional`):
            A float between 0 and 1 that represents the BPE dropout to use.

        unk_token (:obj:`str`, `optional`):
            The unknown token to be used by the model.

        continuing_subword_prefix (:obj:`str`, `optional`):
            The prefix to attach to subword units that don't represent a beginning of word.

        end_of_word_suffix (:obj:`str`, `optional`):
            The suffix to attach to subword units that represent an end of word.

        fuse_unk (:obj:`bool`, `optional`):
            Whether to fuse any subsequent unknown tokens into a single one

        byte_fallback (:obj:`bool`, `optional`):
            Whether to use spm byte-fallback trick (defaults to False)

        ignore_merges (:obj:`bool`, `optional`):
            Whether or not to match tokens with the vocab before using merges.
    """
    def __init__(
        self,
        vocab=None,
        merges=None,
        cache_capacity=None,
        dropout=None,
        unk_token=None,
        continuing_subword_prefix=None,
        end_of_word_suffix=None,
        fuse_unk=None,
        byte_fallback=False,
        ignore_merges=False,
    ):
        pass

    @staticmethod
    def from_file(cls, vocab, merge, **kwargs):
        """
        Instantiate a BPE model from the given files.

        This method is roughly equivalent to doing::

           vocab, merges = BPE.read_file(vocab_filename, merges_filename)
           bpe = BPE(vocab, merges)

        If you don't need to keep the :obj:`vocab, merges` values lying around,
        this method is more optimized than manually calling
        :meth:`~tokenizers.models.BPE.read_file` to initialize a :class:`~tokenizers.models.BPE`

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.json` file

            merges (:obj:`str`):
                The path to a :obj:`merges.txt` file

        Returns:
            :class:`~tokenizers.models.BPE`: An instance of BPE loaded from these files
        """
        pass

    def get_trainer(self):
        """
        Get the associated :class:`~tokenizers.trainers.Trainer`

        Retrieve the :class:`~tokenizers.trainers.Trainer` associated to this
        :class:`~tokenizers.models.Model`.

        Returns:
            :class:`~tokenizers.trainers.Trainer`: The Trainer used to train this model
        """
        pass

    def id_to_token(self, id):
        """
        Get the token associated to an ID

        Args:
            id (:obj:`int`):
                An ID to convert to a token

        Returns:
            :obj:`str`: The token associated to the ID
        """
        pass

    @staticmethod
    def read_file(self, vocab, merges):
        """
        Read a :obj:`vocab.json` and a :obj:`merges.txt` files

        This method provides a way to read and parse the content of these files,
        returning the relevant data structures. If you want to instantiate some BPE models
        from memory, this method gives you the expected input from the standard files.

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.json` file

            merges (:obj:`str`):
                The path to a :obj:`merges.txt` file

        Returns:
            A :obj:`Tuple` with the vocab and the merges:
                The vocabulary and merges loaded into memory
        """
        pass

    def save(self, folder, prefix):
        """
        Save the current model

        Save the current model in the given folder, using the given prefix for the various
        files that will get created.
        Any file with the same name that already exists in this folder will be overwritten.

        Args:
            folder (:obj:`str`):
                The path to the target folder in which to save the various files

            prefix (:obj:`str`, `optional`):
                An optional prefix, used to prefix each file name

        Returns:
            :obj:`List[str]`: The list of saved files
        """
        pass

    def token_to_id(self, tokens):
        """
        Get the ID associated to a token

        Args:
            token (:obj:`str`):
                A token to convert to an ID

        Returns:
            :obj:`int`: The ID associated to the token
        """
        pass

    def tokenize(self, sequence):
        """
        Tokenize a sequence

        Args:
            sequence (:obj:`str`):
                A sequence to tokenize

        Returns:
            A :obj:`List` of :class:`~tokenizers.Token`: The generated tokens
        """
        pass

class Unigram(Model):
    """
    An implementation of the Unigram algorithm

    Args:
        vocab (:obj:`List[Tuple[str, float]]`, `optional`, `optional`):
            A list of vocabulary items and their relative score [("am", -0.2442),...]
    """
    def __init__(self, vocab, unk_id, byte_fallback):
        pass

    def get_trainer(self):
        """
        Get the associated :class:`~tokenizers.trainers.Trainer`

        Retrieve the :class:`~tokenizers.trainers.Trainer` associated to this
        :class:`~tokenizers.models.Model`.

        Returns:
            :class:`~tokenizers.trainers.Trainer`: The Trainer used to train this model
        """
        pass

    def id_to_token(self, id):
        """
        Get the token associated to an ID

        Args:
            id (:obj:`int`):
                An ID to convert to a token

        Returns:
            :obj:`str`: The token associated to the ID
        """
        pass

    def save(self, folder, prefix):
        """
        Save the current model

        Save the current model in the given folder, using the given prefix for the various
        files that will get created.
        Any file with the same name that already exists in this folder will be overwritten.

        Args:
            folder (:obj:`str`):
                The path to the target folder in which to save the various files

            prefix (:obj:`str`, `optional`):
                An optional prefix, used to prefix each file name

        Returns:
            :obj:`List[str]`: The list of saved files
        """
        pass

    def token_to_id(self, tokens):
        """
        Get the ID associated to a token

        Args:
            token (:obj:`str`):
                A token to convert to an ID

        Returns:
            :obj:`int`: The ID associated to the token
        """
        pass

    def tokenize(self, sequence):
        """
        Tokenize a sequence

        Args:
            sequence (:obj:`str`):
                A sequence to tokenize

        Returns:
            A :obj:`List` of :class:`~tokenizers.Token`: The generated tokens
        """
        pass

class WordLevel(Model):
    """
    An implementation of the WordLevel algorithm

    Most simple tokenizer model based on mapping tokens to their corresponding id.

    Args:
        vocab (:obj:`str`, `optional`):
            A dictionary of string keys and their ids :obj:`{"am": 0,...}`

        unk_token (:obj:`str`, `optional`):
            The unknown token to be used by the model.
    """
    def __init__(self, vocab, unk_token):
        pass

    @staticmethod
    def from_file(vocab, unk_token):
        """
        Instantiate a WordLevel model from the given file

        This method is roughly equivalent to doing::

            vocab = WordLevel.read_file(vocab_filename)
            wordlevel = WordLevel(vocab)

        If you don't need to keep the :obj:`vocab` values lying around, this method is
        more optimized than manually calling :meth:`~tokenizers.models.WordLevel.read_file` to
        initialize a :class:`~tokenizers.models.WordLevel`

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.json` file

        Returns:
            :class:`~tokenizers.models.WordLevel`: An instance of WordLevel loaded from file
        """
        pass

    def get_trainer(self):
        """
        Get the associated :class:`~tokenizers.trainers.Trainer`

        Retrieve the :class:`~tokenizers.trainers.Trainer` associated to this
        :class:`~tokenizers.models.Model`.

        Returns:
            :class:`~tokenizers.trainers.Trainer`: The Trainer used to train this model
        """
        pass

    def id_to_token(self, id):
        """
        Get the token associated to an ID

        Args:
            id (:obj:`int`):
                An ID to convert to a token

        Returns:
            :obj:`str`: The token associated to the ID
        """
        pass

    @staticmethod
    def read_file(vocab):
        """
        Read a :obj:`vocab.json`

        This method provides a way to read and parse the content of a vocabulary file,
        returning the relevant data structures. If you want to instantiate some WordLevel models
        from memory, this method gives you the expected input from the standard files.

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.json` file

        Returns:
            :obj:`Dict[str, int]`: The vocabulary as a :obj:`dict`
        """
        pass

    def save(self, folder, prefix):
        """
        Save the current model

        Save the current model in the given folder, using the given prefix for the various
        files that will get created.
        Any file with the same name that already exists in this folder will be overwritten.

        Args:
            folder (:obj:`str`):
                The path to the target folder in which to save the various files

            prefix (:obj:`str`, `optional`):
                An optional prefix, used to prefix each file name

        Returns:
            :obj:`List[str]`: The list of saved files
        """
        pass

    def token_to_id(self, tokens):
        """
        Get the ID associated to a token

        Args:
            token (:obj:`str`):
                A token to convert to an ID

        Returns:
            :obj:`int`: The ID associated to the token
        """
        pass

    def tokenize(self, sequence):
        """
        Tokenize a sequence

        Args:
            sequence (:obj:`str`):
                A sequence to tokenize

        Returns:
            A :obj:`List` of :class:`~tokenizers.Token`: The generated tokens
        """
        pass

class WordPiece(Model):
    """
    An implementation of the WordPiece algorithm

    Args:
        vocab (:obj:`Dict[str, int]`, `optional`):
            A dictionary of string keys and their ids :obj:`{"am": 0,...}`

        unk_token (:obj:`str`, `optional`):
            The unknown token to be used by the model.

        max_input_chars_per_word (:obj:`int`, `optional`):
            The maximum number of characters to authorize in a single word.
    """
    def __init__(self, vocab, unk_token, max_input_chars_per_word):
        pass

    @staticmethod
    def from_file(vocab, **kwargs):
        """
        Instantiate a WordPiece model from the given file

        This method is roughly equivalent to doing::

            vocab = WordPiece.read_file(vocab_filename)
            wordpiece = WordPiece(vocab)

        If you don't need to keep the :obj:`vocab` values lying around, this method is
        more optimized than manually calling :meth:`~tokenizers.models.WordPiece.read_file` to
        initialize a :class:`~tokenizers.models.WordPiece`

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.txt` file

        Returns:
            :class:`~tokenizers.models.WordPiece`: An instance of WordPiece loaded from file
        """
        pass

    def get_trainer(self):
        """
        Get the associated :class:`~tokenizers.trainers.Trainer`

        Retrieve the :class:`~tokenizers.trainers.Trainer` associated to this
        :class:`~tokenizers.models.Model`.

        Returns:
            :class:`~tokenizers.trainers.Trainer`: The Trainer used to train this model
        """
        pass

    def id_to_token(self, id):
        """
        Get the token associated to an ID

        Args:
            id (:obj:`int`):
                An ID to convert to a token

        Returns:
            :obj:`str`: The token associated to the ID
        """
        pass

    @staticmethod
    def read_file(vocab):
        """
        Read a :obj:`vocab.txt` file

        This method provides a way to read and parse the content of a standard `vocab.txt`
        file as used by the WordPiece Model, returning the relevant data structures. If you
        want to instantiate some WordPiece models from memory, this method gives you the
        expected input from the standard files.

        Args:
            vocab (:obj:`str`):
                The path to a :obj:`vocab.txt` file

        Returns:
            :obj:`Dict[str, int]`: The vocabulary as a :obj:`dict`
        """
        pass

    def save(self, folder, prefix):
        """
        Save the current model

        Save the current model in the given folder, using the given prefix for the various
        files that will get created.
        Any file with the same name that already exists in this folder will be overwritten.

        Args:
            folder (:obj:`str`):
                The path to the target folder in which to save the various files

            prefix (:obj:`str`, `optional`):
                An optional prefix, used to prefix each file name

        Returns:
            :obj:`List[str]`: The list of saved files
        """
        pass

    def token_to_id(self, tokens):
        """
        Get the ID associated to a token

        Args:
            token (:obj:`str`):
                A token to convert to an ID

        Returns:
            :obj:`int`: The ID associated to the token
        """
        pass

    def tokenize(self, sequence):
        """
        Tokenize a sequence

        Args:
            sequence (:obj:`str`):
                A sequence to tokenize

        Returns:
            A :obj:`List` of :class:`~tokenizers.Token`: The generated tokens
        """
        pass

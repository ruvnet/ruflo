# Generated content DO NOT EDIT
class DecodeStream:
    """
    Class needed for streaming decode

    """
    def __init__(self, skip_special_tokens):
        pass

class Decoder:
    """
    Base class for all decoders

    This class is not supposed to be instantiated directly. Instead, any implementation of
    a Decoder will return an instance of this class when instantiated.
    """
    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class BPEDecoder(Decoder):
    """
    BPEDecoder Decoder

    Args:
        suffix (:obj:`str`, `optional`, defaults to :obj:`</w>`):
            The suffix that was used to characterize an end-of-word. This suffix will
            be replaced by whitespaces during the decoding
    """
    def __init__(self, suffix="</w>"):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class ByteFallback(Decoder):
    """
    ByteFallback Decoder
    ByteFallback is a simple trick which converts tokens looking like `<0x61>`
    to pure bytes, and attempts to make them into a string. If the tokens
    cannot be decoded you will get � instead for each inconvertible byte token

    """
    def __init__(self):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class ByteLevel(Decoder):
    """
    ByteLevel Decoder

    This decoder is to be used in tandem with the :class:`~tokenizers.pre_tokenizers.ByteLevel`
    :class:`~tokenizers.pre_tokenizers.PreTokenizer`.
    """
    def __init__(self):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class CTC(Decoder):
    """
    CTC Decoder

    Args:
        pad_token (:obj:`str`, `optional`, defaults to :obj:`<pad>`):
            The pad token used by CTC to delimit a new token.
        word_delimiter_token (:obj:`str`, `optional`, defaults to :obj:`|`):
            The word delimiter token. It will be replaced by a <space>
        cleanup (:obj:`bool`, `optional`, defaults to :obj:`True`):
            Whether to cleanup some tokenization artifacts.
            Mainly spaces before punctuation, and some abbreviated english forms.
    """
    def __init__(self, pad_token="<pad>", word_delimiter_token="|", cleanup=True):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class Fuse(Decoder):
    """
    Fuse Decoder
    Fuse simply fuses every token into a single string.
    This is the last step of decoding, this decoder exists only if
    there is need to add other decoders *after* the fusion
    """
    def __init__(self):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class Metaspace(Decoder):
    """
    Metaspace Decoder

    Args:
        replacement (:obj:`str`, `optional`, defaults to :obj:`▁`):
            The replacement character. Must be exactly one character. By default we
            use the `▁` (U+2581) meta symbol (Same as in SentencePiece).

        prepend_scheme (:obj:`str`, `optional`, defaults to :obj:`"always"`):
            Whether to add a space to the first word if there isn't already one. This
            lets us treat `hello` exactly like `say hello`.
            Choices: "always", "never", "first". First means the space is only added on the first
            token (relevant when special tokens are used or other pre_tokenizer are used).
    """
    def __init__(self, replacement="▁", prepend_scheme="always", split=True):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class Replace(Decoder):
    """
    Replace Decoder

    This decoder is to be used in tandem with the :class:`~tokenizers.pre_tokenizers.Replace`
    :class:`~tokenizers.pre_tokenizers.PreTokenizer`.
    """
    def __init__(self, pattern, content):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class Sequence(Decoder):
    """
    Sequence Decoder

    Args:
        decoders (:obj:`List[Decoder]`)
            The decoders that need to be chained
    """
    def __init__(self, decoders):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class Strip(Decoder):
    """
    Strip normalizer
    Strips n left characters of each token, or n right characters of each token
    """
    def __init__(self, content, left=0, right=0):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

class WordPiece(Decoder):
    """
    WordPiece Decoder

    Args:
        prefix (:obj:`str`, `optional`, defaults to :obj:`##`):
            The prefix to use for subwords that are not a beginning-of-word

        cleanup (:obj:`bool`, `optional`, defaults to :obj:`True`):
            Whether to cleanup some tokenization artifacts. Mainly spaces before punctuation,
            and some abbreviated english forms.
    """
    def __init__(self, prefix="##", cleanup=True):
        pass

    def decode(self, tokens):
        """
        Decode the given list of tokens to a final string

        Args:
            tokens (:obj:`List[str]`):
                The list of tokens to decode

        Returns:
            :obj:`str`: The decoded string
        """
        pass

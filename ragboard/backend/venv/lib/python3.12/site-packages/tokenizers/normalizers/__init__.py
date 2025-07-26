from .. import normalizers


Normalizer = normalizers.Normalizer
BertNormalizer = normalizers.BertNormalizer
NFD = normalizers.NFD
NFKD = normalizers.NFKD
NFC = normalizers.NFC
NFKC = normalizers.NFKC
Sequence = normalizers.Sequence
Lowercase = normalizers.Lowercase
Prepend = normalizers.Prepend
Strip = normalizers.Strip
StripAccents = normalizers.StripAccents
Nmt = normalizers.Nmt
Precompiled = normalizers.Precompiled
Replace = normalizers.Replace
ByteLevel = normalizers.ByteLevel

NORMALIZERS = {"nfc": NFC, "nfd": NFD, "nfkc": NFKC, "nfkd": NFKD}


def unicode_normalizer_from_str(normalizer: str) -> Normalizer:
    if normalizer not in NORMALIZERS:
        raise ValueError(
            "{} is not a known unicode normalizer. Available are {}".format(normalizer, NORMALIZERS.keys())
        )

    return NORMALIZERS[normalizer]()

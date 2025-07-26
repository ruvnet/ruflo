def int_to_bytes(int: int) -> bytes:
    """Convert int to a 24 byte big endian byte string"""
    return int.to_bytes(24, "big")


def bytes_to_int(bytes: bytes) -> int:
    """Convert a 24 byte big endian byte string to an int"""
    return int.from_bytes(bytes, "big")

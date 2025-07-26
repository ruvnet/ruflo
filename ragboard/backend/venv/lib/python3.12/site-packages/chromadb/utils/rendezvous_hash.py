# An implementation of https://en.wikipedia.org/wiki/Rendezvous_hashing
from typing import Callable, List, Tuple
import mmh3
import heapq

Hasher = Callable[[str, str], int]
Member = str
Members = List[str]
Key = str


def assign(
    key: Key, members: Members, hasher: Hasher, replication: int
) -> List[Member]:
    """Assigns a key to a member using the rendezvous hashing algorithm
    Args:
        key: The key to assign
        members: The list of members to assign the key to
        hasher: The hashing function to use
        replication: The number of members to assign the key to
    Returns:
        A list of members that the key has been assigned to
    """

    if replication > len(members):
        raise ValueError(
            "Replication factor cannot be greater than the number of members"
        )
    if len(members) == 0:
        raise ValueError("Cannot assign key to empty memberlist")
    if len(members) == 1:
        # Don't copy the input list for some safety
        return [members[0]]
    if key == "":
        raise ValueError("Cannot assign empty key")

    member_score_heap: List[Tuple[int, Member]] = []
    for member in members:
        score = -hasher(member, key)
        # Invert the score since heapq is a min heap
        heapq.heappush(member_score_heap, (score, member))

    output_members: List[Member] = []
    for _ in range(replication):
        member_and_score = heapq.heappop(member_score_heap)
        output_members.append(member_and_score[1])

    return output_members


def merge_hashes(x: int, y: int) -> int:
    """murmurhash3 mix 64-bit"""
    acc = x ^ y
    acc ^= acc >> 33
    acc = (
        acc * 0xFF51AFD7ED558CCD
    ) % 2**64  # We need to mod here to prevent python from using arbitrary size int
    acc ^= acc >> 33
    acc = (acc * 0xC4CEB9FE1A85EC53) % 2**64
    acc ^= acc >> 33
    return acc


def murmur3hasher(member: Member, key: Key) -> int:
    """Hashes the key and member using the murmur3 hashing algorithm"""
    member_hash = mmh3.hash64(member, signed=False)[0]
    key_hash = mmh3.hash64(key, signed=False)[0]
    return merge_hashes(member_hash, key_hash)

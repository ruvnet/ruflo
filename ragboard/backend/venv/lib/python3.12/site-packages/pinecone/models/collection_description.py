from typing import NamedTuple

class CollectionDescription(NamedTuple):
    """
    The description of a collection.
    """

    name: str
    """
    The name of the collection.
    """

    source: str
    """
    The name of the index used to create the collection.
    """
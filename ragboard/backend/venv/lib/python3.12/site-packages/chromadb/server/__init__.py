from abc import ABC, abstractmethod

from chromadb.config import Settings


class Server(ABC):
    @abstractmethod
    def __init__(self, settings: Settings):
        pass

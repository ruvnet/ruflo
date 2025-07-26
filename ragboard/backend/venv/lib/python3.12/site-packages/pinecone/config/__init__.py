import logging
import os

from .config import ConfigBuilder, Config
from .pinecone_config import PineconeConfig

if (os.getenv('PINECONE_DEBUG') != None):
    logging.basicConfig(level=logging.DEBUG)
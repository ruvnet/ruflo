import chromadb
import chromadb.config
from chromadb.server.fastapi import FastAPI

settings = chromadb.config.Settings()
server = FastAPI(settings)
app = server.app()

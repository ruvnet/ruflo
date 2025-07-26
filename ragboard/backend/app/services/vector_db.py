"""
Vector database service for managing embeddings.
"""

from typing import List, Dict, Any, Optional, Tuple
from uuid import UUID
import asyncio
import logging
from dataclasses import dataclass
import numpy as np

# Vector DB imports
try:
    import pinecone
    from pinecone import Pinecone, ServerlessSpec
    PINECONE_AVAILABLE = True
except ImportError:
    PINECONE_AVAILABLE = False

try:
    import weaviate
    from weaviate import Client
    from weaviate.util import generate_uuid5
    WEAVIATE_AVAILABLE = True
except ImportError:
    WEAVIATE_AVAILABLE = False

try:
    import chromadb
    from chromadb.config import Settings
    CHROMA_AVAILABLE = True
except ImportError:
    CHROMA_AVAILABLE = False

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class VectorSearchResult:
    """Vector search result."""
    chunk_id: str
    resource_id: str
    chunk_text: str
    score: float
    metadata: Dict[str, Any]
    page_number: Optional[int] = None


class VectorDBService:
    """Service for managing vector embeddings."""
    
    def __init__(self, provider: str = "chroma"):
        self.provider = provider
        self.client = None
        self.collection = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize the vector database client."""
        if self.provider == "pinecone" and PINECONE_AVAILABLE:
            self._init_pinecone()
        elif self.provider == "weaviate" and WEAVIATE_AVAILABLE:
            self._init_weaviate()
        elif self.provider == "chroma" and CHROMA_AVAILABLE:
            self._init_chroma()
        else:
            # Default to ChromaDB (local)
            if CHROMA_AVAILABLE:
                self._init_chroma()
            else:
                logger.warning("No vector database available. Install chromadb, pinecone, or weaviate.")
    
    def _init_pinecone(self):
        """Initialize Pinecone client."""
        if not hasattr(settings, 'pinecone_api_key') or not settings.pinecone_api_key:
            logger.warning("Pinecone API key not configured")
            return
        
        pc = Pinecone(api_key=settings.pinecone_api_key)
        
        # Create index if it doesn't exist
        index_name = getattr(settings, 'pinecone_index_name', 'ragboard')
        if index_name not in pc.list_indexes().names():
            pc.create_index(
                name=index_name,
                dimension=1536,  # OpenAI embedding dimension
                metric='cosine',
                spec=ServerlessSpec(
                    cloud='aws',
                    region=getattr(settings, 'pinecone_region', 'us-east-1')
                )
            )
        
        self.client = pc.Index(index_name)
        logger.info("Pinecone initialized successfully")
    
    def _init_weaviate(self):
        """Initialize Weaviate client."""
        weaviate_url = getattr(settings, 'weaviate_url', 'http://localhost:8080')
        self.client = Client(url=weaviate_url)
        
        # Create schema if it doesn't exist
        schema = {
            "class": "ResourceChunk",
            "properties": [
                {"name": "chunk_text", "dataType": ["text"]},
                {"name": "resource_id", "dataType": ["string"]},
                {"name": "chunk_index", "dataType": ["int"]},
                {"name": "page_number", "dataType": ["int"]},
                {"name": "metadata", "dataType": ["string"]},
            ]
        }
        
        try:
            self.client.schema.create_class(schema)
        except Exception:
            # Schema already exists
            pass
        
        logger.info("Weaviate initialized successfully")
    
    def _init_chroma(self):
        """Initialize ChromaDB client (local)."""
        self.client = chromadb.PersistentClient(
            path=str(settings.chroma_persist_path),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )
        
        # Get or create collection
        self.collection = self.client.get_or_create_collection(
            name=settings.chroma_collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        
        logger.info(f"ChromaDB initialized at {settings.chroma_persist_path}")
    
    async def add_embeddings(
        self,
        resource_id: UUID,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
        model: str = "text-embedding-3-small"
    ) -> int:
        """
        Add embeddings to vector database.
        
        Args:
            resource_id: Resource UUID
            chunks: List of chunk data with text and metadata
            embeddings: List of embedding vectors
            model: Embedding model used
            
        Returns:
            Number of chunks added
        """
        if not chunks or not embeddings:
            return 0
        
        if len(chunks) != len(embeddings):
            raise ValueError("Number of chunks and embeddings must match")
        
        if self.provider == "pinecone" and self.client:
            return await self._add_pinecone(resource_id, chunks, embeddings, model)
        elif self.provider == "weaviate" and self.client:
            return await self._add_weaviate(resource_id, chunks, embeddings, model)
        elif self.provider == "chroma" and self.collection:
            return await self._add_chroma(resource_id, chunks, embeddings, model)
        else:
            logger.error("No vector database available")
            return 0
    
    async def _add_pinecone(
        self,
        resource_id: UUID,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
        model: str
    ) -> int:
        """Add embeddings to Pinecone."""
        vectors = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            vector_id = f"{resource_id}_{i}"
            metadata = {
                "resource_id": str(resource_id),
                "chunk_text": chunk["text"][:1000],  # Pinecone metadata limit
                "chunk_index": i,
                "page_number": chunk.get("page_number"),
                "embedding_model": model
            }
            vectors.append((vector_id, embedding, metadata))
        
        # Batch upsert
        batch_size = 100
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i + batch_size]
            self.client.upsert(vectors=batch)
        
        return len(vectors)
    
    async def _add_weaviate(
        self,
        resource_id: UUID,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
        model: str
    ) -> int:
        """Add embeddings to Weaviate."""
        batch = self.client.batch
        
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            data_object = {
                "chunk_text": chunk["text"],
                "resource_id": str(resource_id),
                "chunk_index": i,
                "page_number": chunk.get("page_number", -1),
                "metadata": str(chunk.get("metadata", {}))
            }
            
            batch.add_data_object(
                data_object=data_object,
                class_name="ResourceChunk",
                uuid=generate_uuid5(f"{resource_id}_{i}"),
                vector=embedding
            )
        
        batch.flush()
        return len(chunks)
    
    async def _add_chroma(
        self,
        resource_id: UUID,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
        model: str
    ) -> int:
        """Add embeddings to ChromaDB."""
        ids = [f"{resource_id}_{i}" for i in range(len(chunks))]
        documents = [chunk["text"] for chunk in chunks]
        metadatas = [
            {
                "resource_id": str(resource_id),
                "chunk_index": i,
                "page_number": chunk.get("page_number", -1),
                "embedding_model": model,
                **chunk.get("metadata", {})
            }
            for i, chunk in enumerate(chunks)
        ]
        
        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )
        
        return len(chunks)
    
    async def search(
        self,
        query_embedding: List[float],
        resource_ids: Optional[List[UUID]] = None,
        top_k: int = 5,
        score_threshold: float = 0.0
    ) -> List[VectorSearchResult]:
        """
        Search for similar chunks in vector database.
        
        Args:
            query_embedding: Query embedding vector
            resource_ids: Optional list of resource IDs to filter
            top_k: Number of results to return
            score_threshold: Minimum similarity score
            
        Returns:
            List of search results
        """
        if self.provider == "pinecone" and self.client:
            return await self._search_pinecone(query_embedding, resource_ids, top_k, score_threshold)
        elif self.provider == "weaviate" and self.client:
            return await self._search_weaviate(query_embedding, resource_ids, top_k, score_threshold)
        elif self.provider == "chroma" and self.collection:
            return await self._search_chroma(query_embedding, resource_ids, top_k, score_threshold)
        else:
            logger.error("No vector database available")
            return []
    
    async def _search_pinecone(
        self,
        query_embedding: List[float],
        resource_ids: Optional[List[UUID]],
        top_k: int,
        score_threshold: float
    ) -> List[VectorSearchResult]:
        """Search in Pinecone."""
        filter_dict = None
        if resource_ids:
            filter_dict = {
                "resource_id": {"$in": [str(rid) for rid in resource_ids]}
            }
        
        results = self.client.query(
            vector=query_embedding,
            filter=filter_dict,
            top_k=top_k,
            include_metadata=True
        )
        
        search_results = []
        for match in results['matches']:
            if match['score'] >= score_threshold:
                metadata = match['metadata']
                search_results.append(VectorSearchResult(
                    chunk_id=match['id'],
                    resource_id=metadata['resource_id'],
                    chunk_text=metadata['chunk_text'],
                    score=match['score'],
                    metadata=metadata,
                    page_number=metadata.get('page_number')
                ))
        
        return search_results
    
    async def _search_weaviate(
        self,
        query_embedding: List[float],
        resource_ids: Optional[List[UUID]],
        top_k: int,
        score_threshold: float
    ) -> List[VectorSearchResult]:
        """Search in Weaviate."""
        near_vector = {"vector": query_embedding}
        
        query = self.client.query.get(
            "ResourceChunk",
            ["chunk_text", "resource_id", "chunk_index", "page_number", "metadata"]
        ).with_near_vector(near_vector).with_limit(top_k)
        
        if resource_ids:
            where_filter = {
                "path": ["resource_id"],
                "operator": "ContainsAny",
                "valueStringArray": [str(rid) for rid in resource_ids]
            }
            query = query.with_where(where_filter)
        
        result = query.do()
        
        search_results = []
        if 'data' in result and 'Get' in result['data']:
            for item in result['data']['Get']['ResourceChunk']:
                # Calculate similarity score (Weaviate doesn't return it by default)
                score = 1.0  # Placeholder
                if score >= score_threshold:
                    search_results.append(VectorSearchResult(
                        chunk_id=f"{item['resource_id']}_{item['chunk_index']}",
                        resource_id=item['resource_id'],
                        chunk_text=item['chunk_text'],
                        score=score,
                        metadata={"metadata": item['metadata']},
                        page_number=item.get('page_number')
                    ))
        
        return search_results
    
    async def _search_chroma(
        self,
        query_embedding: List[float],
        resource_ids: Optional[List[UUID]],
        top_k: int,
        score_threshold: float
    ) -> List[VectorSearchResult]:
        """Search in ChromaDB."""
        where_filter = None
        if resource_ids:
            where_filter = {
                "resource_id": {"$in": [str(rid) for rid in resource_ids]}
            }
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            where=where_filter,
            n_results=top_k,
            include=["metadatas", "documents", "distances"]
        )
        
        search_results = []
        for i in range(len(results['ids'][0])):
            # Convert distance to similarity score (cosine)
            score = 1 - results['distances'][0][i]
            if score >= score_threshold:
                metadata = results['metadatas'][0][i]
                search_results.append(VectorSearchResult(
                    chunk_id=results['ids'][0][i],
                    resource_id=metadata['resource_id'],
                    chunk_text=results['documents'][0][i],
                    score=score,
                    metadata=metadata,
                    page_number=metadata.get('page_number')
                ))
        
        return search_results
    
    async def delete_resource_chunks(self, resource_id: UUID) -> bool:
        """Delete all chunks for a resource."""
        if self.provider == "pinecone" and self.client:
            # Delete by metadata filter
            self.client.delete(filter={"resource_id": str(resource_id)})
            return True
        elif self.provider == "weaviate" and self.client:
            # Delete by where filter
            self.client.batch.delete_objects(
                class_name="ResourceChunk",
                where={
                    "path": ["resource_id"],
                    "operator": "Equal",
                    "valueString": str(resource_id)
                }
            )
            return True
        elif self.provider == "chroma" and self.collection:
            # Get all chunk IDs for the resource
            results = self.collection.get(
                where={"resource_id": str(resource_id)},
                include=["ids"]
            )
            if results['ids']:
                self.collection.delete(ids=results['ids'])
            return True
        return False
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get vector database statistics."""
        stats = {"provider": self.provider}
        
        if self.provider == "pinecone" and self.client:
            index_stats = self.client.describe_index_stats()
            stats.update({
                "total_vectors": index_stats['total_vector_count'],
                "dimension": index_stats['dimension']
            })
        elif self.provider == "weaviate" and self.client:
            # Get count from Weaviate
            result = self.client.query.aggregate("ResourceChunk").with_meta_count().do()
            stats["total_vectors"] = result['data']['Aggregate']['ResourceChunk'][0]['meta']['count']
        elif self.provider == "chroma" and self.collection:
            stats["total_vectors"] = self.collection.count()
        
        return stats
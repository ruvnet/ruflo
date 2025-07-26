"""
RAG (Retrieval-Augmented Generation) pipeline service.
"""

from typing import List, Dict, Any, Optional, Tuple
from uuid import UUID
import asyncio
import logging
from datetime import datetime
import openai
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.resource import Resource, ResourceChunk
from app.services.vector_db import VectorDBService, VectorSearchResult
from app.db.base import get_async_session

logger = logging.getLogger(__name__)


class RAGPipeline:
    """Service for RAG operations."""
    
    def __init__(self):
        self.vector_service = VectorDBService()
        self.openai_client = None
        
        if settings.openai_api_key:
            self.openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    
    async def get_context(
        self,
        query: str,
        resource_ids: Optional[List[UUID]] = None,
        user_id: Optional[UUID] = None,
        top_k: int = 5,
        score_threshold: float = 0.7,
        max_context_length: int = 3000
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Get relevant context for a query using RAG.
        
        Args:
            query: User query
            resource_ids: Optional list of resource IDs to search within
            user_id: User ID for access control
            top_k: Number of chunks to retrieve
            score_threshold: Minimum similarity score
            max_context_length: Maximum context length in characters
            
        Returns:
            Tuple of (context_string, source_citations)
        """
        # Generate query embedding
        query_embedding = await self.generate_embedding(query)
        
        # Search for similar chunks
        search_results = await self.vector_service.search(
            query_embedding=query_embedding,
            resource_ids=resource_ids,
            top_k=top_k * 2,  # Get more results for filtering
            score_threshold=score_threshold
        )
        
        if not search_results:
            return "", []
        
        # Filter by user access if needed
        if user_id:
            search_results = await self._filter_by_access(search_results, user_id)
        
        # Sort by score and limit
        search_results.sort(key=lambda x: x.score, reverse=True)
        search_results = search_results[:top_k]
        
        # Build context and citations
        context_parts = []
        citations = []
        current_length = 0
        
        async with get_async_session() as db:
            for result in search_results:
                # Get resource info for citation
                resource = await self._get_resource_info(db, UUID(result.resource_id))
                if not resource:
                    continue
                
                # Add to context if within length limit
                chunk_length = len(result.chunk_text)
                if current_length + chunk_length <= max_context_length:
                    context_parts.append(f"[Source: {resource.name}]\n{result.chunk_text}")
                    current_length += chunk_length
                    
                    # Build citation
                    citation = {
                        "resource_id": result.resource_id,
                        "resource_name": resource.name,
                        "resource_type": resource.resource_type.value,
                        "chunk_id": result.chunk_id,
                        "page_number": result.page_number,
                        "relevance_score": result.score,
                        "excerpt": result.chunk_text[:200] + "..." if len(result.chunk_text) > 200 else result.chunk_text
                    }
                    citations.append(citation)
        
        # Join context with separators
        context = "\n\n---\n\n".join(context_parts)
        
        return context, citations
    
    async def generate_embedding(
        self,
        text: str,
        model: str = "text-embedding-3-small"
    ) -> List[float]:
        """Generate embedding for text."""
        if not self.openai_client:
            raise ValueError("OpenAI API key not configured")
        
        try:
            response = await self.openai_client.embeddings.create(
                input=text,
                model=model
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            raise
    
    async def generate_embeddings_batch(
        self,
        texts: List[str],
        model: str = "text-embedding-3-small",
        batch_size: int = 100
    ) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        if not self.openai_client:
            raise ValueError("OpenAI API key not configured")
        
        embeddings = []
        
        # Process in batches
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            try:
                response = await self.openai_client.embeddings.create(
                    input=batch,
                    model=model
                )
                embeddings.extend([data.embedding for data in response.data])
            except Exception as e:
                logger.error(f"Error generating embeddings batch: {e}")
                raise
        
        return embeddings
    
    async def chunk_text(
        self,
        text: str,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        metadata: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Split text into chunks for embedding.
        
        Args:
            text: Text to chunk
            chunk_size: Size of each chunk in characters
            chunk_overlap: Overlap between chunks
            metadata: Additional metadata for chunks
            
        Returns:
            List of chunk dictionaries
        """
        if chunk_overlap >= chunk_size:
            raise ValueError("Chunk overlap must be less than chunk size")
        
        chunks = []
        start = 0
        text_length = len(text)
        
        while start < text_length:
            end = start + chunk_size
            
            # Try to break at sentence boundary
            if end < text_length:
                # Look for sentence end
                sentence_ends = ['. ', '! ', '? ', '\n\n']
                best_break = end
                
                for sent_end in sentence_ends:
                    pos = text.rfind(sent_end, start + chunk_overlap, end)
                    if pos != -1:
                        best_break = pos + len(sent_end) - 1
                        break
                
                end = best_break
            
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunk_data = {
                    "text": chunk_text,
                    "start_char": start,
                    "end_char": end,
                    "metadata": metadata or {}
                }
                chunks.append(chunk_data)
            
            start = end - chunk_overlap if end < text_length else text_length
        
        return chunks
    
    async def process_and_store_resource(
        self,
        resource_id: UUID,
        text: str,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        embedding_model: str = "text-embedding-3-small"
    ) -> int:
        """
        Process resource text and store embeddings.
        
        Args:
            resource_id: Resource ID
            text: Extracted text
            chunk_size: Size of text chunks
            chunk_overlap: Overlap between chunks
            embedding_model: Model for embeddings
            
        Returns:
            Number of chunks created
        """
        # Chunk the text
        chunks = await self.chunk_text(
            text=text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )
        
        if not chunks:
            return 0
        
        # Generate embeddings
        chunk_texts = [chunk["text"] for chunk in chunks]
        embeddings = await self.generate_embeddings_batch(
            texts=chunk_texts,
            model=embedding_model
        )
        
        # Store in vector database
        await self.vector_service.add_embeddings(
            resource_id=resource_id,
            chunks=chunks,
            embeddings=embeddings,
            model=embedding_model
        )
        
        # Store chunks in database
        async with get_async_session() as db:
            for i, chunk in enumerate(chunks):
                chunk_record = ResourceChunk(
                    resource_id=resource_id,
                    chunk_index=i,
                    chunk_text=chunk["text"],
                    chunk_metadata=chunk.get("metadata"),
                    vector_id=f"{resource_id}_{i}",
                    embedding_model=embedding_model,
                    start_char=chunk.get("start_char"),
                    end_char=chunk.get("end_char")
                )
                db.add(chunk_record)
            
            # Update resource
            result = await db.execute(
                select(Resource).where(Resource.id == resource_id)
            )
            resource = result.scalar_one_or_none()
            if resource:
                resource.chunk_count = len(chunks)
                resource.embedding_model = embedding_model
                resource.embedding_dimension = len(embeddings[0])
            
            await db.commit()
        
        return len(chunks)
    
    async def _filter_by_access(
        self,
        results: List[VectorSearchResult],
        user_id: UUID
    ) -> List[VectorSearchResult]:
        """Filter search results by user access."""
        # Get resource IDs
        resource_ids = list(set(UUID(r.resource_id) for r in results))
        
        # Check access
        async with get_async_session() as db:
            query = select(Resource.id).where(
                Resource.id.in_(resource_ids),
                Resource.user_id == user_id
            )
            result = await db.execute(query)
            accessible_ids = {str(row[0]) for row in result}
        
        # Filter results
        return [r for r in results if r.resource_id in accessible_ids]
    
    async def _get_resource_info(self, db: AsyncSession, resource_id: UUID) -> Optional[Resource]:
        """Get resource information."""
        result = await db.execute(
            select(Resource).where(Resource.id == resource_id)
        )
        return result.scalar_one_or_none()
    
    async def rerank_results(
        self,
        query: str,
        results: List[VectorSearchResult],
        model: str = "gpt-3.5-turbo"
    ) -> List[VectorSearchResult]:
        """
        Rerank search results using LLM for better relevance.
        
        Args:
            query: Original query
            results: Initial search results
            model: Model for reranking
            
        Returns:
            Reranked results
        """
        if not results or not self.openai_client:
            return results
        
        # Build prompt for reranking
        prompt = f"Query: {query}\n\nRank these text chunks by relevance to the query. Return only the indices in order of relevance.\n\n"
        
        for i, result in enumerate(results):
            excerpt = result.chunk_text[:500] + "..." if len(result.chunk_text) > 500 else result.chunk_text
            prompt += f"{i}. {excerpt}\n\n"
        
        try:
            response = await self.openai_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a relevance ranking expert."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                max_tokens=100
            )
            
            # Parse ranking
            ranking_text = response.choices[0].message.content.strip()
            indices = []
            for part in ranking_text.split():
                try:
                    idx = int(part.strip(".,"))
                    if 0 <= idx < len(results):
                        indices.append(idx)
                except ValueError:
                    continue
            
            # Reorder results
            if indices:
                reranked = [results[i] for i in indices if i < len(results)]
                # Add any missing results at the end
                reranked.extend([r for r in results if r not in reranked])
                return reranked
            
        except Exception as e:
            logger.error(f"Error reranking results: {e}")
        
        return results
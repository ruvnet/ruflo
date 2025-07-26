"""
AI Chat service for handling LLM interactions.
"""

from typing import List, Dict, Any, Optional, AsyncGenerator
import asyncio
from datetime import datetime
import openai
import anthropic
from dataclasses import dataclass
import logging

from app.core.config import settings
from app.models.conversation import Message, MessageRole

logger = logging.getLogger(__name__)


@dataclass
class AIResponse:
    """AI response data class."""
    content: str
    model: str
    usage: Dict[str, int]
    finish_reason: str = "stop"


class AIChatService:
    """Service for handling AI chat interactions."""
    
    def __init__(self):
        self.openai_client = None
        self.anthropic_client = None
        
        # Initialize clients based on available API keys
        if settings.openai_api_key:
            self.openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        
        if settings.anthropic_api_key:
            self.anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    
    async def generate_response(
        self,
        message: str,
        context: Optional[str] = None,
        history: Optional[List[Message]] = None,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        system_prompt: Optional[str] = None
    ) -> AIResponse:
        """
        Generate AI response with optional RAG context.
        """
        model = model or settings.default_ai_model
        
        # Build messages
        messages = self._build_messages(
            message=message,
            context=context,
            history=history,
            system_prompt=system_prompt
        )
        
        # Route to appropriate provider
        if model.startswith("gpt"):
            return await self._generate_openai_response(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens
            )
        elif model.startswith("claude"):
            return await self._generate_anthropic_response(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens
            )
        else:
            raise ValueError(f"Unsupported model: {model}")
    
    async def generate_response_stream(
        self,
        message: str,
        context: Optional[str] = None,
        history: Optional[List[Message]] = None,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Generate streaming AI response.
        """
        model = model or settings.default_ai_model
        
        # Build messages
        messages = self._build_messages(
            message=message,
            context=context,
            history=history,
            system_prompt=system_prompt
        )
        
        # Route to appropriate provider
        if model.startswith("gpt"):
            async for chunk in self._stream_openai_response(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens
            ):
                yield chunk
        elif model.startswith("claude"):
            async for chunk in self._stream_anthropic_response(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens
            ):
                yield chunk
        else:
            raise ValueError(f"Unsupported model: {model}")
    
    def _build_messages(
        self,
        message: str,
        context: Optional[str] = None,
        history: Optional[List[Message]] = None,
        system_prompt: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """Build message list for AI model."""
        messages = []
        
        # System prompt
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        else:
            default_prompt = "You are a helpful AI assistant integrated with RAGBoard. "
            if context:
                default_prompt += "Use the following context to answer questions: "
            messages.append({"role": "system", "content": default_prompt})
        
        # Add context if provided
        if context:
            messages.append({
                "role": "system",
                "content": f"Context:\n{context}\n\nUse this context to answer the user's questions."
            })
        
        # Add conversation history
        if history:
            for msg in history[-10:]:  # Last 10 messages
                if msg.role == MessageRole.USER:
                    messages.append({"role": "user", "content": msg.content})
                elif msg.role == MessageRole.ASSISTANT:
                    messages.append({"role": "assistant", "content": msg.content})
        
        # Add current message
        messages.append({"role": "user", "content": message})
        
        return messages
    
    async def _generate_openai_response(
        self,
        messages: List[Dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int
    ) -> AIResponse:
        """Generate response using OpenAI."""
        if not self.openai_client:
            raise ValueError("OpenAI API key not configured")
        
        try:
            response = await self.openai_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False
            )
            
            return AIResponse(
                content=response.choices[0].message.content,
                model=model,
                usage={
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                },
                finish_reason=response.choices[0].finish_reason
            )
        except Exception as e:
            logger.error(f"OpenAI API error: {e}")
            raise
    
    async def _stream_openai_response(
        self,
        messages: List[Dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int
    ) -> AsyncGenerator[str, None]:
        """Stream response using OpenAI."""
        if not self.openai_client:
            raise ValueError("OpenAI API key not configured")
        
        try:
            stream = await self.openai_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True
            )
            
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            raise
    
    async def _generate_anthropic_response(
        self,
        messages: List[Dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int
    ) -> AIResponse:
        """Generate response using Anthropic."""
        if not self.anthropic_client:
            raise ValueError("Anthropic API key not configured")
        
        try:
            # Convert messages format for Anthropic
            system = None
            anthropic_messages = []
            
            for msg in messages:
                if msg["role"] == "system":
                    system = msg["content"] if not system else f"{system}\n{msg['content']}"
                else:
                    anthropic_messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
            
            response = await self.anthropic_client.messages.create(
                model=model,
                messages=anthropic_messages,
                system=system,
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            # Calculate token usage (approximate for Anthropic)
            content = response.content[0].text
            prompt_tokens = sum(len(m["content"].split()) * 1.3 for m in messages)
            completion_tokens = len(content.split()) * 1.3
            
            return AIResponse(
                content=content,
                model=model,
                usage={
                    "prompt_tokens": int(prompt_tokens),
                    "completion_tokens": int(completion_tokens),
                    "total_tokens": int(prompt_tokens + completion_tokens)
                }
            )
        except Exception as e:
            logger.error(f"Anthropic API error: {e}")
            raise
    
    async def _stream_anthropic_response(
        self,
        messages: List[Dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int
    ) -> AsyncGenerator[str, None]:
        """Stream response using Anthropic."""
        if not self.anthropic_client:
            raise ValueError("Anthropic API key not configured")
        
        try:
            # Convert messages format
            system = None
            anthropic_messages = []
            
            for msg in messages:
                if msg["role"] == "system":
                    system = msg["content"] if not system else f"{system}\n{msg['content']}"
                else:
                    anthropic_messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
            
            async with self.anthropic_client.messages.stream(
                model=model,
                messages=anthropic_messages,
                system=system,
                temperature=temperature,
                max_tokens=max_tokens
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                    
        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            raise
    
    async def generate_summary(
        self,
        text: str,
        max_length: int = 200,
        model: Optional[str] = None
    ) -> str:
        """Generate a summary of the given text."""
        prompt = f"Please provide a concise summary of the following text in no more than {max_length} words:\n\n{text}"
        
        response = await self.generate_response(
            message=prompt,
            model=model,
            temperature=0.5,
            max_tokens=max_length * 2
        )
        
        return response.content
    
    async def extract_keywords(
        self,
        text: str,
        max_keywords: int = 10,
        model: Optional[str] = None
    ) -> List[str]:
        """Extract keywords from text."""
        prompt = f"Extract up to {max_keywords} important keywords or key phrases from the following text. Return them as a comma-separated list:\n\n{text}"
        
        response = await self.generate_response(
            message=prompt,
            model=model,
            temperature=0.3,
            max_tokens=200
        )
        
        keywords = [k.strip() for k in response.content.split(",")]
        return keywords[:max_keywords]
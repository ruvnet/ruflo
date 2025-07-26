from .gemini import Client


# Create a genai-like module for perfect drop-in replacement
class _GenAI:
    Client = Client


genai = _GenAI()

__all__ = ["Client", "genai"]

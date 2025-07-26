try:
    import openai
except ImportError:
    raise ModuleNotFoundError(
        "Please install the Open AI SDK to use this feature: 'pip install openai'"
    )

from posthog.ai.openai.openai import (
    WrappedBeta,
    WrappedChat,
    WrappedEmbeddings,
    WrappedResponses,
)
from posthog.ai.openai.openai_async import WrappedBeta as AsyncWrappedBeta
from posthog.ai.openai.openai_async import WrappedChat as AsyncWrappedChat
from posthog.ai.openai.openai_async import WrappedEmbeddings as AsyncWrappedEmbeddings
from posthog.ai.openai.openai_async import WrappedResponses as AsyncWrappedResponses
from posthog.client import Client as PostHogClient


class AzureOpenAI(openai.AzureOpenAI):
    """
    A wrapper around the Azure OpenAI SDK that automatically sends LLM usage events to PostHog.
    """

    _ph_client: PostHogClient

    def __init__(self, posthog_client: PostHogClient, **kwargs):
        """
        Args:
            api_key: Azure OpenAI API key.
            posthog_client: If provided, events will be captured via this client instead
                            of the global posthog.
            **openai_config: Any additional keyword args to set on Azure OpenAI (e.g. azure_endpoint="xxx").
        """
        super().__init__(**kwargs)
        self._ph_client = posthog_client

        # Store original objects after parent initialization (only if they exist)
        self._original_chat = getattr(self, "chat", None)
        self._original_embeddings = getattr(self, "embeddings", None)
        self._original_beta = getattr(self, "beta", None)
        self._original_responses = getattr(self, "responses", None)

        # Replace with wrapped versions (only if originals exist)
        if self._original_chat is not None:
            self.chat = WrappedChat(self, self._original_chat)

        if self._original_embeddings is not None:
            self.embeddings = WrappedEmbeddings(self, self._original_embeddings)

        if self._original_beta is not None:
            self.beta = WrappedBeta(self, self._original_beta)

        if self._original_responses is not None:
            self.responses = WrappedResponses(self, self._original_responses)


class AsyncAzureOpenAI(openai.AsyncAzureOpenAI):
    """
    An async wrapper around the Azure OpenAI SDK that automatically sends LLM usage events to PostHog.
    """

    _ph_client: PostHogClient

    def __init__(self, posthog_client: PostHogClient, **kwargs):
        """
        Args:
            api_key: Azure OpenAI API key.
            posthog_client: If provided, events will be captured via this client instead
                            of the global posthog.
            **openai_config: Any additional keyword args to set on Azure OpenAI (e.g. azure_endpoint="xxx").
        """
        super().__init__(**kwargs)
        self._ph_client = posthog_client

        # Store original objects after parent initialization (only if they exist)
        self._original_chat = getattr(self, "chat", None)
        self._original_embeddings = getattr(self, "embeddings", None)
        self._original_beta = getattr(self, "beta", None)
        self._original_responses = getattr(self, "responses", None)

        # Replace with wrapped versions (only if originals exist)
        if self._original_chat is not None:
            self.chat = AsyncWrappedChat(self, self._original_chat)

        if self._original_embeddings is not None:
            self.embeddings = AsyncWrappedEmbeddings(self, self._original_embeddings)

        if self._original_beta is not None:
            self.beta = AsyncWrappedBeta(self, self._original_beta)

        # Only add responses if available (newer OpenAI versions)
        if self._original_responses is not None:
            self.responses = AsyncWrappedResponses(self, self._original_responses)

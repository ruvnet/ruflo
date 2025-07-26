from typing import Optional

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._providers._common import BaseConversationalTask


class OpenAIConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="openai", base_url="https://api.openai.com")

    def _prepare_api_key(self, api_key: Optional[str]) -> str:
        if api_key is None:
            raise ValueError("You must provide an api_key to work with OpenAI API.")
        if api_key.startswith("hf_"):
            raise ValueError(
                "OpenAI provider is not available through Hugging Face routing, please use your own OpenAI API key."
            )
        return api_key

    def _prepare_mapping_info(self, model: Optional[str]) -> InferenceProviderMapping:
        if model is None:
            raise ValueError("Please provide an OpenAI model ID, e.g. `gpt-4o` or `o1`.")
        return InferenceProviderMapping(
            provider="openai", providerId=model, task="conversational", status="live", hf_model_id=model
        )

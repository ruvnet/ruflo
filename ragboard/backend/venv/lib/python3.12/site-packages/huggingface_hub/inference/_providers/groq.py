from ._common import BaseConversationalTask


class GroqConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="groq", base_url="https://api.groq.com")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/openai/v1/chat/completions"

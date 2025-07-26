from ._common import BaseConversationalTask


class CerebrasConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="cerebras", base_url="https://api.cerebras.ai")

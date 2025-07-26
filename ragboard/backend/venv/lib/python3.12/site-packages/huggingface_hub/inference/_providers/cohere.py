from typing import Any, Dict, Optional

from huggingface_hub.hf_api import InferenceProviderMapping

from ._common import BaseConversationalTask


_PROVIDER = "cohere"
_BASE_URL = "https://api.cohere.com"


class CohereConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider=_PROVIDER, base_url=_BASE_URL)

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/compatibility/v1/chat/completions"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload = super()._prepare_payload_as_dict(inputs, parameters, provider_mapping_info)
        response_format = parameters.get("response_format")
        if isinstance(response_format, dict) and response_format.get("type") == "json_schema":
            json_schema_details = response_format.get("json_schema")
            if isinstance(json_schema_details, dict) and "schema" in json_schema_details:
                payload["response_format"] = {  # type: ignore [index]
                    "type": "json_object",
                    "schema": json_schema_details["schema"],
                }

        return payload

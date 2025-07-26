from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import BaseConversationalTask, TaskProviderHelper, filter_none


class SambanovaConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="sambanova", base_url="https://api.sambanova.ai")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        response_format_config = parameters.get("response_format")
        if isinstance(response_format_config, dict):
            if response_format_config.get("type") == "json_schema":
                json_schema_config = response_format_config.get("json_schema", {})
                strict = json_schema_config.get("strict")
                if isinstance(json_schema_config, dict) and (strict is True or strict is None):
                    json_schema_config["strict"] = False

        payload = super()._prepare_payload_as_dict(inputs, parameters, provider_mapping_info)
        return payload


class SambanovaFeatureExtractionTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(provider="sambanova", base_url="https://api.sambanova.ai", task="feature-extraction")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/embeddings"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        parameters = filter_none(parameters)
        return {"input": inputs, "model": provider_mapping_info.provider_id, **parameters}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        embeddings = _as_dict(response)["data"]
        return [embedding["embedding"] for embedding in embeddings]

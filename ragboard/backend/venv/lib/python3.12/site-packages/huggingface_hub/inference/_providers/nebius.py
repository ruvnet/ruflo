import base64
from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import (
    BaseConversationalTask,
    BaseTextGenerationTask,
    TaskProviderHelper,
    filter_none,
)


class NebiusTextGenerationTask(BaseTextGenerationTask):
    def __init__(self):
        super().__init__(provider="nebius", base_url="https://api.studio.nebius.ai")

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        output = _as_dict(response)["choices"][0]
        return {
            "generated_text": output["text"],
            "details": {
                "finish_reason": output.get("finish_reason"),
                "seed": output.get("seed"),
            },
        }


class NebiusConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="nebius", base_url="https://api.studio.nebius.ai")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload = super()._prepare_payload_as_dict(inputs, parameters, provider_mapping_info)
        response_format = parameters.get("response_format")
        if isinstance(response_format, dict) and response_format.get("type") == "json_schema":
            json_schema_details = response_format.get("json_schema")
            if isinstance(json_schema_details, dict) and "schema" in json_schema_details:
                payload["guided_json"] = json_schema_details["schema"]  # type: ignore [index]
        return payload


class NebiusTextToImageTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(task="text-to-image", provider="nebius", base_url="https://api.studio.nebius.ai")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/images/generations"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        mapped_model = provider_mapping_info.provider_id
        parameters = filter_none(parameters)
        if "guidance_scale" in parameters:
            parameters.pop("guidance_scale")
        if parameters.get("response_format") not in ("b64_json", "url"):
            parameters["response_format"] = "b64_json"

        return {"prompt": inputs, **parameters, "model": mapped_model}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        response_dict = _as_dict(response)
        return base64.b64decode(response_dict["data"][0]["b64_json"])


class NebiusFeatureExtractionTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(task="feature-extraction", provider="nebius", base_url="https://api.studio.nebius.ai")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/embeddings"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return {"input": inputs, "model": provider_mapping_info.provider_id}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        embeddings = _as_dict(response)["data"]
        return [embedding["embedding"] for embedding in embeddings]

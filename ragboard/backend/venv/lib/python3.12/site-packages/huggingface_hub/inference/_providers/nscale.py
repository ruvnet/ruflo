import base64
from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict

from ._common import BaseConversationalTask, TaskProviderHelper, filter_none


class NscaleConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider="nscale", base_url="https://inference.api.nscale.com")


class NscaleTextToImageTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(provider="nscale", base_url="https://inference.api.nscale.com", task="text-to-image")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/images/generations"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        mapped_model = provider_mapping_info.provider_id
        # Combine all parameters except inputs and parameters
        parameters = filter_none(parameters)
        if "width" in parameters and "height" in parameters:
            parameters["size"] = f"{parameters.pop('width')}x{parameters.pop('height')}"
        if "num_inference_steps" in parameters:
            parameters.pop("num_inference_steps")
        if "cfg_scale" in parameters:
            parameters.pop("cfg_scale")
        payload = {
            "response_format": "b64_json",
            "prompt": inputs,
            "model": mapped_model,
            **parameters,
        }
        return payload

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        response_dict = _as_dict(response)
        return base64.b64decode(response_dict["data"][0]["b64_json"])

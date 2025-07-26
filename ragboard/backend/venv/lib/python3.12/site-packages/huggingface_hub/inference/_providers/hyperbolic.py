import base64
from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import BaseConversationalTask, TaskProviderHelper, filter_none


class HyperbolicTextToImageTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(provider="hyperbolic", base_url="https://api.hyperbolic.xyz", task="text-to-image")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/images/generations"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        mapped_model = provider_mapping_info.provider_id
        parameters = filter_none(parameters)
        if "num_inference_steps" in parameters:
            parameters["steps"] = parameters.pop("num_inference_steps")
        if "guidance_scale" in parameters:
            parameters["cfg_scale"] = parameters.pop("guidance_scale")
        # For Hyperbolic, the width and height are required parameters
        if "width" not in parameters:
            parameters["width"] = 512
        if "height" not in parameters:
            parameters["height"] = 512
        return {"prompt": inputs, "model_name": mapped_model, **parameters}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        response_dict = _as_dict(response)
        return base64.b64decode(response_dict["images"][0]["image"])


class HyperbolicTextGenerationTask(BaseConversationalTask):
    """
    Special case for Hyperbolic, where text-generation task is handled as a conversational task.
    """

    def __init__(self, task: str):
        super().__init__(
            provider="hyperbolic",
            base_url="https://api.hyperbolic.xyz",
        )
        self.task = task

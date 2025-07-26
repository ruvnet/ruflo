from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import TaskProviderHelper, filter_none
from huggingface_hub.utils import get_session


_PROVIDER = "replicate"
_BASE_URL = "https://api.replicate.com"


class ReplicateTask(TaskProviderHelper):
    def __init__(self, task: str):
        super().__init__(provider=_PROVIDER, base_url=_BASE_URL, task=task)

    def _prepare_headers(self, headers: Dict, api_key: str) -> Dict:
        headers = super()._prepare_headers(headers, api_key)
        headers["Prefer"] = "wait"
        return headers

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        if ":" in mapped_model:
            return "/v1/predictions"
        return f"/v1/models/{mapped_model}/predictions"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        mapped_model = provider_mapping_info.provider_id
        payload: Dict[str, Any] = {"input": {"prompt": inputs, **filter_none(parameters)}}
        if ":" in mapped_model:
            version = mapped_model.split(":", 1)[1]
            payload["version"] = version
        return payload

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        response_dict = _as_dict(response)
        if response_dict.get("output") is None:
            raise TimeoutError(
                f"Inference request timed out after 60 seconds. No output generated for model {response_dict.get('model')}"
                "The model might be in cold state or starting up. Please try again later."
            )
        output_url = (
            response_dict["output"] if isinstance(response_dict["output"], str) else response_dict["output"][0]
        )
        return get_session().get(output_url).content


class ReplicateTextToImageTask(ReplicateTask):
    def __init__(self):
        super().__init__("text-to-image")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload: Dict = super()._prepare_payload_as_dict(inputs, parameters, provider_mapping_info)  # type: ignore[assignment]
        if provider_mapping_info.adapter_weights_path is not None:
            payload["input"]["lora_weights"] = f"https://huggingface.co/{provider_mapping_info.hf_model_id}"
        return payload


class ReplicateTextToSpeechTask(ReplicateTask):
    def __init__(self):
        super().__init__("text-to-speech")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload: Dict = super()._prepare_payload_as_dict(inputs, parameters, provider_mapping_info)  # type: ignore[assignment]
        payload["input"]["text"] = payload["input"].pop("prompt")  # rename "prompt" to "text" for TTS
        return payload

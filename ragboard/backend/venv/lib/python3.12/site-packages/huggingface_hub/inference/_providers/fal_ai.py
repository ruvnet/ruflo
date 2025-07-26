import base64
import time
from abc import ABC
from typing import Any, Dict, Optional, Union
from urllib.parse import urlparse

from huggingface_hub import constants
from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import TaskProviderHelper, filter_none
from huggingface_hub.utils import get_session, hf_raise_for_status
from huggingface_hub.utils.logging import get_logger


logger = get_logger(__name__)

# Arbitrary polling interval
_POLLING_INTERVAL = 0.5


class FalAITask(TaskProviderHelper, ABC):
    def __init__(self, task: str):
        super().__init__(provider="fal-ai", base_url="https://fal.run", task=task)

    def _prepare_headers(self, headers: Dict, api_key: str) -> Dict:
        headers = super()._prepare_headers(headers, api_key)
        if not api_key.startswith("hf_"):
            headers["authorization"] = f"Key {api_key}"
        return headers

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return f"/{mapped_model}"


class FalAIAutomaticSpeechRecognitionTask(FalAITask):
    def __init__(self):
        super().__init__("automatic-speech-recognition")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        if isinstance(inputs, str) and inputs.startswith(("http://", "https://")):
            # If input is a URL, pass it directly
            audio_url = inputs
        else:
            # If input is a file path, read it first
            if isinstance(inputs, str):
                with open(inputs, "rb") as f:
                    inputs = f.read()

            audio_b64 = base64.b64encode(inputs).decode()
            content_type = "audio/mpeg"
            audio_url = f"data:{content_type};base64,{audio_b64}"

        return {"audio_url": audio_url, **filter_none(parameters)}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        text = _as_dict(response)["text"]
        if not isinstance(text, str):
            raise ValueError(f"Unexpected output format from FalAI API. Expected string, got {type(text)}.")
        return text


class FalAITextToImageTask(FalAITask):
    def __init__(self):
        super().__init__("text-to-image")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload: Dict[str, Any] = {
            "prompt": inputs,
            **filter_none(parameters),
        }
        if "width" in payload and "height" in payload:
            payload["image_size"] = {
                "width": payload.pop("width"),
                "height": payload.pop("height"),
            }
        if provider_mapping_info.adapter_weights_path is not None:
            lora_path = constants.HUGGINGFACE_CO_URL_TEMPLATE.format(
                repo_id=provider_mapping_info.hf_model_id,
                revision="main",
                filename=provider_mapping_info.adapter_weights_path,
            )
            payload["loras"] = [{"path": lora_path, "scale": 1}]
            if provider_mapping_info.provider_id == "fal-ai/lora":
                # little hack: fal requires the base model for stable-diffusion-based loras but not for flux-based
                # See payloads in https://fal.ai/models/fal-ai/lora/api vs https://fal.ai/models/fal-ai/flux-lora/api
                payload["model_name"] = "stabilityai/stable-diffusion-xl-base-1.0"

        return payload

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        url = _as_dict(response)["images"][0]["url"]
        return get_session().get(url).content


class FalAITextToSpeechTask(FalAITask):
    def __init__(self):
        super().__init__("text-to-speech")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return {"text": inputs, **filter_none(parameters)}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        url = _as_dict(response)["audio"]["url"]
        return get_session().get(url).content


class FalAITextToVideoTask(FalAITask):
    def __init__(self):
        super().__init__("text-to-video")

    def _prepare_base_url(self, api_key: str) -> str:
        if api_key.startswith("hf_"):
            return super()._prepare_base_url(api_key)
        else:
            logger.info(f"Calling '{self.provider}' provider directly.")
            return "https://queue.fal.run"

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        if api_key.startswith("hf_"):
            # Use the queue subdomain for HF routing
            return f"/{mapped_model}?_subdomain=queue"
        return f"/{mapped_model}"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return {"prompt": inputs, **filter_none(parameters)}

    def get_response(
        self,
        response: Union[bytes, Dict],
        request_params: Optional[RequestParameters] = None,
    ) -> Any:
        response_dict = _as_dict(response)

        request_id = response_dict.get("request_id")
        if not request_id:
            raise ValueError("No request ID found in the response")
        if request_params is None:
            raise ValueError(
                "A `RequestParameters` object should be provided to get text-to-video responses with Fal AI."
            )

        # extract the base url and query params
        parsed_url = urlparse(request_params.url)
        # a bit hacky way to concatenate the provider name without parsing `parsed_url.path`
        base_url = f"{parsed_url.scheme}://{parsed_url.netloc}{'/fal-ai' if parsed_url.netloc == 'router.huggingface.co' else ''}"
        query_param = f"?{parsed_url.query}" if parsed_url.query else ""

        # extracting the provider model id for status and result urls
        # from the response as it might be different from the mapped model in `request_params.url`
        model_id = urlparse(response_dict.get("response_url")).path
        status_url = f"{base_url}{str(model_id)}/status{query_param}"
        result_url = f"{base_url}{str(model_id)}{query_param}"

        status = response_dict.get("status")
        logger.info("Generating the video.. this can take several minutes.")
        while status != "COMPLETED":
            time.sleep(_POLLING_INTERVAL)
            status_response = get_session().get(status_url, headers=request_params.headers)
            hf_raise_for_status(status_response)
            status = status_response.json().get("status")

        response = get_session().get(result_url, headers=request_params.headers).json()
        url = _as_dict(response)["video"]["url"]
        return get_session().get(url).content

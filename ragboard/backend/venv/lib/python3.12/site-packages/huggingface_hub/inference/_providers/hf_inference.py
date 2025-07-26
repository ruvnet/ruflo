import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Union

from huggingface_hub import constants
from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _b64_encode, _bytes_to_dict, _open_as_binary
from huggingface_hub.inference._providers._common import TaskProviderHelper, filter_none
from huggingface_hub.utils import build_hf_headers, get_session, get_token, hf_raise_for_status


class HFInferenceTask(TaskProviderHelper):
    """Base class for HF Inference API tasks."""

    def __init__(self, task: str):
        super().__init__(
            provider="hf-inference",
            base_url=constants.INFERENCE_PROXY_TEMPLATE.format(provider="hf-inference"),
            task=task,
        )

    def _prepare_api_key(self, api_key: Optional[str]) -> str:
        # special case: for HF Inference we allow not providing an API key
        return api_key or get_token()  # type: ignore[return-value]

    def _prepare_mapping_info(self, model: Optional[str]) -> InferenceProviderMapping:
        if model is not None and model.startswith(("http://", "https://")):
            return InferenceProviderMapping(
                provider="hf-inference", providerId=model, hf_model_id=model, task=self.task, status="live"
            )
        model_id = model if model is not None else _fetch_recommended_models().get(self.task)
        if model_id is None:
            raise ValueError(
                f"Task {self.task} has no recommended model for HF Inference. Please specify a model"
                " explicitly. Visit https://huggingface.co/tasks for more info."
            )
        _check_supported_task(model_id, self.task)
        return InferenceProviderMapping(
            provider="hf-inference", providerId=model_id, hf_model_id=model_id, task=self.task, status="live"
        )

    def _prepare_url(self, api_key: str, mapped_model: str) -> str:
        # hf-inference provider can handle URLs (e.g. Inference Endpoints or TGI deployment)
        if mapped_model.startswith(("http://", "https://")):
            return mapped_model
        return (
            # Feature-extraction and sentence-similarity are the only cases where we handle models with several tasks.
            f"{self.base_url}/models/{mapped_model}/pipeline/{self.task}"
            if self.task in ("feature-extraction", "sentence-similarity")
            # Otherwise, we use the default endpoint
            else f"{self.base_url}/models/{mapped_model}"
        )

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        if isinstance(inputs, bytes):
            raise ValueError(f"Unexpected binary input for task {self.task}.")
        if isinstance(inputs, Path):
            raise ValueError(f"Unexpected path input for task {self.task} (got {inputs})")
        return {"inputs": inputs, "parameters": filter_none(parameters)}


class HFInferenceBinaryInputTask(HFInferenceTask):
    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return None

    def _prepare_payload_as_bytes(
        self,
        inputs: Any,
        parameters: Dict,
        provider_mapping_info: InferenceProviderMapping,
        extra_payload: Optional[Dict],
    ) -> Optional[bytes]:
        parameters = filter_none(parameters)
        extra_payload = extra_payload or {}
        has_parameters = len(parameters) > 0 or len(extra_payload) > 0

        # Raise if not a binary object or a local path or a URL.
        if not isinstance(inputs, (bytes, Path)) and not isinstance(inputs, str):
            raise ValueError(f"Expected binary inputs or a local path or a URL. Got {inputs}")

        # Send inputs as raw content when no parameters are provided
        if not has_parameters:
            with _open_as_binary(inputs) as data:
                data_as_bytes = data if isinstance(data, bytes) else data.read()
                return data_as_bytes

        # Otherwise encode as b64
        return json.dumps({"inputs": _b64_encode(inputs), "parameters": parameters, **extra_payload}).encode("utf-8")


class HFInferenceConversational(HFInferenceTask):
    def __init__(self):
        super().__init__("conversational")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        payload = filter_none(parameters)
        mapped_model = provider_mapping_info.provider_id
        payload_model = parameters.get("model") or mapped_model

        if payload_model is None or payload_model.startswith(("http://", "https://")):
            payload_model = "dummy"

        response_format = parameters.get("response_format")
        if isinstance(response_format, dict) and response_format.get("type") == "json_schema":
            payload["response_format"] = {
                "type": "json_object",
                "value": response_format["json_schema"]["schema"],
            }
        return {**payload, "model": payload_model, "messages": inputs}

    def _prepare_url(self, api_key: str, mapped_model: str) -> str:
        base_url = (
            mapped_model
            if mapped_model.startswith(("http://", "https://"))
            else f"{constants.INFERENCE_PROXY_TEMPLATE.format(provider='hf-inference')}/models/{mapped_model}"
        )
        return _build_chat_completion_url(base_url)


def _build_chat_completion_url(model_url: str) -> str:
    # Strip trailing /
    model_url = model_url.rstrip("/")

    # Append /chat/completions if not already present
    if model_url.endswith("/v1"):
        model_url += "/chat/completions"

    # Append /v1/chat/completions if not already present
    if not model_url.endswith("/chat/completions"):
        model_url += "/v1/chat/completions"

    return model_url


@lru_cache(maxsize=1)
def _fetch_recommended_models() -> Dict[str, Optional[str]]:
    response = get_session().get(f"{constants.ENDPOINT}/api/tasks", headers=build_hf_headers())
    hf_raise_for_status(response)
    return {task: next(iter(details["widgetModels"]), None) for task, details in response.json().items()}


@lru_cache(maxsize=None)
def _check_supported_task(model: str, task: str) -> None:
    from huggingface_hub.hf_api import HfApi

    model_info = HfApi().model_info(model)
    pipeline_tag = model_info.pipeline_tag
    tags = model_info.tags or []
    is_conversational = "conversational" in tags
    if task in ("text-generation", "conversational"):
        if pipeline_tag == "text-generation":
            # text-generation + conversational tag -> both tasks allowed
            if is_conversational:
                return
            # text-generation without conversational tag -> only text-generation allowed
            if task == "text-generation":
                return
            raise ValueError(f"Model '{model}' doesn't support task '{task}'.")

    if pipeline_tag == "text2text-generation":
        if task == "text-generation":
            return
        raise ValueError(f"Model '{model}' doesn't support task '{task}'.")

    if pipeline_tag == "image-text-to-text":
        if is_conversational and task == "conversational":
            return  # Only conversational allowed if tagged as conversational
        raise ValueError("Non-conversational image-text-to-text task is not supported.")

    if (
        task in ("feature-extraction", "sentence-similarity")
        and pipeline_tag in ("feature-extraction", "sentence-similarity")
        and task in tags
    ):
        # feature-extraction and sentence-similarity are interchangeable for HF Inference
        return

    # For all other tasks, just check pipeline tag
    if pipeline_tag != task:
        raise ValueError(
            f"Model '{model}' doesn't support task '{task}'. Supported tasks: '{pipeline_tag}', got: '{task}'"
        )
    return


class HFInferenceFeatureExtractionTask(HFInferenceTask):
    def __init__(self):
        super().__init__("feature-extraction")

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        if isinstance(inputs, bytes):
            raise ValueError(f"Unexpected binary input for task {self.task}.")
        if isinstance(inputs, Path):
            raise ValueError(f"Unexpected path input for task {self.task} (got {inputs})")

        # Parameters are sent at root-level for feature-extraction task
        # See specs: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/src/tasks/feature-extraction/spec/input.json
        return {"inputs": inputs, **filter_none(parameters)}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        if isinstance(response, bytes):
            return _bytes_to_dict(response)
        return response

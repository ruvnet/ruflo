from functools import lru_cache
from typing import Any, Dict, List, Optional, Union, overload

from huggingface_hub import constants
from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters
from huggingface_hub.inference._generated.types.chat_completion import ChatCompletionInputMessage
from huggingface_hub.utils import build_hf_headers, get_token, logging


logger = logging.get_logger(__name__)


# Dev purposes only.
# If you want to try to run inference for a new model locally before it's registered on huggingface.co
# for a given Inference Provider, you can add it to the following dictionary.
HARDCODED_MODEL_INFERENCE_MAPPING: Dict[str, Dict[str, InferenceProviderMapping]] = {
    # "HF model ID" => InferenceProviderMapping object initialized with "Model ID on Inference Provider's side"
    #
    # Example:
    # "Qwen/Qwen2.5-Coder-32B-Instruct": InferenceProviderMapping(hf_model_id="Qwen/Qwen2.5-Coder-32B-Instruct",
    #                                    provider_id="Qwen2.5-Coder-32B-Instruct",
    #                                    task="conversational",
    #                                    status="live")
    "cerebras": {},
    "cohere": {},
    "fal-ai": {},
    "fireworks-ai": {},
    "groq": {},
    "hf-inference": {},
    "hyperbolic": {},
    "nebius": {},
    "nscale": {},
    "replicate": {},
    "sambanova": {},
    "together": {},
}


@overload
def filter_none(obj: Dict[str, Any]) -> Dict[str, Any]: ...
@overload
def filter_none(obj: List[Any]) -> List[Any]: ...


def filter_none(obj: Union[Dict[str, Any], List[Any]]) -> Union[Dict[str, Any], List[Any]]:
    if isinstance(obj, dict):
        cleaned: Dict[str, Any] = {}
        for k, v in obj.items():
            if v is None:
                continue
            if isinstance(v, (dict, list)):
                v = filter_none(v)
                # remove empty nested dicts
                if isinstance(v, dict) and not v:
                    continue
            cleaned[k] = v
        return cleaned

    if isinstance(obj, list):
        return [filter_none(v) if isinstance(v, (dict, list)) else v for v in obj]

    raise ValueError(f"Expected dict or list, got {type(obj)}")


class TaskProviderHelper:
    """Base class for task-specific provider helpers."""

    def __init__(self, provider: str, base_url: str, task: str) -> None:
        self.provider = provider
        self.task = task
        self.base_url = base_url

    def prepare_request(
        self,
        *,
        inputs: Any,
        parameters: Dict[str, Any],
        headers: Dict,
        model: Optional[str],
        api_key: Optional[str],
        extra_payload: Optional[Dict[str, Any]] = None,
    ) -> RequestParameters:
        """
        Prepare the request to be sent to the provider.

        Each step (api_key, model, headers, url, payload) can be customized in subclasses.
        """
        # api_key from user, or local token, or raise error
        api_key = self._prepare_api_key(api_key)

        # mapped model from HF model ID
        provider_mapping_info = self._prepare_mapping_info(model)

        # default HF headers + user headers (to customize in subclasses)
        headers = self._prepare_headers(headers, api_key)

        # routed URL if HF token, or direct URL (to customize in '_prepare_route' in subclasses)
        url = self._prepare_url(api_key, provider_mapping_info.provider_id)

        # prepare payload (to customize in subclasses)
        payload = self._prepare_payload_as_dict(inputs, parameters, provider_mapping_info=provider_mapping_info)
        if payload is not None:
            payload = recursive_merge(payload, extra_payload or {})

        # body data (to customize in subclasses)
        data = self._prepare_payload_as_bytes(inputs, parameters, provider_mapping_info, extra_payload)

        # check if both payload and data are set and return
        if payload is not None and data is not None:
            raise ValueError("Both payload and data cannot be set in the same request.")
        if payload is None and data is None:
            raise ValueError("Either payload or data must be set in the request.")
        return RequestParameters(
            url=url, task=self.task, model=provider_mapping_info.provider_id, json=payload, data=data, headers=headers
        )

    def get_response(
        self,
        response: Union[bytes, Dict],
        request_params: Optional[RequestParameters] = None,
    ) -> Any:
        """
        Return the response in the expected format.

        Override this method in subclasses for customized response handling."""
        return response

    def _prepare_api_key(self, api_key: Optional[str]) -> str:
        """Return the API key to use for the request.

        Usually not overwritten in subclasses."""
        if api_key is None:
            api_key = get_token()
        if api_key is None:
            raise ValueError(
                f"You must provide an api_key to work with {self.provider} API or log in with `huggingface-cli login`."
            )
        return api_key

    def _prepare_mapping_info(self, model: Optional[str]) -> InferenceProviderMapping:
        """Return the mapped model ID to use for the request.

        Usually not overwritten in subclasses."""
        if model is None:
            raise ValueError(f"Please provide an HF model ID supported by {self.provider}.")

        # hardcoded mapping for local testing
        if HARDCODED_MODEL_INFERENCE_MAPPING.get(self.provider, {}).get(model):
            return HARDCODED_MODEL_INFERENCE_MAPPING[self.provider][model]

        provider_mapping = None
        for mapping in _fetch_inference_provider_mapping(model):
            if mapping.provider == self.provider:
                provider_mapping = mapping
                break

        if provider_mapping is None:
            raise ValueError(f"Model {model} is not supported by provider {self.provider}.")

        if provider_mapping.task != self.task:
            raise ValueError(
                f"Model {model} is not supported for task {self.task} and provider {self.provider}. "
                f"Supported task: {provider_mapping.task}."
            )

        if provider_mapping.status == "staging":
            logger.warning(
                f"Model {model} is in staging mode for provider {self.provider}. Meant for test purposes only."
            )
        if provider_mapping.status == "error":
            logger.warning(
                f"Our latest automated health check on model '{model}' for provider '{self.provider}' did not complete successfully.  "
                "Inference call might fail."
            )
        return provider_mapping

    def _prepare_headers(self, headers: Dict, api_key: str) -> Dict:
        """Return the headers to use for the request.

        Override this method in subclasses for customized headers.
        """
        return {**build_hf_headers(token=api_key), **headers}

    def _prepare_url(self, api_key: str, mapped_model: str) -> str:
        """Return the URL to use for the request.

        Usually not overwritten in subclasses."""
        base_url = self._prepare_base_url(api_key)
        route = self._prepare_route(mapped_model, api_key)
        return f"{base_url.rstrip('/')}/{route.lstrip('/')}"

    def _prepare_base_url(self, api_key: str) -> str:
        """Return the base URL to use for the request.

        Usually not overwritten in subclasses."""
        # Route to the proxy if the api_key is a HF TOKEN
        if api_key.startswith("hf_"):
            logger.info(f"Calling '{self.provider}' provider through Hugging Face router.")
            return constants.INFERENCE_PROXY_TEMPLATE.format(provider=self.provider)
        else:
            logger.info(f"Calling '{self.provider}' provider directly.")
            return self.base_url

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        """Return the route to use for the request.

        Override this method in subclasses for customized routes.
        """
        return ""

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        """Return the payload to use for the request, as a dict.

        Override this method in subclasses for customized payloads.
        Only one of `_prepare_payload_as_dict` and `_prepare_payload_as_bytes` should return a value.
        """
        return None

    def _prepare_payload_as_bytes(
        self,
        inputs: Any,
        parameters: Dict,
        provider_mapping_info: InferenceProviderMapping,
        extra_payload: Optional[Dict],
    ) -> Optional[bytes]:
        """Return the body to use for the request, as bytes.

        Override this method in subclasses for customized body data.
        Only one of `_prepare_payload_as_dict` and `_prepare_payload_as_bytes` should return a value.
        """
        return None


class BaseConversationalTask(TaskProviderHelper):
    """
    Base class for conversational (chat completion) tasks.
    The schema follows the OpenAI API format defined here: https://platform.openai.com/docs/api-reference/chat
    """

    def __init__(self, provider: str, base_url: str):
        super().__init__(provider=provider, base_url=base_url, task="conversational")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/chat/completions"

    def _prepare_payload_as_dict(
        self,
        inputs: List[Union[Dict, ChatCompletionInputMessage]],
        parameters: Dict,
        provider_mapping_info: InferenceProviderMapping,
    ) -> Optional[Dict]:
        return filter_none({"messages": inputs, **parameters, "model": provider_mapping_info.provider_id})


class BaseTextGenerationTask(TaskProviderHelper):
    """
    Base class for text-generation (completion) tasks.
    The schema follows the OpenAI API format defined here: https://platform.openai.com/docs/api-reference/completions
    """

    def __init__(self, provider: str, base_url: str):
        super().__init__(provider=provider, base_url=base_url, task="text-generation")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return "/v1/completions"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return {"prompt": inputs, **filter_none(parameters), "model": provider_mapping_info.provider_id}


@lru_cache(maxsize=None)
def _fetch_inference_provider_mapping(model: str) -> List["InferenceProviderMapping"]:
    """
    Fetch provider mappings for a model from the Hub.
    """
    from huggingface_hub.hf_api import HfApi

    info = HfApi().model_info(model, expand=["inferenceProviderMapping"])
    provider_mapping = info.inference_provider_mapping
    if provider_mapping is None:
        raise ValueError(f"No provider mapping found for model {model}")
    return provider_mapping


def recursive_merge(dict1: Dict, dict2: Dict) -> Dict:
    return {
        **dict1,
        **{
            key: recursive_merge(dict1[key], value)
            if (key in dict1 and isinstance(dict1[key], dict) and isinstance(value, dict))
            else value
            for key, value in dict2.items()
        },
    }

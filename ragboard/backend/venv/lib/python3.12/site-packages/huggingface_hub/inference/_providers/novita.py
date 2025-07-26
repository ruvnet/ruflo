from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import (
    BaseConversationalTask,
    BaseTextGenerationTask,
    TaskProviderHelper,
    filter_none,
)
from huggingface_hub.utils import get_session


_PROVIDER = "novita"
_BASE_URL = "https://api.novita.ai"


class NovitaTextGenerationTask(BaseTextGenerationTask):
    def __init__(self):
        super().__init__(provider=_PROVIDER, base_url=_BASE_URL)

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        # there is no v1/ route for novita
        return "/v3/openai/completions"

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        output = _as_dict(response)["choices"][0]
        return {
            "generated_text": output["text"],
            "details": {
                "finish_reason": output.get("finish_reason"),
                "seed": output.get("seed"),
            },
        }


class NovitaConversationalTask(BaseConversationalTask):
    def __init__(self):
        super().__init__(provider=_PROVIDER, base_url=_BASE_URL)

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        # there is no v1/ route for novita
        return "/v3/openai/chat/completions"


class NovitaTextToVideoTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(provider=_PROVIDER, base_url=_BASE_URL, task="text-to-video")

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return f"/v3/hf/{mapped_model}"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        return {"prompt": inputs, **filter_none(parameters)}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        response_dict = _as_dict(response)
        if not (
            isinstance(response_dict, dict)
            and "video" in response_dict
            and isinstance(response_dict["video"], dict)
            and "video_url" in response_dict["video"]
        ):
            raise ValueError("Expected response format: { 'video': { 'video_url': string } }")

        video_url = response_dict["video"]["video_url"]
        return get_session().get(video_url).content

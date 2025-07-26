import time
from typing import Any, Dict, Optional, Union

from huggingface_hub.hf_api import InferenceProviderMapping
from huggingface_hub.inference._common import RequestParameters, _as_dict
from huggingface_hub.inference._providers._common import TaskProviderHelper, filter_none
from huggingface_hub.utils import logging
from huggingface_hub.utils._http import get_session


logger = logging.get_logger(__name__)

MAX_POLLING_ATTEMPTS = 6
POLLING_INTERVAL = 1.0


class BlackForestLabsTextToImageTask(TaskProviderHelper):
    def __init__(self):
        super().__init__(provider="black-forest-labs", base_url="https://api.us1.bfl.ai", task="text-to-image")

    def _prepare_headers(self, headers: Dict, api_key: str) -> Dict:
        headers = super()._prepare_headers(headers, api_key)
        if not api_key.startswith("hf_"):
            _ = headers.pop("authorization")
            headers["X-Key"] = api_key
        return headers

    def _prepare_route(self, mapped_model: str, api_key: str) -> str:
        return f"/v1/{mapped_model}"

    def _prepare_payload_as_dict(
        self, inputs: Any, parameters: Dict, provider_mapping_info: InferenceProviderMapping
    ) -> Optional[Dict]:
        parameters = filter_none(parameters)
        if "num_inference_steps" in parameters:
            parameters["steps"] = parameters.pop("num_inference_steps")
        if "guidance_scale" in parameters:
            parameters["guidance"] = parameters.pop("guidance_scale")

        return {"prompt": inputs, **parameters}

    def get_response(self, response: Union[bytes, Dict], request_params: Optional[RequestParameters] = None) -> Any:
        """
        Polling mechanism for Black Forest Labs since the API is asynchronous.
        """
        url = _as_dict(response).get("polling_url")
        session = get_session()
        for _ in range(MAX_POLLING_ATTEMPTS):
            time.sleep(POLLING_INTERVAL)

            response = session.get(url, headers={"Content-Type": "application/json"})  # type: ignore
            response.raise_for_status()  # type: ignore
            response_json: Dict = response.json()  # type: ignore
            status = response_json.get("status")
            logger.info(
                f"Polling generation result from {url}. Current status: {status}. "
                f"Will retry after {POLLING_INTERVAL} seconds if not ready."
            )

            if (
                status == "Ready"
                and isinstance(response_json.get("result"), dict)
                and (sample_url := response_json["result"].get("sample"))
            ):
                image_resp = session.get(sample_url)
                image_resp.raise_for_status()
                return image_resp.content

        raise TimeoutError(f"Failed to get the image URL after {MAX_POLLING_ATTEMPTS} attempts.")

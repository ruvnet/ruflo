import io
from typing import Any, Dict, List, Optional, Union

from . import constants
from .hf_api import HfApi
from .utils import build_hf_headers, get_session, is_pillow_available, logging, validate_hf_hub_args
from .utils._deprecation import _deprecate_method


logger = logging.get_logger(__name__)


ALL_TASKS = [
    # NLP
    "text-classification",
    "token-classification",
    "table-question-answering",
    "question-answering",
    "zero-shot-classification",
    "translation",
    "summarization",
    "conversational",
    "feature-extraction",
    "text-generation",
    "text2text-generation",
    "fill-mask",
    "sentence-similarity",
    # Audio
    "text-to-speech",
    "automatic-speech-recognition",
    "audio-to-audio",
    "audio-classification",
    "voice-activity-detection",
    # Computer vision
    "image-classification",
    "object-detection",
    "image-segmentation",
    "text-to-image",
    "image-to-image",
    # Others
    "tabular-classification",
    "tabular-regression",
]


class InferenceApi:
    """Client to configure requests and make calls to the HuggingFace Inference API.

    Example:

    ```python
    >>> from huggingface_hub.inference_api import InferenceApi

    >>> # Mask-fill example
    >>> inference = InferenceApi("bert-base-uncased")
    >>> inference(inputs="The goal of life is [MASK].")
    [{'sequence': 'the goal of life is life.', 'score': 0.10933292657136917, 'token': 2166, 'token_str': 'life'}]

    >>> # Question Answering example
    >>> inference = InferenceApi("deepset/roberta-base-squad2")
    >>> inputs = {
    ...     "question": "What's my name?",
    ...     "context": "My name is Clara and I live in Berkeley.",
    ... }
    >>> inference(inputs)
    {'score': 0.9326569437980652, 'start': 11, 'end': 16, 'answer': 'Clara'}

    >>> # Zero-shot example
    >>> inference = InferenceApi("typeform/distilbert-base-uncased-mnli")
    >>> inputs = "Hi, I recently bought a device from your company but it is not working as advertised and I would like to get reimbursed!"
    >>> params = {"candidate_labels": ["refund", "legal", "faq"]}
    >>> inference(inputs, params)
    {'sequence': 'Hi, I recently bought a device from your company but it is not working as advertised and I would like to get reimbursed!', 'labels': ['refund', 'faq', 'legal'], 'scores': [0.9378499388694763, 0.04914155602455139, 0.013008488342165947]}

    >>> # Overriding configured task
    >>> inference = InferenceApi("bert-base-uncased", task="feature-extraction")

    >>> # Text-to-image
    >>> inference = InferenceApi("stabilityai/stable-diffusion-2-1")
    >>> inference("cat")
    <PIL.PngImagePlugin.PngImageFile image (...)>

    >>> # Return as raw response to parse the output yourself
    >>> inference = InferenceApi("mio/amadeus")
    >>> response = inference("hello world", raw_response=True)
    >>> response.headers
    {"Content-Type": "audio/flac", ...}
    >>> response.content # raw bytes from server
    b'(...)'
    ```
    """

    @validate_hf_hub_args
    @_deprecate_method(
        version="1.0",
        message=(
            "`InferenceApi` client is deprecated in favor of the more feature-complete `InferenceClient`. Check out"
            " this guide to learn how to convert your script to use it:"
            " https://huggingface.co/docs/huggingface_hub/guides/inference#legacy-inferenceapi-client."
        ),
    )
    def __init__(
        self,
        repo_id: str,
        task: Optional[str] = None,
        token: Optional[str] = None,
        gpu: bool = False,
    ):
        """Inits headers and API call information.

        Args:
            repo_id (``str``):
                Id of repository (e.g. `user/bert-base-uncased`).
            task (``str``, `optional`, defaults ``None``):
                Whether to force a task instead of using task specified in the
                repository.
            token (`str`, `optional`):
                The API token to use as HTTP bearer authorization. This is not
                the authentication token. You can find the token in
                https://huggingface.co/settings/token. Alternatively, you can
                find both your organizations and personal API tokens using
                `HfApi().whoami(token)`.
            gpu (`bool`, `optional`, defaults `False`):
                Whether to use GPU instead of CPU for inference(requires Startup
                plan at least).
        """
        self.options = {"wait_for_model": True, "use_gpu": gpu}
        self.headers = build_hf_headers(token=token)

        # Configure task
        model_info = HfApi(token=token).model_info(repo_id=repo_id)
        if not model_info.pipeline_tag and not task:
            raise ValueError(
                "Task not specified in the repository. Please add it to the model card"
                " using pipeline_tag"
                " (https://huggingface.co/docs#how-is-a-models-type-of-inference-api-and-widget-determined)"
            )

        if task and task != model_info.pipeline_tag:
            if task not in ALL_TASKS:
                raise ValueError(f"Invalid task {task}. Make sure it's valid.")

            logger.warning(
                "You're using a different task than the one specified in the"
                " repository. Be sure to know what you're doing :)"
            )
            self.task = task
        else:
            assert model_info.pipeline_tag is not None, "Pipeline tag cannot be None"
            self.task = model_info.pipeline_tag

        self.api_url = f"{constants.INFERENCE_ENDPOINT}/pipeline/{self.task}/{repo_id}"

    def __repr__(self):
        # Do not add headers to repr to avoid leaking token.
        return f"InferenceAPI(api_url='{self.api_url}', task='{self.task}', options={self.options})"

    def __call__(
        self,
        inputs: Optional[Union[str, Dict, List[str], List[List[str]]]] = None,
        params: Optional[Dict] = None,
        data: Optional[bytes] = None,
        raw_response: bool = False,
    ) -> Any:
        """Make a call to the Inference API.

        Args:
            inputs (`str` or `Dict` or `List[str]` or `List[List[str]]`, *optional*):
                Inputs for the prediction.
            params (`Dict`, *optional*):
                Additional parameters for the models. Will be sent as `parameters` in the
                payload.
            data (`bytes`, *optional*):
                Bytes content of the request. In this case, leave `inputs` and `params` empty.
            raw_response (`bool`, defaults to `False`):
                If `True`, the raw `Response` object is returned. You can parse its content
                as preferred. By default, the content is parsed into a more practical format
                (json dictionary or PIL Image for example).
        """
        # Build payload
        payload: Dict[str, Any] = {
            "options": self.options,
        }
        if inputs:
            payload["inputs"] = inputs
        if params:
            payload["parameters"] = params

        # Make API call
        response = get_session().post(self.api_url, headers=self.headers, json=payload, data=data)

        # Let the user handle the response
        if raw_response:
            return response

        # By default, parse the response for the user.
        content_type = response.headers.get("Content-Type") or ""
        if content_type.startswith("image"):
            if not is_pillow_available():
                raise ImportError(
                    f"Task '{self.task}' returned as image but Pillow is not installed."
                    " Please install it (`pip install Pillow`) or pass"
                    " `raw_response=True` to get the raw `Response` object and parse"
                    " the image by yourself."
                )

            from PIL import Image

            return Image.open(io.BytesIO(response.content))
        elif content_type == "application/json":
            return response.json()
        else:
            raise NotImplementedError(
                f"{content_type} output type is not implemented yet. You can pass"
                " `raw_response=True` to get the raw `Response` object and parse the"
                " output by yourself."
            )

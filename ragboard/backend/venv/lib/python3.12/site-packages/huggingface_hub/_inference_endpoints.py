import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Dict, Optional, Union

from huggingface_hub.errors import InferenceEndpointError, InferenceEndpointTimeoutError

from .utils import get_session, logging, parse_datetime


if TYPE_CHECKING:
    from .hf_api import HfApi
    from .inference._client import InferenceClient
    from .inference._generated._async_client import AsyncInferenceClient

logger = logging.get_logger(__name__)


class InferenceEndpointStatus(str, Enum):
    PENDING = "pending"
    INITIALIZING = "initializing"
    UPDATING = "updating"
    UPDATE_FAILED = "updateFailed"
    RUNNING = "running"
    PAUSED = "paused"
    FAILED = "failed"
    SCALED_TO_ZERO = "scaledToZero"


class InferenceEndpointType(str, Enum):
    PUBlIC = "public"
    PROTECTED = "protected"
    PRIVATE = "private"


@dataclass
class InferenceEndpoint:
    """
    Contains information about a deployed Inference Endpoint.

    Args:
        name (`str`):
            The unique name of the Inference Endpoint.
        namespace (`str`):
            The namespace where the Inference Endpoint is located.
        repository (`str`):
            The name of the model repository deployed on this Inference Endpoint.
        status ([`InferenceEndpointStatus`]):
            The current status of the Inference Endpoint.
        url (`str`, *optional*):
            The URL of the Inference Endpoint, if available. Only a deployed Inference Endpoint will have a URL.
        framework (`str`):
            The machine learning framework used for the model.
        revision (`str`):
            The specific model revision deployed on the Inference Endpoint.
        task (`str`):
            The task associated with the deployed model.
        created_at (`datetime.datetime`):
            The timestamp when the Inference Endpoint was created.
        updated_at (`datetime.datetime`):
            The timestamp of the last update of the Inference Endpoint.
        type ([`InferenceEndpointType`]):
            The type of the Inference Endpoint (public, protected, private).
        raw (`Dict`):
            The raw dictionary data returned from the API.
        token (`str` or `bool`, *optional*):
            Authentication token for the Inference Endpoint, if set when requesting the API. Will default to the
            locally saved token if not provided. Pass `token=False` if you don't want to send your token to the server.

    Example:
        ```python
        >>> from huggingface_hub import get_inference_endpoint
        >>> endpoint = get_inference_endpoint("my-text-to-image")
        >>> endpoint
        InferenceEndpoint(name='my-text-to-image', ...)

        # Get status
        >>> endpoint.status
        'running'
        >>> endpoint.url
        'https://my-text-to-image.region.vendor.endpoints.huggingface.cloud'

        # Run inference
        >>> endpoint.client.text_to_image(...)

        # Pause endpoint to save $$$
        >>> endpoint.pause()

        # ...
        # Resume and wait for deployment
        >>> endpoint.resume()
        >>> endpoint.wait()
        >>> endpoint.client.text_to_image(...)
        ```
    """

    # Field in __repr__
    name: str = field(init=False)
    namespace: str
    repository: str = field(init=False)
    status: InferenceEndpointStatus = field(init=False)
    health_route: str = field(init=False)
    url: Optional[str] = field(init=False)

    # Other fields
    framework: str = field(repr=False, init=False)
    revision: str = field(repr=False, init=False)
    task: str = field(repr=False, init=False)
    created_at: datetime = field(repr=False, init=False)
    updated_at: datetime = field(repr=False, init=False)
    type: InferenceEndpointType = field(repr=False, init=False)

    # Raw dict from the API
    raw: Dict = field(repr=False)

    # Internal fields
    _token: Union[str, bool, None] = field(repr=False, compare=False)
    _api: "HfApi" = field(repr=False, compare=False)

    @classmethod
    def from_raw(
        cls, raw: Dict, namespace: str, token: Union[str, bool, None] = None, api: Optional["HfApi"] = None
    ) -> "InferenceEndpoint":
        """Initialize object from raw dictionary."""
        if api is None:
            from .hf_api import HfApi

            api = HfApi()
        if token is None:
            token = api.token

        # All other fields are populated in __post_init__
        return cls(raw=raw, namespace=namespace, _token=token, _api=api)

    def __post_init__(self) -> None:
        """Populate fields from raw dictionary."""
        self._populate_from_raw()

    @property
    def client(self) -> "InferenceClient":
        """Returns a client to make predictions on this Inference Endpoint.

        Returns:
            [`InferenceClient`]: an inference client pointing to the deployed endpoint.

        Raises:
            [`InferenceEndpointError`]: If the Inference Endpoint is not yet deployed.
        """
        if self.url is None:
            raise InferenceEndpointError(
                "Cannot create a client for this Inference Endpoint as it is not yet deployed. "
                "Please wait for the Inference Endpoint to be deployed using `endpoint.wait()` and try again."
            )
        from .inference._client import InferenceClient

        return InferenceClient(
            model=self.url,
            token=self._token,  # type: ignore[arg-type] # boolean token shouldn't be possible. In practice it's ok.
        )

    @property
    def async_client(self) -> "AsyncInferenceClient":
        """Returns a client to make predictions on this Inference Endpoint.

        Returns:
            [`AsyncInferenceClient`]: an asyncio-compatible inference client pointing to the deployed endpoint.

        Raises:
            [`InferenceEndpointError`]: If the Inference Endpoint is not yet deployed.
        """
        if self.url is None:
            raise InferenceEndpointError(
                "Cannot create a client for this Inference Endpoint as it is not yet deployed. "
                "Please wait for the Inference Endpoint to be deployed using `endpoint.wait()` and try again."
            )
        from .inference._generated._async_client import AsyncInferenceClient

        return AsyncInferenceClient(
            model=self.url,
            token=self._token,  # type: ignore[arg-type] # boolean token shouldn't be possible. In practice it's ok.
        )

    def wait(self, timeout: Optional[int] = None, refresh_every: int = 5) -> "InferenceEndpoint":
        """Wait for the Inference Endpoint to be deployed.

        Information from the server will be fetched every 1s. If the Inference Endpoint is not deployed after `timeout`
        seconds, a [`InferenceEndpointTimeoutError`] will be raised. The [`InferenceEndpoint`] will be mutated in place with the latest
        data.

        Args:
            timeout (`int`, *optional*):
                The maximum time to wait for the Inference Endpoint to be deployed, in seconds. If `None`, will wait
                indefinitely.
            refresh_every (`int`, *optional*):
                The time to wait between each fetch of the Inference Endpoint status, in seconds. Defaults to 5s.

        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.

        Raises:
            [`InferenceEndpointError`]
                If the Inference Endpoint ended up in a failed state.
            [`InferenceEndpointTimeoutError`]
                If the Inference Endpoint is not deployed after `timeout` seconds.
        """
        if timeout is not None and timeout < 0:
            raise ValueError("`timeout` cannot be negative.")
        if refresh_every <= 0:
            raise ValueError("`refresh_every` must be positive.")

        start = time.time()
        while True:
            if self.status == InferenceEndpointStatus.FAILED:
                raise InferenceEndpointError(
                    f"Inference Endpoint {self.name} failed to deploy. Please check the logs for more information."
                )
            if self.status == InferenceEndpointStatus.UPDATE_FAILED:
                raise InferenceEndpointError(
                    f"Inference Endpoint {self.name} failed to update. Please check the logs for more information."
                )
            if self.status == InferenceEndpointStatus.RUNNING and self.url is not None:
                # Verify the endpoint is actually reachable
                _health_url = f"{self.url.rstrip('/')}/{self.health_route.lstrip('/')}"
                response = get_session().get(_health_url, headers=self._api._build_hf_headers(token=self._token))
                if response.status_code == 200:
                    logger.info("Inference Endpoint is ready to be used.")
                    return self

            if timeout is not None:
                if time.time() - start > timeout:
                    raise InferenceEndpointTimeoutError("Timeout while waiting for Inference Endpoint to be deployed.")
            logger.info(f"Inference Endpoint is not deployed yet ({self.status}). Waiting {refresh_every}s...")
            time.sleep(refresh_every)
            self.fetch()

    def fetch(self) -> "InferenceEndpoint":
        """Fetch latest information about the Inference Endpoint.

        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.
        """
        obj = self._api.get_inference_endpoint(name=self.name, namespace=self.namespace, token=self._token)  # type: ignore [arg-type]
        self.raw = obj.raw
        self._populate_from_raw()
        return self

    def update(
        self,
        *,
        # Compute update
        accelerator: Optional[str] = None,
        instance_size: Optional[str] = None,
        instance_type: Optional[str] = None,
        min_replica: Optional[int] = None,
        max_replica: Optional[int] = None,
        scale_to_zero_timeout: Optional[int] = None,
        # Model update
        repository: Optional[str] = None,
        framework: Optional[str] = None,
        revision: Optional[str] = None,
        task: Optional[str] = None,
        custom_image: Optional[Dict] = None,
        secrets: Optional[Dict[str, str]] = None,
    ) -> "InferenceEndpoint":
        """Update the Inference Endpoint.

        This method allows the update of either the compute configuration, the deployed model, or both. All arguments are
        optional but at least one must be provided.

        This is an alias for [`HfApi.update_inference_endpoint`]. The current object is mutated in place with the
        latest data from the server.

        Args:
            accelerator (`str`, *optional*):
                The hardware accelerator to be used for inference (e.g. `"cpu"`).
            instance_size (`str`, *optional*):
                The size or type of the instance to be used for hosting the model (e.g. `"x4"`).
            instance_type (`str`, *optional*):
                The cloud instance type where the Inference Endpoint will be deployed (e.g. `"intel-icl"`).
            min_replica (`int`, *optional*):
                The minimum number of replicas (instances) to keep running for the Inference Endpoint.
            max_replica (`int`, *optional*):
                The maximum number of replicas (instances) to scale to for the Inference Endpoint.
            scale_to_zero_timeout (`int`, *optional*):
                The duration in minutes before an inactive endpoint is scaled to zero.

            repository (`str`, *optional*):
                The name of the model repository associated with the Inference Endpoint (e.g. `"gpt2"`).
            framework (`str`, *optional*):
                The machine learning framework used for the model (e.g. `"custom"`).
            revision (`str`, *optional*):
                The specific model revision to deploy on the Inference Endpoint (e.g. `"6c0e6080953db56375760c0471a8c5f2929baf11"`).
            task (`str`, *optional*):
                The task on which to deploy the model (e.g. `"text-classification"`).
            custom_image (`Dict`, *optional*):
                A custom Docker image to use for the Inference Endpoint. This is useful if you want to deploy an
                Inference Endpoint running on the `text-generation-inference` (TGI) framework (see examples).
            secrets (`Dict[str, str]`, *optional*):
                Secret values to inject in the container environment.
        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.
        """
        # Make API call
        obj = self._api.update_inference_endpoint(
            name=self.name,
            namespace=self.namespace,
            accelerator=accelerator,
            instance_size=instance_size,
            instance_type=instance_type,
            min_replica=min_replica,
            max_replica=max_replica,
            scale_to_zero_timeout=scale_to_zero_timeout,
            repository=repository,
            framework=framework,
            revision=revision,
            task=task,
            custom_image=custom_image,
            secrets=secrets,
            token=self._token,  # type: ignore [arg-type]
        )

        # Mutate current object
        self.raw = obj.raw
        self._populate_from_raw()
        return self

    def pause(self) -> "InferenceEndpoint":
        """Pause the Inference Endpoint.

        A paused Inference Endpoint will not be charged. It can be resumed at any time using [`InferenceEndpoint.resume`].
        This is different than scaling the Inference Endpoint to zero with [`InferenceEndpoint.scale_to_zero`], which
        would be automatically restarted when a request is made to it.

        This is an alias for [`HfApi.pause_inference_endpoint`]. The current object is mutated in place with the
        latest data from the server.

        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.
        """
        obj = self._api.pause_inference_endpoint(name=self.name, namespace=self.namespace, token=self._token)  # type: ignore [arg-type]
        self.raw = obj.raw
        self._populate_from_raw()
        return self

    def resume(self, running_ok: bool = True) -> "InferenceEndpoint":
        """Resume the Inference Endpoint.

        This is an alias for [`HfApi.resume_inference_endpoint`]. The current object is mutated in place with the
        latest data from the server.

        Args:
            running_ok (`bool`, *optional*):
                If `True`, the method will not raise an error if the Inference Endpoint is already running. Defaults to
                `True`.

        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.
        """
        obj = self._api.resume_inference_endpoint(
            name=self.name, namespace=self.namespace, running_ok=running_ok, token=self._token
        )  # type: ignore [arg-type]
        self.raw = obj.raw
        self._populate_from_raw()
        return self

    def scale_to_zero(self) -> "InferenceEndpoint":
        """Scale Inference Endpoint to zero.

        An Inference Endpoint scaled to zero will not be charged. It will be resume on the next request to it, with a
        cold start delay. This is different than pausing the Inference Endpoint with [`InferenceEndpoint.pause`], which
        would require a manual resume with [`InferenceEndpoint.resume`].

        This is an alias for [`HfApi.scale_to_zero_inference_endpoint`]. The current object is mutated in place with the
        latest data from the server.

        Returns:
            [`InferenceEndpoint`]: the same Inference Endpoint, mutated in place with the latest data.
        """
        obj = self._api.scale_to_zero_inference_endpoint(name=self.name, namespace=self.namespace, token=self._token)  # type: ignore [arg-type]
        self.raw = obj.raw
        self._populate_from_raw()
        return self

    def delete(self) -> None:
        """Delete the Inference Endpoint.

        This operation is not reversible. If you don't want to be charged for an Inference Endpoint, it is preferable
        to pause it with [`InferenceEndpoint.pause`] or scale it to zero with [`InferenceEndpoint.scale_to_zero`].

        This is an alias for [`HfApi.delete_inference_endpoint`].
        """
        self._api.delete_inference_endpoint(name=self.name, namespace=self.namespace, token=self._token)  # type: ignore [arg-type]

    def _populate_from_raw(self) -> None:
        """Populate fields from raw dictionary.

        Called in __post_init__ + each time the Inference Endpoint is updated.
        """
        # Repr fields
        self.name = self.raw["name"]
        self.repository = self.raw["model"]["repository"]
        self.status = self.raw["status"]["state"]
        self.url = self.raw["status"].get("url")
        self.health_route = self.raw["healthRoute"]

        # Other fields
        self.framework = self.raw["model"]["framework"]
        self.revision = self.raw["model"]["revision"]
        self.task = self.raw["model"]["task"]
        self.created_at = parse_datetime(self.raw["status"]["createdAt"])
        self.updated_at = parse_datetime(self.raw["status"]["updatedAt"])
        self.type = self.raw["type"]

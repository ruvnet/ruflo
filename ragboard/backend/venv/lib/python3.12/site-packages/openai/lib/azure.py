from __future__ import annotations

import os
import inspect
from typing import Any, Union, Mapping, TypeVar, Callable, Awaitable, overload
from typing_extensions import Self, override

import httpx

from .._types import NOT_GIVEN, Omit, Timeout, NotGiven
from .._utils import is_given, is_mapping
from .._client import OpenAI, AsyncOpenAI
from .._models import FinalRequestOptions
from .._streaming import Stream, AsyncStream
from .._exceptions import OpenAIError
from .._base_client import DEFAULT_MAX_RETRIES, BaseClient

_deployments_endpoints = set(
    [
        "/completions",
        "/chat/completions",
        "/embeddings",
        "/audio/transcriptions",
        "/audio/translations",
        "/images/generations",
    ]
)


AzureADTokenProvider = Callable[[], str]
AsyncAzureADTokenProvider = Callable[[], "str | Awaitable[str]"]
_HttpxClientT = TypeVar("_HttpxClientT", bound=Union[httpx.Client, httpx.AsyncClient])
_DefaultStreamT = TypeVar("_DefaultStreamT", bound=Union[Stream[Any], AsyncStream[Any]])


# we need to use a sentinel API key value for Azure AD
# as we don't want to make the `api_key` in the main client Optional
# and Azure AD tokens may be retrieved on a per-request basis
API_KEY_SENTINEL = "".join(["<", "missing API key", ">"])


class MutuallyExclusiveAuthError(OpenAIError):
    def __init__(self) -> None:
        super().__init__(
            "The `api_key`, `azure_ad_token` and `azure_ad_token_provider` arguments are mutually exclusive; Only one can be passed at a time"
        )


class BaseAzureClient(BaseClient[_HttpxClientT, _DefaultStreamT]):
    @override
    def _build_request(
        self,
        options: FinalRequestOptions,
    ) -> httpx.Request:
        if options.url in _deployments_endpoints and is_mapping(options.json_data):
            model = options.json_data.get("model")
            if model is not None and not "/deployments" in str(self.base_url):
                options.url = f"/deployments/{model}{options.url}"

        return super()._build_request(options)


class AzureOpenAI(BaseAzureClient[httpx.Client, Stream[Any]], OpenAI):
    @overload
    def __init__(
        self,
        *,
        azure_endpoint: str,
        azure_deployment: str | None = None,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.Client | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    @overload
    def __init__(
        self,
        *,
        azure_deployment: str | None = None,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.Client | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    @overload
    def __init__(
        self,
        *,
        base_url: str,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.Client | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    def __init__(
        self,
        *,
        api_version: str | None = None,
        azure_endpoint: str | None = None,
        azure_deployment: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AzureADTokenProvider | None = None,
        organization: str | None = None,
        base_url: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.Client | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        """Construct a new synchronous azure openai client instance.

        This automatically infers the following arguments from their corresponding environment variables if they are not provided:
        - `api_key` from `AZURE_OPENAI_API_KEY`
        - `organization` from `OPENAI_ORG_ID`
        - `azure_ad_token` from `AZURE_OPENAI_AD_TOKEN`
        - `api_version` from `OPENAI_API_VERSION`
        - `azure_endpoint` from `AZURE_OPENAI_ENDPOINT`

        Args:
            azure_endpoint: Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`

            azure_ad_token: Your Azure Active Directory token, https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-id

            azure_ad_token_provider: A function that returns an Azure Active Directory token, will be invoked on every request.

            azure_deployment: A model deployment, if given sets the base client URL to include `/deployments/{azure_deployment}`.
                Note: this means you won't be able to use non-deployment endpoints.
        """
        if api_key is None:
            api_key = os.environ.get("AZURE_OPENAI_API_KEY")

        if azure_ad_token is None:
            azure_ad_token = os.environ.get("AZURE_OPENAI_AD_TOKEN")

        if api_key is None and azure_ad_token is None and azure_ad_token_provider is None:
            raise OpenAIError(
                "Missing credentials. Please pass one of `api_key`, `azure_ad_token`, `azure_ad_token_provider`, or the `AZURE_OPENAI_API_KEY` or `AZURE_OPENAI_AD_TOKEN` environment variables."
            )

        if api_version is None:
            api_version = os.environ.get("OPENAI_API_VERSION")

        if api_version is None:
            raise ValueError(
                "Must provide either the `api_version` argument or the `OPENAI_API_VERSION` environment variable"
            )

        if default_query is None:
            default_query = {"api-version": api_version}
        else:
            default_query = {**default_query, "api-version": api_version}

        if base_url is None:
            if azure_endpoint is None:
                azure_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")

            if azure_endpoint is None:
                raise ValueError(
                    "Must provide one of the `base_url` or `azure_endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable"
                )

            if azure_deployment is not None:
                base_url = f"{azure_endpoint}/openai/deployments/{azure_deployment}"
            else:
                base_url = f"{azure_endpoint}/openai"
        else:
            if azure_endpoint is not None:
                raise ValueError("base_url and azure_endpoint are mutually exclusive")

        if api_key is None:
            # define a sentinel value to avoid any typing issues
            api_key = API_KEY_SENTINEL

        super().__init__(
            api_key=api_key,
            organization=organization,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=default_headers,
            default_query=default_query,
            http_client=http_client,
            _strict_response_validation=_strict_response_validation,
        )
        self._api_version = api_version
        self._azure_ad_token = azure_ad_token
        self._azure_ad_token_provider = azure_ad_token_provider

    @override
    def copy(
        self,
        *,
        api_key: str | None = None,
        organization: str | None = None,
        api_version: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AzureADTokenProvider | None = None,
        base_url: str | httpx.URL | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        http_client: httpx.Client | None = None,
        max_retries: int | NotGiven = NOT_GIVEN,
        default_headers: Mapping[str, str] | None = None,
        set_default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        set_default_query: Mapping[str, object] | None = None,
        _extra_kwargs: Mapping[str, Any] = {},
    ) -> Self:
        """
        Create a new client instance re-using the same options given to the current client with optional overriding.
        """
        return super().copy(
            api_key=api_key,
            organization=organization,
            base_url=base_url,
            timeout=timeout,
            http_client=http_client,
            max_retries=max_retries,
            default_headers=default_headers,
            set_default_headers=set_default_headers,
            default_query=default_query,
            set_default_query=set_default_query,
            _extra_kwargs={
                "api_version": api_version or self._api_version,
                "azure_ad_token": azure_ad_token or self._azure_ad_token,
                "azure_ad_token_provider": azure_ad_token_provider or self._azure_ad_token_provider,
                **_extra_kwargs,
            },
        )

    with_options = copy

    def _get_azure_ad_token(self) -> str | None:
        if self._azure_ad_token is not None:
            return self._azure_ad_token

        provider = self._azure_ad_token_provider
        if provider is not None:
            token = provider()
            if not token or not isinstance(token, str):  # pyright: ignore[reportUnnecessaryIsInstance]
                raise ValueError(
                    f"Expected `azure_ad_token_provider` argument to return a string but it returned {token}",
                )
            return token

        return None

    @override
    def _prepare_options(self, options: FinalRequestOptions) -> None:
        headers: dict[str, str | Omit] = {**options.headers} if is_given(options.headers) else {}
        options.headers = headers

        azure_ad_token = self._get_azure_ad_token()
        if azure_ad_token is not None:
            if headers.get("Authorization") is None:
                headers["Authorization"] = f"Bearer {azure_ad_token}"
        elif self.api_key is not API_KEY_SENTINEL:
            if headers.get("api-key") is None:
                headers["api-key"] = self.api_key
        else:
            # should never be hit
            raise ValueError("Unable to handle auth")

        return super()._prepare_options(options)


class AsyncAzureOpenAI(BaseAzureClient[httpx.AsyncClient, AsyncStream[Any]], AsyncOpenAI):
    @overload
    def __init__(
        self,
        *,
        azure_endpoint: str,
        azure_deployment: str | None = None,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AsyncAzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.AsyncClient | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    @overload
    def __init__(
        self,
        *,
        azure_deployment: str | None = None,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AsyncAzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.AsyncClient | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    @overload
    def __init__(
        self,
        *,
        base_url: str,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AsyncAzureADTokenProvider | None = None,
        organization: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.AsyncClient | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        ...

    def __init__(
        self,
        *,
        azure_endpoint: str | None = None,
        azure_deployment: str | None = None,
        api_version: str | None = None,
        api_key: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AsyncAzureADTokenProvider | None = None,
        organization: str | None = None,
        base_url: str | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        http_client: httpx.AsyncClient | None = None,
        _strict_response_validation: bool = False,
    ) -> None:
        """Construct a new asynchronous azure openai client instance.

        This automatically infers the following arguments from their corresponding environment variables if they are not provided:
        - `api_key` from `AZURE_OPENAI_API_KEY`
        - `organization` from `OPENAI_ORG_ID`
        - `azure_ad_token` from `AZURE_OPENAI_AD_TOKEN`
        - `api_version` from `OPENAI_API_VERSION`
        - `azure_endpoint` from `AZURE_OPENAI_ENDPOINT`

        Args:
            azure_endpoint: Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`

            azure_ad_token: Your Azure Active Directory token, https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-id

            azure_ad_token_provider: A function that returns an Azure Active Directory token, will be invoked on every request.

            azure_deployment: A model deployment, if given sets the base client URL to include `/deployments/{azure_deployment}`.
                Note: this means you won't be able to use non-deployment endpoints.
        """
        if api_key is None:
            api_key = os.environ.get("AZURE_OPENAI_API_KEY")

        if azure_ad_token is None:
            azure_ad_token = os.environ.get("AZURE_OPENAI_AD_TOKEN")

        if api_key is None and azure_ad_token is None and azure_ad_token_provider is None:
            raise OpenAIError(
                "Missing credentials. Please pass one of `api_key`, `azure_ad_token`, `azure_ad_token_provider`, or the `AZURE_OPENAI_API_KEY` or `AZURE_OPENAI_AD_TOKEN` environment variables."
            )

        if api_version is None:
            api_version = os.environ.get("OPENAI_API_VERSION")

        if api_version is None:
            raise ValueError(
                "Must provide either the `api_version` argument or the `OPENAI_API_VERSION` environment variable"
            )

        if default_query is None:
            default_query = {"api-version": api_version}
        else:
            default_query = {**default_query, "api-version": api_version}

        if base_url is None:
            if azure_endpoint is None:
                azure_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")

            if azure_endpoint is None:
                raise ValueError(
                    "Must provide one of the `base_url` or `azure_endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable"
                )

            if azure_deployment is not None:
                base_url = f"{azure_endpoint}/openai/deployments/{azure_deployment}"
            else:
                base_url = f"{azure_endpoint}/openai"
        else:
            if azure_endpoint is not None:
                raise ValueError("base_url and azure_endpoint are mutually exclusive")

        if api_key is None:
            # define a sentinel value to avoid any typing issues
            api_key = API_KEY_SENTINEL

        super().__init__(
            api_key=api_key,
            organization=organization,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=default_headers,
            default_query=default_query,
            http_client=http_client,
            _strict_response_validation=_strict_response_validation,
        )
        self._api_version = api_version
        self._azure_ad_token = azure_ad_token
        self._azure_ad_token_provider = azure_ad_token_provider

    @override
    def copy(
        self,
        *,
        api_key: str | None = None,
        organization: str | None = None,
        api_version: str | None = None,
        azure_ad_token: str | None = None,
        azure_ad_token_provider: AsyncAzureADTokenProvider | None = None,
        base_url: str | httpx.URL | None = None,
        timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int | NotGiven = NOT_GIVEN,
        default_headers: Mapping[str, str] | None = None,
        set_default_headers: Mapping[str, str] | None = None,
        default_query: Mapping[str, object] | None = None,
        set_default_query: Mapping[str, object] | None = None,
        _extra_kwargs: Mapping[str, Any] = {},
    ) -> Self:
        """
        Create a new client instance re-using the same options given to the current client with optional overriding.
        """
        return super().copy(
            api_key=api_key,
            organization=organization,
            base_url=base_url,
            timeout=timeout,
            http_client=http_client,
            max_retries=max_retries,
            default_headers=default_headers,
            set_default_headers=set_default_headers,
            default_query=default_query,
            set_default_query=set_default_query,
            _extra_kwargs={
                "api_version": api_version or self._api_version,
                "azure_ad_token": azure_ad_token or self._azure_ad_token,
                "azure_ad_token_provider": azure_ad_token_provider or self._azure_ad_token_provider,
                **_extra_kwargs,
            },
        )

    with_options = copy

    async def _get_azure_ad_token(self) -> str | None:
        if self._azure_ad_token is not None:
            return self._azure_ad_token

        provider = self._azure_ad_token_provider
        if provider is not None:
            token = provider()
            if inspect.isawaitable(token):
                token = await token
            if not token or not isinstance(token, str):
                raise ValueError(
                    f"Expected `azure_ad_token_provider` argument to return a string but it returned {token}",
                )
            return token

        return None

    @override
    async def _prepare_options(self, options: FinalRequestOptions) -> None:
        headers: dict[str, str | Omit] = {**options.headers} if is_given(options.headers) else {}
        options.headers = headers

        azure_ad_token = await self._get_azure_ad_token()
        if azure_ad_token is not None:
            if headers.get("Authorization") is None:
                headers["Authorization"] = f"Bearer {azure_ad_token}"
        elif self.api_key is not API_KEY_SENTINEL:
            if headers.get("api-key") is None:
                headers["api-key"] = self.api_key
        else:
            # should never be hit
            raise ValueError("Unable to handle auth")

        return await super()._prepare_options(options)

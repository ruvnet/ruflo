# coding=utf-8
# Copyright 2023-present, the HuggingFace Inc. team.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Contains `WebhooksServer` and `webhook_endpoint` to create a webhook server easily."""

import atexit
import inspect
import os
from functools import wraps
from typing import TYPE_CHECKING, Any, Callable, Dict, Optional

from .utils import experimental, is_fastapi_available, is_gradio_available


if TYPE_CHECKING:
    import gradio as gr
    from fastapi import Request

if is_fastapi_available():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
else:
    # Will fail at runtime if FastAPI is not available
    FastAPI = Request = JSONResponse = None  # type: ignore [misc, assignment]


_global_app: Optional["WebhooksServer"] = None
_is_local = os.environ.get("SPACE_ID") is None


@experimental
class WebhooksServer:
    """
    The [`WebhooksServer`] class lets you create an instance of a Gradio app that can receive Huggingface webhooks.
    These webhooks can be registered using the [`~WebhooksServer.add_webhook`] decorator. Webhook endpoints are added to
    the app as a POST endpoint to the FastAPI router. Once all the webhooks are registered, the `launch` method has to be
    called to start the app.

    It is recommended to accept [`WebhookPayload`] as the first argument of the webhook function. It is a Pydantic
    model that contains all the information about the webhook event. The data will be parsed automatically for you.

    Check out the [webhooks guide](../guides/webhooks_server) for a step-by-step tutorial on how to setup your
    WebhooksServer and deploy it on a Space.

    <Tip warning={true}>

    `WebhooksServer` is experimental. Its API is subject to change in the future.

    </Tip>

    <Tip warning={true}>

    You must have `gradio` installed to use `WebhooksServer` (`pip install --upgrade gradio`).

    </Tip>

    Args:
        ui (`gradio.Blocks`, optional):
            A Gradio UI instance to be used as the Space landing page. If `None`, a UI displaying instructions
            about the configured webhooks is created.
        webhook_secret (`str`, optional):
            A secret key to verify incoming webhook requests. You can set this value to any secret you want as long as
            you also configure it in your [webhooks settings panel](https://huggingface.co/settings/webhooks). You
            can also set this value as the `WEBHOOK_SECRET` environment variable. If no secret is provided, the
            webhook endpoints are opened without any security.

    Example:

        ```python
        import gradio as gr
        from huggingface_hub import WebhooksServer, WebhookPayload

        with gr.Blocks() as ui:
            ...

        app = WebhooksServer(ui=ui, webhook_secret="my_secret_key")

        @app.add_webhook("/say_hello")
        async def hello(payload: WebhookPayload):
            return {"message": "hello"}

        app.launch()
        ```
    """

    def __new__(cls, *args, **kwargs) -> "WebhooksServer":
        if not is_gradio_available():
            raise ImportError(
                "You must have `gradio` installed to use `WebhooksServer`. Please run `pip install --upgrade gradio`"
                " first."
            )
        if not is_fastapi_available():
            raise ImportError(
                "You must have `fastapi` installed to use `WebhooksServer`. Please run `pip install --upgrade fastapi`"
                " first."
            )
        return super().__new__(cls)

    def __init__(
        self,
        ui: Optional["gr.Blocks"] = None,
        webhook_secret: Optional[str] = None,
    ) -> None:
        self._ui = ui

        self.webhook_secret = webhook_secret or os.getenv("WEBHOOK_SECRET")
        self.registered_webhooks: Dict[str, Callable] = {}
        _warn_on_empty_secret(self.webhook_secret)

    def add_webhook(self, path: Optional[str] = None) -> Callable:
        """
        Decorator to add a webhook to the [`WebhooksServer`] server.

        Args:
            path (`str`, optional):
                The URL path to register the webhook function. If not provided, the function name will be used as the
                path. In any case, all webhooks are registered under `/webhooks`.

        Raises:
            ValueError: If the provided path is already registered as a webhook.

        Example:
            ```python
            from huggingface_hub import WebhooksServer, WebhookPayload

            app = WebhooksServer()

            @app.add_webhook
            async def trigger_training(payload: WebhookPayload):
                if payload.repo.type == "dataset" and payload.event.action == "update":
                    # Trigger a training job if a dataset is updated
                    ...

            app.launch()
        ```
        """
        # Usage: directly as decorator. Example: `@app.add_webhook`
        if callable(path):
            # If path is a function, it means it was used as a decorator without arguments
            return self.add_webhook()(path)

        # Usage: provide a path. Example: `@app.add_webhook(...)`
        @wraps(FastAPI.post)
        def _inner_post(*args, **kwargs):
            func = args[0]
            abs_path = f"/webhooks/{(path or func.__name__).strip('/')}"
            if abs_path in self.registered_webhooks:
                raise ValueError(f"Webhook {abs_path} already exists.")
            self.registered_webhooks[abs_path] = func

        return _inner_post

    def launch(self, prevent_thread_lock: bool = False, **launch_kwargs: Any) -> None:
        """Launch the Gradio app and register webhooks to the underlying FastAPI server.

        Input parameters are forwarded to Gradio when launching the app.
        """
        ui = self._ui or self._get_default_ui()

        # Start Gradio App
        #   - as non-blocking so that webhooks can be added afterwards
        #   - as shared if launch locally (to debug webhooks)
        launch_kwargs.setdefault("share", _is_local)
        self.fastapi_app, _, _ = ui.launch(prevent_thread_lock=True, **launch_kwargs)

        # Register webhooks to FastAPI app
        for path, func in self.registered_webhooks.items():
            # Add secret check if required
            if self.webhook_secret is not None:
                func = _wrap_webhook_to_check_secret(func, webhook_secret=self.webhook_secret)

            # Add route to FastAPI app
            self.fastapi_app.post(path)(func)

        # Print instructions and block main thread
        space_host = os.environ.get("SPACE_HOST")
        url = "https://" + space_host if space_host is not None else (ui.share_url or ui.local_url)
        if url is None:
            raise ValueError("Cannot find the URL of the app. Please provide a valid `ui` or update `gradio` version.")
        url = url.strip("/")
        message = "\nWebhooks are correctly setup and ready to use:"
        message += "\n" + "\n".join(f"  - POST {url}{webhook}" for webhook in self.registered_webhooks)
        message += "\nGo to https://huggingface.co/settings/webhooks to setup your webhooks."
        print(message)

        if not prevent_thread_lock:
            ui.block_thread()

    def _get_default_ui(self) -> "gr.Blocks":
        """Default UI if not provided (lists webhooks and provides basic instructions)."""
        import gradio as gr

        with gr.Blocks() as ui:
            gr.Markdown("# This is an app to process 🤗 Webhooks")
            gr.Markdown(
                "Webhooks are a foundation for MLOps-related features. They allow you to listen for new changes on"
                " specific repos or to all repos belonging to particular set of users/organizations (not just your"
                " repos, but any repo). Check out this [guide](https://huggingface.co/docs/hub/webhooks) to get to"
                " know more about webhooks on the Huggingface Hub."
            )
            gr.Markdown(
                f"{len(self.registered_webhooks)} webhook(s) are registered:"
                + "\n\n"
                + "\n ".join(
                    f"- [{webhook_path}]({_get_webhook_doc_url(webhook.__name__, webhook_path)})"
                    for webhook_path, webhook in self.registered_webhooks.items()
                )
            )
            gr.Markdown(
                "Go to https://huggingface.co/settings/webhooks to setup your webhooks."
                + "\nYou app is running locally. Please look at the logs to check the full URL you need to set."
                if _is_local
                else (
                    "\nThis app is running on a Space. You can find the corresponding URL in the options menu"
                    " (top-right) > 'Embed the Space'. The URL looks like 'https://{username}-{repo_name}.hf.space'."
                )
            )
        return ui


@experimental
def webhook_endpoint(path: Optional[str] = None) -> Callable:
    """Decorator to start a [`WebhooksServer`] and register the decorated function as a webhook endpoint.

    This is a helper to get started quickly. If you need more flexibility (custom landing page or webhook secret),
    you can use [`WebhooksServer`] directly. You can register multiple webhook endpoints (to the same server) by using
    this decorator multiple times.

    Check out the [webhooks guide](../guides/webhooks_server) for a step-by-step tutorial on how to setup your
    server and deploy it on a Space.

    <Tip warning={true}>

    `webhook_endpoint` is experimental. Its API is subject to change in the future.

    </Tip>

    <Tip warning={true}>

    You must have `gradio` installed to use `webhook_endpoint` (`pip install --upgrade gradio`).

    </Tip>

    Args:
        path (`str`, optional):
            The URL path to register the webhook function. If not provided, the function name will be used as the path.
            In any case, all webhooks are registered under `/webhooks`.

    Examples:
        The default usage is to register a function as a webhook endpoint. The function name will be used as the path.
        The server will be started automatically at exit (i.e. at the end of the script).

        ```python
        from huggingface_hub import webhook_endpoint, WebhookPayload

        @webhook_endpoint
        async def trigger_training(payload: WebhookPayload):
            if payload.repo.type == "dataset" and payload.event.action == "update":
                # Trigger a training job if a dataset is updated
                ...

        # Server is automatically started at the end of the script.
        ```

        Advanced usage: register a function as a webhook endpoint and start the server manually. This is useful if you
        are running it in a notebook.

        ```python
        from huggingface_hub import webhook_endpoint, WebhookPayload

        @webhook_endpoint
        async def trigger_training(payload: WebhookPayload):
            if payload.repo.type == "dataset" and payload.event.action == "update":
                # Trigger a training job if a dataset is updated
                ...

        # Start the server manually
        trigger_training.launch()
        ```
    """
    if callable(path):
        # If path is a function, it means it was used as a decorator without arguments
        return webhook_endpoint()(path)

    @wraps(WebhooksServer.add_webhook)
    def _inner(func: Callable) -> Callable:
        app = _get_global_app()
        app.add_webhook(path)(func)
        if len(app.registered_webhooks) == 1:
            # Register `app.launch` to run at exit (only once)
            atexit.register(app.launch)

        @wraps(app.launch)
        def _launch_now():
            # Run the app directly (without waiting atexit)
            atexit.unregister(app.launch)
            app.launch()

        func.launch = _launch_now  # type: ignore
        return func

    return _inner


def _get_global_app() -> WebhooksServer:
    global _global_app
    if _global_app is None:
        _global_app = WebhooksServer()
    return _global_app


def _warn_on_empty_secret(webhook_secret: Optional[str]) -> None:
    if webhook_secret is None:
        print("Webhook secret is not defined. This means your webhook endpoints will be open to everyone.")
        print(
            "To add a secret, set `WEBHOOK_SECRET` as environment variable or pass it at initialization: "
            "\n\t`app = WebhooksServer(webhook_secret='my_secret', ...)`"
        )
        print(
            "For more details about webhook secrets, please refer to"
            " https://huggingface.co/docs/hub/webhooks#webhook-secret."
        )
    else:
        print("Webhook secret is correctly defined.")


def _get_webhook_doc_url(webhook_name: str, webhook_path: str) -> str:
    """Returns the anchor to a given webhook in the docs (experimental)"""
    return "/docs#/default/" + webhook_name + webhook_path.replace("/", "_") + "_post"


def _wrap_webhook_to_check_secret(func: Callable, webhook_secret: str) -> Callable:
    """Wraps a webhook function to check the webhook secret before calling the function.

    This is a hacky way to add the `request` parameter to the function signature. Since FastAPI based itself on route
    parameters to inject the values to the function, we need to hack the function signature to retrieve the `Request`
    object (and hence the headers). A far cleaner solution would be to use a middleware. However, since
    `fastapi==0.90.1`, a middleware cannot be added once the app has started. And since the FastAPI app is started by
    Gradio internals (and not by us), we cannot add a middleware.

    This method is called only when a secret has been defined by the user. If a request is sent without the
    "x-webhook-secret", the function will return a 401 error (unauthorized). If the header is sent but is incorrect,
    the function will return a 403 error (forbidden).

    Inspired by https://stackoverflow.com/a/33112180.
    """
    initial_sig = inspect.signature(func)

    @wraps(func)
    async def _protected_func(request: Request, **kwargs):
        request_secret = request.headers.get("x-webhook-secret")
        if request_secret is None:
            return JSONResponse({"error": "x-webhook-secret header not set."}, status_code=401)
        if request_secret != webhook_secret:
            return JSONResponse({"error": "Invalid webhook secret."}, status_code=403)

        # Inject `request` in kwargs if required
        if "request" in initial_sig.parameters:
            kwargs["request"] = request

        # Handle both sync and async routes
        if inspect.iscoroutinefunction(func):
            return await func(**kwargs)
        else:
            return func(**kwargs)

    # Update signature to include request
    if "request" not in initial_sig.parameters:
        _protected_func.__signature__ = initial_sig.replace(  # type: ignore
            parameters=(
                inspect.Parameter(name="request", kind=inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=Request),
            )
            + tuple(initial_sig.parameters.values())
        )

    # Return protected route
    return _protected_func

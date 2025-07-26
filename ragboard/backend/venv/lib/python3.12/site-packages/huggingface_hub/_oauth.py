import datetime
import hashlib
import logging
import os
import time
import urllib.parse
import warnings
from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple, Union

from . import constants
from .hf_api import whoami
from .utils import experimental, get_token


logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    import fastapi


@dataclass
class OAuthOrgInfo:
    """
    Information about an organization linked to a user logged in with OAuth.

    Attributes:
        sub (`str`):
            Unique identifier for the org. OpenID Connect field.
        name (`str`):
            The org's full name. OpenID Connect field.
        preferred_username (`str`):
            The org's username. OpenID Connect field.
        picture (`str`):
            The org's profile picture URL. OpenID Connect field.
        is_enterprise (`bool`):
            Whether the org is an enterprise org. Hugging Face field.
        can_pay (`Optional[bool]`, *optional*):
            Whether the org has a payment method set up. Hugging Face field.
        role_in_org (`Optional[str]`, *optional*):
            The user's role in the org. Hugging Face field.
        pending_sso (`Optional[bool]`, *optional*):
            Indicates if the user granted the OAuth app access to the org but didn't complete SSO. Hugging Face field.
        missing_mfa (`Optional[bool]`, *optional*):
            Indicates if the user granted the OAuth app access to the org but didn't complete MFA. Hugging Face field.
    """

    sub: str
    name: str
    preferred_username: str
    picture: str
    is_enterprise: bool
    can_pay: Optional[bool] = None
    role_in_org: Optional[str] = None
    pending_sso: Optional[bool] = None
    missing_mfa: Optional[bool] = None


@dataclass
class OAuthUserInfo:
    """
    Information about a user logged in with OAuth.

    Attributes:
        sub (`str`):
            Unique identifier for the user, even in case of rename. OpenID Connect field.
        name (`str`):
            The user's full name. OpenID Connect field.
        preferred_username (`str`):
            The user's username. OpenID Connect field.
        email_verified (`Optional[bool]`, *optional*):
            Indicates if the user's email is verified. OpenID Connect field.
        email (`Optional[str]`, *optional*):
            The user's email address. OpenID Connect field.
        picture (`str`):
            The user's profile picture URL. OpenID Connect field.
        profile (`str`):
            The user's profile URL. OpenID Connect field.
        website (`Optional[str]`, *optional*):
            The user's website URL. OpenID Connect field.
        is_pro (`bool`):
            Whether the user is a pro user. Hugging Face field.
        can_pay (`Optional[bool]`, *optional*):
            Whether the user has a payment method set up. Hugging Face field.
        orgs (`Optional[List[OrgInfo]]`, *optional*):
            List of organizations the user is part of. Hugging Face field.
    """

    sub: str
    name: str
    preferred_username: str
    email_verified: Optional[bool]
    email: Optional[str]
    picture: str
    profile: str
    website: Optional[str]
    is_pro: bool
    can_pay: Optional[bool]
    orgs: Optional[List[OAuthOrgInfo]]


@dataclass
class OAuthInfo:
    """
    Information about the OAuth login.

    Attributes:
        access_token (`str`):
            The access token.
        access_token_expires_at (`datetime.datetime`):
            The expiration date of the access token.
        user_info ([`OAuthUserInfo`]):
            The user information.
        state (`str`, *optional*):
            State passed to the OAuth provider in the original request to the OAuth provider.
        scope (`str`):
            Granted scope.
    """

    access_token: str
    access_token_expires_at: datetime.datetime
    user_info: OAuthUserInfo
    state: Optional[str]
    scope: str


@experimental
def attach_huggingface_oauth(app: "fastapi.FastAPI", route_prefix: str = "/"):
    """
    Add OAuth endpoints to a FastAPI app to enable OAuth login with Hugging Face.

    How to use:
    - Call this method on your FastAPI app to add the OAuth endpoints.
    - Inside your route handlers, call `parse_huggingface_oauth(request)` to retrieve the OAuth info.
    - If user is logged in, an [`OAuthInfo`] object is returned with the user's info. If not, `None` is returned.
    - In your app, make sure to add links to `/oauth/huggingface/login` and `/oauth/huggingface/logout` for the user to log in and out.

    Example:
    ```py
    from huggingface_hub import attach_huggingface_oauth, parse_huggingface_oauth

    # Create a FastAPI app
    app = FastAPI()

    # Add OAuth endpoints to the FastAPI app
    attach_huggingface_oauth(app)

    # Add a route that greets the user if they are logged in
    @app.get("/")
    def greet_json(request: Request):
        # Retrieve the OAuth info from the request
        oauth_info = parse_huggingface_oauth(request)  # e.g. OAuthInfo dataclass
        if oauth_info is None:
            return {"msg": "Not logged in!"}
        return {"msg": f"Hello, {oauth_info.user_info.preferred_username}!"}
    ```
    """
    # TODO: handle generic case (handling OAuth in a non-Space environment with custom dev values) (low priority)

    # Add SessionMiddleware to the FastAPI app to store the OAuth info in the session.
    # Session Middleware requires a secret key to sign the cookies. Let's use a hash
    # of the OAuth secret key to make it unique to the Space + updated in case OAuth
    # config gets updated. When ran locally, we use an empty string as a secret key.
    try:
        from starlette.middleware.sessions import SessionMiddleware
    except ImportError as e:
        raise ImportError(
            "Cannot initialize OAuth to due a missing library. Please run `pip install huggingface_hub[oauth]` or add "
            "`huggingface_hub[oauth]` to your requirements.txt file in order to install the required dependencies."
        ) from e
    session_secret = (constants.OAUTH_CLIENT_SECRET or "") + "-v1"
    app.add_middleware(
        SessionMiddleware,  # type: ignore[arg-type]
        secret_key=hashlib.sha256(session_secret.encode()).hexdigest(),
        same_site="none",
        https_only=True,
    )  # type: ignore

    # Add OAuth endpoints to the FastAPI app:
    #   - {route_prefix}/oauth/huggingface/login
    #   - {route_prefix}/oauth/huggingface/callback
    #   - {route_prefix}/oauth/huggingface/logout
    # If the app is running in a Space, OAuth is enabled normally.
    # Otherwise, we mock the endpoints to make the user log in with a fake user profile - without any calls to hf.co.
    route_prefix = route_prefix.strip("/")
    if os.getenv("SPACE_ID") is not None:
        logger.info("OAuth is enabled in the Space. Adding OAuth routes.")
        _add_oauth_routes(app, route_prefix=route_prefix)
    else:
        logger.info("App is not running in a Space. Adding mocked OAuth routes.")
        _add_mocked_oauth_routes(app, route_prefix=route_prefix)


def parse_huggingface_oauth(request: "fastapi.Request") -> Optional[OAuthInfo]:
    """
    Returns the information from a logged in user as a [`OAuthInfo`] object.

    For flexibility and future-proofing, this method is very lax in its parsing and does not raise errors.
    Missing fields are set to `None` without a warning.

    Return `None`, if the user is not logged in (no info in session cookie).

    See [`attach_huggingface_oauth`] for an example on how to use this method.
    """
    if "oauth_info" not in request.session:
        logger.debug("No OAuth info in session.")
        return None

    logger.debug("Parsing OAuth info from session.")
    oauth_data = request.session["oauth_info"]
    user_data = oauth_data.get("userinfo", {})
    orgs_data = user_data.get("orgs", [])

    orgs = (
        [
            OAuthOrgInfo(
                sub=org.get("sub"),
                name=org.get("name"),
                preferred_username=org.get("preferred_username"),
                picture=org.get("picture"),
                is_enterprise=org.get("isEnterprise"),
                can_pay=org.get("canPay"),
                role_in_org=org.get("roleInOrg"),
                pending_sso=org.get("pendingSSO"),
                missing_mfa=org.get("missingMFA"),
            )
            for org in orgs_data
        ]
        if orgs_data
        else None
    )

    user_info = OAuthUserInfo(
        sub=user_data.get("sub"),
        name=user_data.get("name"),
        preferred_username=user_data.get("preferred_username"),
        email_verified=user_data.get("email_verified"),
        email=user_data.get("email"),
        picture=user_data.get("picture"),
        profile=user_data.get("profile"),
        website=user_data.get("website"),
        is_pro=user_data.get("isPro"),
        can_pay=user_data.get("canPay"),
        orgs=orgs,
    )

    return OAuthInfo(
        access_token=oauth_data.get("access_token"),
        access_token_expires_at=datetime.datetime.fromtimestamp(oauth_data.get("expires_at")),
        user_info=user_info,
        state=oauth_data.get("state"),
        scope=oauth_data.get("scope"),
    )


def _add_oauth_routes(app: "fastapi.FastAPI", route_prefix: str) -> None:
    """Add OAuth routes to the FastAPI app (login, callback handler and logout)."""
    try:
        import fastapi
        from authlib.integrations.base_client.errors import MismatchingStateError
        from authlib.integrations.starlette_client import OAuth
        from fastapi.responses import RedirectResponse
    except ImportError as e:
        raise ImportError(
            "Cannot initialize OAuth to due a missing library. Please run `pip install huggingface_hub[oauth]` or add "
            "`huggingface_hub[oauth]` to your requirements.txt file."
        ) from e

    # Check environment variables
    msg = (
        "OAuth is required but '{}' environment variable is not set. Make sure you've enabled OAuth in your Space by"
        " setting `hf_oauth: true` in the Space metadata."
    )
    if constants.OAUTH_CLIENT_ID is None:
        raise ValueError(msg.format("OAUTH_CLIENT_ID"))
    if constants.OAUTH_CLIENT_SECRET is None:
        raise ValueError(msg.format("OAUTH_CLIENT_SECRET"))
    if constants.OAUTH_SCOPES is None:
        raise ValueError(msg.format("OAUTH_SCOPES"))
    if constants.OPENID_PROVIDER_URL is None:
        raise ValueError(msg.format("OPENID_PROVIDER_URL"))

    # Register OAuth server
    oauth = OAuth()
    oauth.register(
        name="huggingface",
        client_id=constants.OAUTH_CLIENT_ID,
        client_secret=constants.OAUTH_CLIENT_SECRET,
        client_kwargs={"scope": constants.OAUTH_SCOPES},
        server_metadata_url=constants.OPENID_PROVIDER_URL + "/.well-known/openid-configuration",
    )

    login_uri, callback_uri, logout_uri = _get_oauth_uris(route_prefix)

    # Register OAuth endpoints
    @app.get(login_uri)
    async def oauth_login(request: fastapi.Request) -> RedirectResponse:
        """Endpoint that redirects to HF OAuth page."""
        redirect_uri = _generate_redirect_uri(request)
        return await oauth.huggingface.authorize_redirect(request, redirect_uri)  # type: ignore

    @app.get(callback_uri)
    async def oauth_redirect_callback(request: fastapi.Request) -> RedirectResponse:
        """Endpoint that handles the OAuth callback."""
        try:
            oauth_info = await oauth.huggingface.authorize_access_token(request)  # type: ignore
        except MismatchingStateError:
            # Parse query params
            nb_redirects = int(request.query_params.get("_nb_redirects", 0))
            target_url = request.query_params.get("_target_url")

            # Build redirect URI with the same query params as before and bump nb_redirects count
            query_params: Dict[str, Union[int, str]] = {"_nb_redirects": nb_redirects + 1}
            if target_url:
                query_params["_target_url"] = target_url

            redirect_uri = f"{login_uri}?{urllib.parse.urlencode(query_params)}"

            # If the user is redirected more than 3 times, it is very likely that the cookie is not working properly.
            # (e.g. browser is blocking third-party cookies in iframe). In this case, redirect the user in the
            # non-iframe view.
            if nb_redirects > constants.OAUTH_MAX_REDIRECTS:
                host = os.environ.get("SPACE_HOST")
                if host is None:  # cannot happen in a Space
                    raise RuntimeError(
                        "App is not running in a Space (SPACE_HOST environment variable is not set). Cannot redirect to non-iframe view."
                    ) from None
                host_url = "https://" + host.rstrip("/")
                return RedirectResponse(host_url + redirect_uri)

            # Redirect the user to the login page again
            return RedirectResponse(redirect_uri)

        # OAuth login worked => store the user info in the session and redirect
        logger.debug("Successfully logged in with OAuth. Storing user info in session.")
        request.session["oauth_info"] = oauth_info
        return RedirectResponse(_get_redirect_target(request))

    @app.get(logout_uri)
    async def oauth_logout(request: fastapi.Request) -> RedirectResponse:
        """Endpoint that logs out the user (e.g. delete info from cookie session)."""
        logger.debug("Logged out with OAuth. Removing user info from session.")
        request.session.pop("oauth_info", None)
        return RedirectResponse(_get_redirect_target(request))


def _add_mocked_oauth_routes(app: "fastapi.FastAPI", route_prefix: str = "/") -> None:
    """Add fake oauth routes if app is run locally and OAuth is enabled.

    Using OAuth will have the same behavior as in a Space but instead of authenticating with HF, a mocked user profile
    is added to the session.
    """
    try:
        import fastapi
        from fastapi.responses import RedirectResponse
        from starlette.datastructures import URL
    except ImportError as e:
        raise ImportError(
            "Cannot initialize OAuth to due a missing library. Please run `pip install huggingface_hub[oauth]` or add "
            "`huggingface_hub[oauth]` to your requirements.txt file."
        ) from e

    warnings.warn(
        "OAuth is not supported outside of a Space environment. To help you debug your app locally, the oauth endpoints"
        " are mocked to return your profile and token. To make it work, your machine must be logged in to Huggingface."
    )
    mocked_oauth_info = _get_mocked_oauth_info()

    login_uri, callback_uri, logout_uri = _get_oauth_uris(route_prefix)

    # Define OAuth routes
    @app.get(login_uri)
    async def oauth_login(request: fastapi.Request) -> RedirectResponse:
        """Fake endpoint that redirects to HF OAuth page."""
        # Define target (where to redirect after login)
        redirect_uri = _generate_redirect_uri(request)
        return RedirectResponse(callback_uri + "?" + urllib.parse.urlencode({"_target_url": redirect_uri}))

    @app.get(callback_uri)
    async def oauth_redirect_callback(request: fastapi.Request) -> RedirectResponse:
        """Endpoint that handles the OAuth callback."""
        request.session["oauth_info"] = mocked_oauth_info
        return RedirectResponse(_get_redirect_target(request))

    @app.get(logout_uri)
    async def oauth_logout(request: fastapi.Request) -> RedirectResponse:
        """Endpoint that logs out the user (e.g. delete cookie session)."""
        request.session.pop("oauth_info", None)
        logout_url = URL("/").include_query_params(**request.query_params)
        return RedirectResponse(url=logout_url, status_code=302)  # see https://github.com/gradio-app/gradio/pull/9659


def _generate_redirect_uri(request: "fastapi.Request") -> str:
    if "_target_url" in request.query_params:
        # if `_target_url` already in query params => respect it
        target = request.query_params["_target_url"]
    else:
        # otherwise => keep query params
        target = "/?" + urllib.parse.urlencode(request.query_params)

    redirect_uri = request.url_for("oauth_redirect_callback").include_query_params(_target_url=target)
    redirect_uri_as_str = str(redirect_uri)
    if redirect_uri.netloc.endswith(".hf.space"):
        # In Space, FastAPI redirect as http but we want https
        redirect_uri_as_str = redirect_uri_as_str.replace("http://", "https://")
    return redirect_uri_as_str


def _get_redirect_target(request: "fastapi.Request", default_target: str = "/") -> str:
    return request.query_params.get("_target_url", default_target)


def _get_mocked_oauth_info() -> Dict:
    token = get_token()
    if token is None:
        raise ValueError(
            "Your machine must be logged in to HF to debug an OAuth app locally. Please"
            " run `huggingface-cli login` or set `HF_TOKEN` as environment variable "
            "with one of your access token. You can generate a new token in your "
            "settings page (https://huggingface.co/settings/tokens)."
        )

    user = whoami()
    if user["type"] != "user":
        raise ValueError(
            "Your machine is not logged in with a personal account. Please use a "
            "personal access token. You can generate a new token in your settings page"
            " (https://huggingface.co/settings/tokens)."
        )

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 8 * 60 * 60,  # 8 hours
        "id_token": "FOOBAR",
        "scope": "openid profile",
        "refresh_token": "hf_oauth__refresh_token",
        "expires_at": int(time.time()) + 8 * 60 * 60,  # 8 hours
        "userinfo": {
            "sub": "0123456789",
            "name": user["fullname"],
            "preferred_username": user["name"],
            "profile": f"https://huggingface.co/{user['name']}",
            "picture": user["avatarUrl"],
            "website": "",
            "aud": "00000000-0000-0000-0000-000000000000",
            "auth_time": 1691672844,
            "nonce": "aaaaaaaaaaaaaaaaaaa",
            "iat": 1691672844,
            "exp": 1691676444,
            "iss": "https://huggingface.co",
        },
    }


def _get_oauth_uris(route_prefix: str = "/") -> Tuple[str, str, str]:
    route_prefix = route_prefix.strip("/")
    if route_prefix:
        route_prefix = f"/{route_prefix}"
    return (
        f"{route_prefix}/oauth/huggingface/login",
        f"{route_prefix}/oauth/huggingface/callback",
        f"{route_prefix}/oauth/huggingface/logout",
    )

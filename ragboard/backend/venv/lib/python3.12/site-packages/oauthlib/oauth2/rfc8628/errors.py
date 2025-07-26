from oauthlib.oauth2.rfc6749.errors import OAuth2Error

"""
oauthlib.oauth2.rfc8628.errors
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Error used both by OAuth2 clients and providers to represent the spec
defined error responses specific to the the device grant
"""


class AuthorizationPendingError(OAuth2Error):
    """
    For the device authorization grant;
      The authorization request is still pending as the end user hasn't
      yet completed the user-interaction steps (Section 3.3).  The
      client SHOULD repeat the access token request to the token
      endpoint (a process known as polling).  Before each new request,
      the client MUST wait at least the number of seconds specified by
      the "interval" parameter of the device authorization response,
      or 5 seconds if none was provided, and respect any
      increase in the polling interval required by the "slow_down"
      error.
    """

    error = "authorization_pending"


class SlowDownError(OAuth2Error):
    """
    A variant of "authorization_pending", the authorization request is
    still pending and polling should continue, but the interval MUST
    be increased by 5 seconds for this and all subsequent requests.
    """

    error = "slow_down"


class ExpiredTokenError(OAuth2Error):
    """
    The "device_code" has expired, and the device authorization
    session has concluded.  The client MAY commence a new device
    authorization request but SHOULD wait for user interaction before
    restarting to avoid unnecessary polling.
    """

    error = "expired_token"


class AccessDenied(OAuth2Error):
    """
    The authorization request was denied.
    """

    error = "access_denied"

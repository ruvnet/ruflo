"""
The Fitbit API breaks from the OAuth2 RFC standard by returning an "errors"
object list, rather than a single "error" string. This puts hooks in place so
that oauthlib can process an error in the results from access token and refresh
token responses. This is necessary to prevent getting the generic red herring
MissingTokenError.
"""

from json import loads, dumps


def fitbit_compliance_fix(session):
    def _missing_error(r):
        token = loads(r.text)
        if "errors" in token:
            # Set the error to the first one we have
            token["error"] = token["errors"][0]["errorType"]
        r._content = dumps(token).encode()
        return r

    session.register_compliance_hook("access_token_response", _missing_error)
    session.register_compliance_hook("refresh_token_response", _missing_error)
    return session

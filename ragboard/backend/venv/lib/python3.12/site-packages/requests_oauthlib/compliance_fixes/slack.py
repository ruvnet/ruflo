from urllib.parse import urlparse, parse_qs

from oauthlib.common import add_params_to_uri


def slack_compliance_fix(session):
    def _non_compliant_param_name(url, headers, data):
        # If the user has already specified the token, either in the URL
        # or in a data dictionary, then there's nothing to do.
        # If the specified token is different from ``session.access_token``,
        # we assume the user intends to override the access token.
        url_query = dict(parse_qs(urlparse(url).query))
        token = url_query.get("token")
        if not token and isinstance(data, dict):
            token = data.get("token")

        if token:
            # Nothing to do, just return.
            return url, headers, data

        if not data:
            data = {"token": session.access_token}
        elif isinstance(data, dict):
            data["token"] = session.access_token
        else:
            # ``data`` is something other than a dict: maybe a stream,
            # maybe a file object, maybe something else. We can't easily
            # modify it, so we'll set the token by modifying the URL instead.
            token = [("token", session.access_token)]
            url = add_params_to_uri(url, token)
        return url, headers, data

    session.register_compliance_hook("protected_request", _non_compliant_param_name)
    return session

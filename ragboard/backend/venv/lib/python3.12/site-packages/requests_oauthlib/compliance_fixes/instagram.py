from urllib.parse import urlparse, parse_qs

from oauthlib.common import add_params_to_uri


def instagram_compliance_fix(session):
    def _non_compliant_param_name(url, headers, data):
        # If the user has already specified the token in the URL
        # then there's nothing to do.
        # If the specified token is different from ``session.access_token``,
        # we assume the user intends to override the access token.
        url_query = dict(parse_qs(urlparse(url).query))
        token = url_query.get("access_token")
        if token:
            # Nothing to do, just return.
            return url, headers, data

        token = [("access_token", session.access_token)]
        url = add_params_to_uri(url, token)
        return url, headers, data

    session.register_compliance_hook("protected_request", _non_compliant_param_name)
    return session

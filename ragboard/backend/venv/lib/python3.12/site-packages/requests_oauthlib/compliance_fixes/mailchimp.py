import json


def mailchimp_compliance_fix(session):
    def _null_scope(r):
        token = json.loads(r.text)
        if "scope" in token and token["scope"] is None:
            token.pop("scope")
        r._content = json.dumps(token).encode()
        return r

    def _non_zero_expiration(r):
        token = json.loads(r.text)
        if "expires_in" in token and token["expires_in"] == 0:
            token["expires_in"] = 3600
        r._content = json.dumps(token).encode()
        return r

    session.register_compliance_hook("access_token_response", _null_scope)
    session.register_compliance_hook("access_token_response", _non_zero_expiration)
    return session

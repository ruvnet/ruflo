from json import loads, dumps


def weibo_compliance_fix(session):
    def _missing_token_type(r):
        token = loads(r.text)
        token["token_type"] = "Bearer"
        r._content = dumps(token).encode()
        return r

    session._client.default_token_placement = "query"
    session.register_compliance_hook("access_token_response", _missing_token_type)
    return session

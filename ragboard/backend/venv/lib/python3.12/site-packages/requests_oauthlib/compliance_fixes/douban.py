import json


def douban_compliance_fix(session):
    def fix_token_type(r):
        token = json.loads(r.text)
        token.setdefault("token_type", "Bearer")
        fixed_token = json.dumps(token)
        r._content = fixed_token.encode()
        return r

    session._client_default_token_placement = "query"
    session.register_compliance_hook("access_token_response", fix_token_type)

    return session

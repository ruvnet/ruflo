from json import dumps, loads
import re


def plentymarkets_compliance_fix(session):
    def _to_snake_case(n):
        return re.sub("(.)([A-Z][a-z]+)", r"\1_\2", n).lower()

    def _compliance_fix(r):
        # Plenty returns the Token in CamelCase instead of _
        if (
            "application/json" in r.headers.get("content-type", {})
            and r.status_code == 200
        ):
            token = loads(r.text)
        else:
            return r

        fixed_token = {}
        for k, v in token.items():
            fixed_token[_to_snake_case(k)] = v

        r._content = dumps(fixed_token).encode()
        return r

    session.register_compliance_hook("access_token_response", _compliance_fix)
    return session

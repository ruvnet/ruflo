from typing import List, Optional

from google.oauth2.webauthn_handler import PluginHandler, WebAuthnHandler


class WebauthnHandlerFactory:
    handlers: List[WebAuthnHandler]

    def __init__(self):
        self.handlers = [PluginHandler()]

    def get_handler(self) -> Optional[WebAuthnHandler]:
        for handler in self.handlers:
            if handler.is_available():
                return handler
        return None

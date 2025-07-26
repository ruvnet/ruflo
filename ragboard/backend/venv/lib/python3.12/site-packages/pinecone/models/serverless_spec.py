from typing import NamedTuple

class ServerlessSpec(NamedTuple):
    cloud: str
    region: str

    def asdict(self):
        return {"serverless": self._asdict()}
from typing import List, Optional
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor


def instrument_fastapi(app: FastAPI, excluded_urls: Optional[List[str]] = None) -> None:
    """Instrument FastAPI to emit OpenTelemetry spans."""
    FastAPIInstrumentor.instrument_app(
        app, excluded_urls=",".join(excluded_urls) if excluded_urls else None
    )

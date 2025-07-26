# Telemetry

This directory holds all the telemetry for Chroma.

- `product/` contains anonymized product telemetry which we, Chroma, collect so we can
  understand usage patterns. For more information, see https://docs.trychroma.com/telemetry.
- `opentelemetry/` contains all of the config for Chroma's [OpenTelemetry](https://opentelemetry.io/docs/instrumentation/python/getting-started/)
  setup. These metrics are *not* sent back to Chroma -- anyone operating a Chroma instance
  can use the OpenTelemetry metrics and traces to understand how their instance of Chroma
  is behaving.

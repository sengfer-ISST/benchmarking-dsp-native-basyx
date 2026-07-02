# Monitoring stack — design notes

This overlay is a **port** of the staged monitoring design developed in
`benchmarking-factoryx-edc/resources/local-fx-mvd/monitoring/`. Refer to
that repo's `PLAN.md` and `CONFIG.md` for the full decision log,
alternatives considered, and per-file teaching walkthrough.

## What's the same

- Image versions, OTel agent version (v2.8.0), and pipeline topology
  (java-agent → OTLP/gRPC → collector → Prometheus + Tempo → Grafana).
- `prometheus.yml`, `otel-collector-config.yaml`, `tempo.yaml`, Grafana
  datasource provisioning, and both dashboard JSONs — all verbatim copies.
- 5 s Prometheus scrape interval, 7 d retention, 168 h Tempo retention.

## What's different

| Aspect | factoryx (this repo's source-of-truth) | dsp-native-basyx (here) |
|---|---|---|
| Network | `fx-test-network` | `dsp-native-basyx` |
| `service.namespace` resource attribute | `fx-mvd` | `dsp-native-basyx-mvd` |
| Grafana dashboard folder | *FX MVD* | *DSP-Native BaSyx* |
| OTel agent delivery | Baked into EDC Dockerfile | Bind-mounted from `additional_config/opentelemetry-javaagent.jar` |
| Spring Boot runtime | (n/a — all services are vanilla EDC) | `dsp-native-basyx` is Spring Boot 3.5 on Tomcat; agent still produces the same `http_server_request_duration_seconds` schema |

## Why bind-mount the agent jar instead of rebuilding the image

`dsp-native-basyx:patched-edDSA` is a locally-built image carrying a
patched build of `dataspace-protocol-lib`. We don't want monitoring to
require a Dockerfile change in either the connector repo or the lib repo
— the agent is a JVM-level concern, not an application concern. Mounting
the jar + properties file at `/app/opentelemetry-javaagent.jar` and
`/app/opentelemetry.properties` and activating both via
`JAVA_TOOL_OPTIONS` is image-agnostic and works equally on the
Spring Boot app and the four EDC-family services.

## Out of scope

The dsp-protocol-lib changes currently in the working tree
(BouncyCastle direct Ed25519 verification, VC `sub`-fallback,
Java 21 toolchain, `libVersion` bump to 0.1.1) are unrelated to
monitoring and reviewed separately.

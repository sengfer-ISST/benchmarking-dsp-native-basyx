# dsp-native-basyx MVD monitoring stack

Opt-in monitoring overlay for the `docker-compose-mvd.yaml` setup. Captures
host resource usage plus per-API latency/throughput, JVM internals, and
distributed traces during Bruno-driven functional runs and k6 benchmark
runs for the thesis *"Benchmarking & Performance Analysis of Data Space
Connectors"*.

This is a **port of the `benchmarking-factoryx-edc` monitoring overlay** —
same image versions, same Prometheus / OTel collector / Tempo / Grafana
config, same dashboards. The metric schema is identical, so PromQL and
Grafana panels are interchangeable across the two repos (and across
`benchmarking-EDC`, whose Helm equivalent emits the same series).

> **Status:** Stage 1 (host metrics) + Stage 2 (per-API + JVM + traces via
> the OpenTelemetry java-agent) complete.

## 1. What's instrumented

The MVD brings up 5 JVM services on the `dsp-native-basyx` bridge network:

| Service | Framework | OTel `service.name` |
|---|---|---|
| `dsp-native-basyx` | Spring Boot 3.5 (on top of `dataspace-protocol-lib`) | `dsp-native-basyx` |
| `consumer-controlplane` | Tractus-X EDC | `consumer-controlplane` |
| `consumer-idhub` | EDC IdentityHub | `consumer-idhub` |
| `provider-idhub` | EDC IdentityHub | `provider-idhub` |
| `local-issuer-service` | EDC Issuer-Service | `local-issuer-service` |

All five run the OpenTelemetry java-agent v2.8.0 via `JAVA_TOOL_OPTIONS`.
The agent auto-instruments their HTTP servers (Jetty / Tomcat) and JVM
runtime, producing the same metric schema as the other two thesis repos:

- `http_server_request_duration_seconds{_bucket,_count,_sum}` with
  `service_name`, `http_route`, `http_request_method`,
  `http_response_status_code`
- `jvm_memory_used_bytes{jvm_memory_type="heap"}`,
  `jvm_gc_duration_seconds_sum`, `jvm_thread_count`
- Host metrics from node-exporter (`node_cpu_seconds_total`, etc.)

## 2. Why a separate compose file

The overlay is **deliberately opt-in** (separate compose file) so the
default `docker compose -f docker-compose-mvd.yaml up -d` path stays lean
for functional-only runs.

The dsp-native-basyx image (`dsp-native-basyx:patched-edDSA`) does not
ship the OTel agent, and the Tractus-X EDC + IdentityHub + Issuer-Service
images can't be assumed to. Rather than rebuild any image, the overlay
**bind-mounts** the agent jar + properties file into each JVM container.

## 3. One-time setup

Download the OpenTelemetry java-agent jar (v2.8.0, ~24 MB) into
`additional_config/`. Run this once from the repo root:

```bash
curl -L -o additional_config/opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.8.0/opentelemetry-javaagent.jar
```

The jar is `.gitignore`d — pin the version here, not in the index.

## 4. Run

From the repo root:

```bash
docker compose -f docker-compose.monitoring.yaml up -d
```

Do **not** run both compose files at once — the overlay is a superset
that already includes every service from `docker-compose-mvd.yaml`.

### Access

| URL | What |
|---|---|
| http://localhost:3000 | Grafana (admin / admin) — folder *DSP-Native BaSyx* |
| http://localhost:9090 | Prometheus |
| http://localhost:3200 | Tempo API |
| http://localhost:8889/metrics | OTel collector's Prometheus exporter (raw) |
| http://localhost:9100/metrics | node-exporter (host) |

### Tear down

```bash
docker compose -f docker-compose.monitoring.yaml down
```

## 5. Components

Versions are pinned for reproducibility of thesis measurements.

| Component | Image | Role |
|---|---|---|
| node-exporter | `prom/node-exporter:v1.8.2` | Host CPU / mem / disk / net / FS |
| Prometheus | `prom/prometheus:v2.54.1` | Scrape + TSDB (7 d retention) |
| Grafana | `grafana/grafana:11.2.0` | Visualisation; Prometheus + Tempo DS |
| OTel collector | `otel/opentelemetry-collector-contrib:0.108.0` | OTLP sink, re-exports to Prom + Tempo |
| Tempo | `grafana/tempo:2.6.0` | Distributed trace store |
| OTel java-agent | v2.8.0 (jar) | Zero-code instrumentation in each JVM |

## 6. Dashboards

Provisioned into the *DSP-Native BaSyx* folder in Grafana:

- **EDC API & Runtime (OTel)** — RED panels (rate / errors / p50 / p95 /
  p99) per route + JVM heap, GC, threads. Filter by `service_name` to
  isolate a single runtime.
- **Node Exporter Full** — Grafana community dashboard 1860; host CPU,
  memory, disk I/O, network.

Edits made in the Grafana UI persist (provisioning has `allowUiUpdates:
true`); they're only overwritten when the JSON file on disk changes.

## 7. Cross-repo parity

Because the agent version, collector config, and dashboard JSONs are
identical to `benchmarking-factoryx-edc/resources/local-fx-mvd/monitoring`
and `benchmarking-EDC/local-setup/monitoring`, PromQL queries and Grafana
panels are portable across all three repos.

The only differences are:
- Docker network name: `dsp-native-basyx` (vs `fx-test-network` /
  Kubernetes ClusterIP).
- `service.namespace` resource attribute: `dsp-native-basyx-mvd`.
- Grafana dashboard folder label: *DSP-Native BaSyx*.

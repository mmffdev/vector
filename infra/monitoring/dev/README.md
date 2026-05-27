# Vector dev monitoring

Grafana on the dev server is backed by Loki for logs, Prometheus for metrics, Alertmanager for alert state, and Grafana Alloy for Docker log shipping. Prometheus scrapes node_exporter, cAdvisor, Postgres, Valkey, RabbitMQ, blackbox probes, Alloy, Loki, Grafana, and Alertmanager.

## Access

Use the existing SSH tunnel and open:

```bash
http://localhost:3002/d/vector-dev-server-health/vector-dev-server-health
```

Grafana, Loki, Prometheus, and Alertmanager bind to remote localhost. Exporters live only on the internal Docker compose network, so Grafana and Prometheus can query them without exposing more public ports.

## Deploy

```bash
ssh -o ClearAllForwardings=yes vector-dev-pg "mkdir -p /opt/loki/alerts /opt/grafana/provisioning/dashboards/json /opt/grafana/provisioning/datasources"
scp -o ClearAllForwardings=yes infra/monitoring/dev/docker-compose.yml vector-dev-pg:/opt/loki/docker-compose.yml
scp -o ClearAllForwardings=yes infra/monitoring/dev/prometheus.yml infra/monitoring/dev/loki-config.yml infra/monitoring/dev/alloy-config.alloy infra/monitoring/dev/alertmanager.yml infra/monitoring/dev/blackbox.yml vector-dev-pg:/opt/loki/
scp -o ClearAllForwardings=yes infra/monitoring/dev/alerts/*.yml vector-dev-pg:/opt/loki/alerts/
scp -o ClearAllForwardings=yes infra/monitoring/dev/grafana/provisioning/datasources/*.yml vector-dev-pg:/opt/grafana/provisioning/datasources/
scp -o ClearAllForwardings=yes infra/monitoring/dev/grafana/provisioning/dashboards/server-health.yml vector-dev-pg:/opt/grafana/provisioning/dashboards/server-health.yml
scp -o ClearAllForwardings=yes infra/monitoring/dev/grafana/provisioning/dashboards/json/vector-server-health.json vector-dev-pg:/opt/grafana/provisioning/dashboards/json/vector-server-health.json
ssh -o ClearAllForwardings=yes vector-dev-pg "chmod 755 /opt/loki /opt/loki/alerts && chmod 644 /opt/loki/*.yml /opt/loki/*.alloy /opt/loki/alerts/*.yml"
ssh -o ClearAllForwardings=yes vector-dev-pg "cd /opt/loki && docker compose up -d"
```

Required `/opt/loki/.env` values:

```dotenv
GRAFANA_ADMIN_PASSWORD=...
POSTGRES_EXPORTER_PASSWORD=...
VALKEY_EXPORTER_PASSWORD=...
RABBITMQ_EXPORTER_PASSWORD=...
```

The exporter passwords mirror existing Docker secrets and are installed on the server only. Do not commit them.

## Pinned Images

All monitoring images are pinned by digest so a redeploy cannot silently change collector behaviour.

| Service | Image |
|---|---|
| `loki` | `grafana/loki@sha256:b025a0220f390baaab01578aea2fe0ba677584d9f248c3fe5af15f84dd1de60d` |
| `alloy` | `grafana/alloy@sha256:51aeb9d829239345070619dad3edd6873186f913c84f45b365b74574fcb38ec0` |
| `grafana` | `grafana/grafana@sha256:f9811e4e687ffecf1a43adb9b64096c50bc0d7a782f8608530f478b6542de7d5` |
| `prometheus` | `prom/prometheus@sha256:49214755b6153f90a597adcbff0252cc61069f8ab69ce8411285cd4a560e8038` |
| `alertmanager` | `prom/alertmanager@sha256:51a825c2a40acc3e338fdd00d622e01ec090f72be2b3ea46be0839cd47a4d286` |
| `postgres-exporter` | `quay.io/prometheuscommunity/postgres-exporter@sha256:e96064f876226d94bb6ce48a4c4b3dd76edba91168ec1ab024e5c4b959310b0f` |
| `valkey-exporter` | `oliver006/redis_exporter@sha256:7ef8e9c26638158fa4e7ad60df8c7e53d1919986753d6c1d2d1876b6ec38d87b` |
| `rabbitmq-exporter` | `kbudde/rabbitmq-exporter@sha256:12f27d6d84e6dbdd72c6bc2605e48af9910517394483c1dfa3230e49d3e32107` |
| `blackbox-exporter` | `prom/blackbox-exporter@sha256:e753ff9f3fc458d02cca5eddab5a77e1c175eee484a8925ac7d524f04366c2fc` |
| `node-exporter` | `prom/node-exporter@sha256:d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a` |
| `cadvisor` | `gcr.io/cadvisor/cadvisor@sha256:3de2bd5203120b866d74a9b283b2ffb8ec382fbf9dc321814700c6ea6f44ec57` |

Monthly refresh checklist:

```bash
cd infra/monitoring/dev
docker compose pull
docker compose config
# Review upstream release notes for changed images, then update digests deliberately.
```

## Smoke checks

```bash
ssh -o ClearAllForwardings=yes vector-dev-pg "curl -fsS http://127.0.0.1:9090/-/ready && curl -fsS http://127.0.0.1:9093/-/ready && curl -fsS http://127.0.0.1:3100/ready"
ssh -o ClearAllForwardings=yes vector-dev-pg "curl -fsS http://127.0.0.1:9090/api/v1/targets | jq -r '.data.activeTargets[] | select(.health!=\"up\") | [.labels.job,.labels.instance,.health,.lastError] | @tsv'"
ssh -o ClearAllForwardings=yes vector-dev-pg "curl -fsS http://127.0.0.1:9090/api/v1/rules | jq -r '.data.groups[] | [.name,.file,(.rules|length)] | @tsv'"
ssh -o ClearAllForwardings=yes vector-dev-pg "curl -fsS -G --data-urlencode 'query={env=\"dev\"}' --data-urlencode limit=3 http://127.0.0.1:3100/loki/api/v1/query_range | jq -r '.data.result | length'"
ssh -o ClearAllForwardings=yes vector-dev-pg "cd /opt/loki && . ./.env && curl -fsS -u admin:\$GRAFANA_ADMIN_PASSWORD http://127.0.0.1:3000/api/health"
```

## What Was Added

- Exporters: Postgres, Valkey, RabbitMQ, blackbox HTTP/TCP probes.
- Alerting: Prometheus rules + Alertmanager, visible through the Alertmanager datasource in Grafana.
- Logs: Grafana Alloy tails Docker container logs into Loki, replacing the old Promtail path.

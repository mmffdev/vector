# Vector dev monitoring

Grafana on the dev server is backed by Loki for logs and Prometheus for server metrics. Prometheus scrapes node_exporter for host metrics and cAdvisor for Docker/container metrics.

## Access

Use the existing SSH tunnel and open:

```bash
http://localhost:3002/d/vector-dev-server-health/vector-dev-server-health
```

Grafana and Loki bind to remote localhost. Prometheus, node_exporter, and cAdvisor live only on the internal Docker compose network, so Grafana can query them without exposing their ports publicly.

## Deploy

```bash
scp infra/monitoring/dev/docker-compose.yml mmffdev-dev:/opt/loki/docker-compose.yml
scp infra/monitoring/dev/prometheus.yml mmffdev-dev:/opt/loki/prometheus.yml
scp infra/monitoring/dev/grafana/provisioning/datasources/prometheus.yml mmffdev-dev:/opt/grafana/provisioning/datasources/prometheus.yml
ssh mmffdev-dev "mkdir -p /opt/grafana/provisioning/dashboards/json"
scp infra/monitoring/dev/grafana/provisioning/dashboards/server-health.yml mmffdev-dev:/opt/grafana/provisioning/dashboards/server-health.yml
scp infra/monitoring/dev/grafana/provisioning/dashboards/json/vector-server-health.json mmffdev-dev:/opt/grafana/provisioning/dashboards/json/vector-server-health.json
ssh mmffdev-dev "test -f /opt/loki/.env || (umask 077 && printf 'GRAFANA_ADMIN_PASSWORD=...\n' > /opt/loki/.env)"
ssh mmffdev-dev "cd /opt/loki && docker compose up -d"
```

## Smoke checks

```bash
ssh mmffdev-dev "docker exec loki-prometheus-1 wget -qO- http://prometheus:9090/-/ready && docker exec loki-prometheus-1 wget -qO- http://node-exporter:9100/metrics >/dev/null && docker exec loki-prometheus-1 wget -qO- http://cadvisor:8080/metrics >/dev/null"
ssh mmffdev-dev "cd /opt/loki && . ./.env && curl -fsS -u admin:\$GRAFANA_ADMIN_PASSWORD http://127.0.0.1:3000/api/health"
```

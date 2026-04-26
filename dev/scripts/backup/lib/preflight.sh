# Sanity checks before producers run.
# shellcheck shell=bash

preflight() {
  log "preflight: checking ssh to $SSH_HOST"
  ssh_server 'echo ok' >/dev/null || die "ssh to $SSH_HOST failed"

  log "preflight: checking required containers"
  local missing
  missing="$(ssh_server 'bash -c "for c in mmff-ops-postgres n8n rabbitmq portainer; do docker ps --format {{.Names}} | grep -qx \$c || echo \$c; done"')"
  [ -z "$missing" ] || die "containers not running: $missing"

  log "preflight: checking laptop disk space (need >= 10 GiB free in $BACKUP_ROOT)"
  local avail_kb
  avail_kb="$(df -k "$BACKUP_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$avail_kb" ] && [ "$avail_kb" -ge 10485760 ] || die "low disk: ${avail_kb:-?} KiB free"

  log "preflight: ok"
}

#!/usr/bin/env bash
set -euo pipefail

REMOTE="mmffdev-admin"
IMAGE="mmffdev/api-reference:latest"
DEPLOY_DIR="/opt/api-reference"

echo "→ Building Docker image (linux/amd64 for remote)..."
docker buildx build --platform linux/amd64 -t "$IMAGE" --load .

echo "→ Saving image..."
docker save "$IMAGE" | gzip | ssh "$REMOTE" "docker load"

echo "→ Restarting container..."
ssh "$REMOTE" "cd $DEPLOY_DIR && docker compose up -d --force-recreate"

echo "✓ Deployed — http://localhost:8083"

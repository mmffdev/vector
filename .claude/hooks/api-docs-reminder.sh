#!/usr/bin/env bash
# Fires on Stop — checks if backend handler/route files changed this session.
# If they did, outputs a reminder to update api-reference/ docs.

CHANGED=$(git -C "$CLAUDE_PROJECT_DIR" status --porcelain 2>/dev/null \
  | grep -E 'backend/internal/.*/handler\.go|backend/cmd/server/main\.go|backend/internal/.*/routes\.go|backend/internal/.*/router\.go' \
  | awk '{print $2}')

if [ -n "$CHANGED" ]; then
  echo "API_DOCS_REMINDER: the following handler files were modified this session:"
  echo "$CHANGED" | while IFS= read -r f; do echo "  • $f"; done
  echo "Check whether api-reference/docs/rest-api/ needs updating, then redeploy:"
  echo "  cd api-reference && bash deploy.sh"
fi

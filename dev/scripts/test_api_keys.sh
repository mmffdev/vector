#!/bin/bash
# Test API key functionality via HTTP.
# Prerequisites: backend running on :5100, dev user logged in via JWT
#
# Usage: ./test_api_keys.sh

set -e

BASE="http://localhost:5100/v1"
ADMIN_BASE="$BASE/api/admin"

# Hardcoded dev JWT (from test user session).
# In real testing, get this from login response.
# For now, assume we have a valid JWT in the Authorization header below.

echo "=== Testing API Key Management ==="

# 1. Issue a new API key (requires authentication)
echo -e "\n1. Issuing a new API key..."
ISSUE_RESPONSE=$(curl -s -X POST "$ADMIN_BASE/api-keys/issue" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "expires_at": "2026-12-31T23:59:59Z",
    "scopes": ["read:portfolio", "write:work-items"]
  }')
echo "$ISSUE_RESPONSE" | jq . 2>/dev/null || echo "$ISSUE_RESPONSE"

# Extract the raw key from the response for testing
NEW_KEY=$(echo "$ISSUE_RESPONSE" | jq -r '.key.raw_key' 2>/dev/null || echo "")

if [ -z "$NEW_KEY" ] || [ "$NEW_KEY" == "null" ]; then
  echo "ERROR: Could not extract key from issue response"
  exit 1
fi

echo "Issued key: $NEW_KEY"

# 2. List all keys
echo -e "\n2. Listing all API keys..."
curl -s -X GET "$ADMIN_BASE/api-keys" \
  -H "Authorization: Bearer $JWT_TOKEN" | jq .

# 3. Test using the new key on a protected endpoint
echo -e "\n3. Testing key on protected endpoint (GET /me)..."
curl -s -X GET "$BASE/api/me" \
  -H "Authorization: Bearer $NEW_KEY" | jq .

# 4. Revoke the key
if [ ! -z "$NEW_KEY" ] && [ "$NEW_KEY" != "null" ]; then
  KEY_ID=$(echo "$ISSUE_RESPONSE" | jq -r '.key.id' 2>/dev/null || echo "")
  if [ ! -z "$KEY_ID" ] && [ "$KEY_ID" != "null" ]; then
    echo -e "\n4. Revoking the key..."
    curl -s -X POST "$ADMIN_BASE/api-keys/revoke" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $JWT_TOKEN" \
      -d "{ \"id\": \"$KEY_ID\" }" | jq .

    # Verify key is now rejected
    echo -e "\n5. Testing revoked key (should fail)..."
    curl -s -X GET "$BASE/api/me" \
      -H "Authorization: Bearer $NEW_KEY" | jq .
  fi
fi

echo -e "\n=== Tests Complete ==="

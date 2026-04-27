#!/usr/bin/env python3
"""
Planka REST API wrapper — handles all board operations safely
Credentials read from backend/.env.local (git-ignored)
"""

import sys
import json
import urllib.request
import urllib.error
import os
from pathlib import Path

PLANKA_URL = "http://localhost:3333"
BOARD_ID = "1760699595475649556"
BACKLOG_LIST = "1760700028730475544"
TOKEN_FILE = f"/tmp/.planka_token_{os.getpid()}"

def get_credential(key):
    """Read credential from backend/.env.local safely"""
    env_path = Path("/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/backend/.env.local")
    if not env_path.exists():
        return None
    with open(env_path) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return None

def get_token():
    """Get auth token, cached in temp file"""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            return f.read().strip()

    user = get_credential("PLANKA_AGENT_USER")
    passwd = get_credential("PLANKA_AGENT_PASS")
    if not user or not passwd:
        print("ERROR: PLANKA_AGENT_USER or PLANKA_AGENT_PASS not set in backend/.env.local", file=sys.stderr)
        sys.exit(1)

    try:
        auth_data = json.dumps({"emailOrUsername": user, "password": passwd}).encode()
        req = urllib.request.Request(f"{PLANKA_URL}/api/access-tokens",
            data=auth_data,
            headers={"Content-Type": "application/json"},
            method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            token = json.loads(resp.read())["item"]
    except Exception as e:
        print(f"ERROR: Failed to authenticate: {e}", file=sys.stderr)
        sys.exit(1)

    with open(TOKEN_FILE, "w") as f:
        f.write(token)
    return token

def http_request(method, url, data=None, token=None):
    """Helper for making HTTP requests"""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req_data = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        print(f"ERROR: HTTP {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Request failed: {e}", file=sys.stderr)
        sys.exit(1)

def create_card(list_id, title, description):
    """Create a card and return its ID"""
    token = get_token()
    result = http_request("POST", f"{PLANKA_URL}/api/lists/{list_id}/cards",
        data={"name": title, "description": description, "position": 65536, "type": "story"},
        token=token)
    print(result["item"]["id"])

def label_card(card_id, label_id):
    """Attach a label to a card"""
    token = get_token()
    http_request("POST", f"{PLANKA_URL}/api/cards/{card_id}/card-labels",
        data={"labelId": label_id},
        token=token)

def move_card(card_id, list_id, position):
    """Move a card to a different list"""
    token = get_token()
    http_request("PATCH", f"{PLANKA_URL}/api/cards/{card_id}",
        data={"listId": list_id, "position": position},
        token=token)

def comment(card_id, text):
    """Post a comment on a card"""
    token = get_token()
    http_request("POST", f"{PLANKA_URL}/api/cards/{card_id}/comments",
        data={"text": text},
        token=token)

def delete_card(card_id):
    """Delete a card"""
    token = get_token()
    http_request("DELETE", f"{PLANKA_URL}/api/cards/{card_id}", token=token)

def create_label(board_id, name, color, position):
    """Create a label and return its ID"""
    token = get_token()
    result = http_request("POST", f"{PLANKA_URL}/api/boards/{board_id}/labels",
        data={"name": name, "color": color, "position": position},
        token=token)
    print(result["item"]["id"])

def board():
    """Fetch full board JSON"""
    token = get_token()
    result = http_request("GET", f"{PLANKA_URL}/api/boards/{BOARD_ID}", token=token)
    print(json.dumps(result))

def unlabel_card(card_id, label_id):
    """Remove a label from a card by finding and deleting the card-label association"""
    token = get_token()
    data = http_request("GET", f"{PLANKA_URL}/api/boards/{BOARD_ID}", token=token)
    for cl in data.get("included", {}).get("cardLabels", []):
        if cl["cardId"] == card_id and cl["labelId"] == label_id:
            http_request("DELETE", f"{PLANKA_URL}/api/cards/{card_id}/card-labels/{cl['id']}", token=token)
            return
    print(f"WARN: card-label association not found for card={card_id} label={label_id}", file=sys.stderr)

def verify_labels(card_ids, required_names):
    """Verify each card has the required labels"""
    token = get_token()
    data = http_request("GET", f"{PLANKA_URL}/api/boards/{BOARD_ID}", token=token)

    # Build label map
    label_map = {l["id"]: l["name"] for l in data.get("included", {}).get("labels", [])}

    # Build card → labels map
    card_labels = {}
    for cl in data.get("included", {}).get("cardLabels", []):
        card_id = cl["cardId"]
        label_id = cl["labelId"]
        label_name = label_map.get(label_id, label_id)
        if card_id not in card_labels:
            card_labels[card_id] = set()
        card_labels[card_id].add(label_name)

    required = set(s.strip() for s in required_names.split(",") if s.strip())
    fail = 0

    for cid in card_ids.split(","):
        cid = cid.strip()
        if not cid:
            continue

        have = card_labels.get(cid, set())
        missing = required - have

        if missing:
            print(f"DEFECT  {cid}  missing: {sorted(missing)}  have: {sorted(have)}")
            fail = 1
        else:
            print(f"OK      {cid}  {sorted(have)}")

    sys.exit(1 if fail else 0)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Planka API helper — use via .claude/bin/planka wrapper", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    try:
        if cmd == "create-card":
            create_card(sys.argv[2], sys.argv[3], sys.argv[4])
        elif cmd == "label-card":
            label_card(sys.argv[2], sys.argv[3])
        elif cmd == "move-card":
            move_card(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        elif cmd == "comment":
            comment(sys.argv[2], sys.argv[3])
        elif cmd == "delete-card":
            delete_card(sys.argv[2])
        elif cmd == "create-label":
            create_label(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]))
        elif cmd == "board":
            board()
        elif cmd == "unlabel-card":
            unlabel_card(sys.argv[2], sys.argv[3])
        elif cmd == "verify-labels":
            verify_labels(sys.argv[2], sys.argv[3])
        else:
            print(f"Unknown command: {cmd}", file=sys.stderr)
            sys.exit(1)
    except IndexError:
        print(f"Missing arguments for {cmd}", file=sys.stderr)
        sys.exit(1)

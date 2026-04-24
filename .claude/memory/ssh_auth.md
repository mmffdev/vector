---
name: SSH Authentication for MMFFDev Server
description: Working SSH key and authentication method for mmffdev.com
type: reference
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Working SSH key:** `~/.ssh/id_ed25519`

**Usage:**
```bash
ssh -i ~/.ssh/id_ed25519 root@mmffdev.com "<command>"
```

**Docker container for Postgres:** `mmff-ops-postgres`

Example to run psql:
```bash
ssh -i ~/.ssh/id_ed25519 root@mmffdev.com "docker exec mmff-ops-postgres psql -U mmff_dev -d mmff_vector -c \"<sql>\""
```

**Note:** The `mmffdev` key has a passphrase and requires ssh-agent setup. The `id_ed25519` key works directly.

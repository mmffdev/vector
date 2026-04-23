# `<seleniumup>` — open the Selenium Grid UI

Opens the Selenium Grid console (`http://localhost:4444/ui/`) in the default
browser. Pings the hub first; if it's not ready, prints a hint instead of
opening a broken page.

The trailing slash on `/ui/` matters — without it the bundle 404s and the
page renders blank.

```bash
if curl -sf http://localhost:4444/status 2>/dev/null | grep -q '"ready": true'; then
  open http://localhost:4444/ui/
  echo "opened Selenium Grid UI → http://localhost:4444/ui/"
else
  echo "Selenium hub not responding on :4444. Check 'docker ps' for the Vector-Selenium container."
fi
```

## Related URLs (when hub is up)

- **Grid UI:** http://localhost:4444/ui/
- **Hub status JSON:** http://localhost:4444/status
- **Live browser viewer (noVNC):** http://localhost:7900 — password `secret`

# GeoIP databases (TD-SEC-SESSION-ANOMALY)

This directory holds MaxMind GeoLite2 `.mmdb` files used by
[`backend/internal/geo`](../../internal/geo/geo.go) to resolve
**country** + **ASN** for the IP on every login and refresh. Drift
between login.country and refresh.country (or login.asn vs refresh.asn)
triggers the step-up reauth challenge.

The `.mmdb` files are **NOT committed** — see `.gitignore` in this
directory. They are runtime-only artefacts because:

1. **MaxMind license** — GeoLite2 is free but requires a signed-in
   account to download. Distributing the file in the repo would breach
   the licence terms.
2. **Size** — each `.mmdb` is ~70 MB compressed.
3. **Update cadence** — MaxMind publishes new data twice a week. Pinning
   a file to git introduces stale-data risk on top of the licence one.

## Local dev setup (one-off)

1. Register an account: <https://www.maxmind.com/en/geolite2/signup>
2. Generate a license key on your account page.
3. Download two databases — GeoLite2-City and GeoLite2-ASN — either
   via the web UI (Download Files in your account) or via `geoipupdate`
   ([install instructions](https://dev.maxmind.com/geoip/updating-databases)).
4. Extract the `.mmdb` files into this directory:
   ```
   backend/data/geoip/GeoLite2-City.mmdb
   backend/data/geoip/GeoLite2-ASN.mmdb
   ```
5. Add to `backend/.env.dev` (or your shell):
   ```
   GEOIP_CITY_DB=backend/data/geoip/GeoLite2-City.mmdb
   GEOIP_ASN_DB=backend/data/geoip/GeoLite2-ASN.mmdb
   ```
6. Restart the backend. You should see no `geo: ...unavailable` warnings
   at startup.

## What happens if the files are missing?

The `geo.Resolver` constructor logs warnings at startup and degrades
gracefully — every lookup returns empty country/ASN strings. The session-
anomaly enforcement layer treats empty fingerprints as "no signal" and
does NOT trigger step-up (fail-open at the detection layer is the
correct behaviour; fail-closed would lock out every dev who hasn't
downloaded the files).

## Production deploys

Bundle the two `.mmdb` files into the deploy artefact alongside the
backend binary (e.g. add to the Docker image, sync to the prod host,
mount as a volume). Set the env vars to point at the on-host path.
Consider `geoipupdate` as a cron / sidecar so the data refreshes
weekly without manual intervention.

## Why no automated download in CI?

The MaxMind licence key would have to live in a CI secret, and the
files would need re-downloading on every build. Both add ops surface
for marginal benefit — dev rarely needs real geo (the warnings are
informative, not blocking). Production paths handle this via the
deploy pipeline, not via CI.

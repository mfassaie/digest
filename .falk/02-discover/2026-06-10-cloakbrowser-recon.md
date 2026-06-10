# CloakBrowser image recon (Phase B0)

Date: 2026-06-10. Image: `cloakhq/cloakbrowser:latest`, verified by
`docker inspect` / `docker run` on this machine.

## Findings

| Property | Value |
|---|---|
| Size | 582 MB |
| Platform | linux/amd64 (no arm64 manifest — Rosetta caveat on Apple Silicon) |
| Distro | Debian 13 (trixie) |
| User | root (uid 0) |
| WORKDIR | /app |
| ENTRYPOINT | `/entrypoint.sh` |
| CMD | `python` |
| Node | **present**: /usr/bin/node v20.20.2 |
| Python | /usr/local/bin/python3 3.12.13 |
| Tools | `cloakserve`, `cloaktest` on PATH |
| DISPLAY | `:99` (Xvfb preconfigured) |

`/entrypoint.sh` cleans the stale Xvfb lock, starts `Xvfb :99 -screen 0
1920x1080x24 -nolisten tcp &`, sleeps 1s, then `exec "$@"`.

`cloakserve` starts a CDP multiplexer on port 9222; connect with
`chromium.connect_over_cdp("http://localhost:9222?fingerprint=<seed>")`.
It makes a pypi/github version check on boot (needs network at start).

## Design consequences (override the plan's assumptions)

1. **No multi-stage Node copy.** Base already has Node 20 — use it. The
   Dockerfile is just `FROM cloakhq/cloakbrowser` + COPY service + npm
   install runtime deps.
2. **Reuse the base entrypoint.** Set our launcher as `CMD`; the base
   `/entrypoint.sh` runs Xvfb then `exec`s our launcher. Do NOT override
   ENTRYPOINT, or we lose the Xvfb + lock-cleanup setup.
3. **Launcher** starts `cloakserve` in the background (CDP :9222), waits
   for CDP to answer, then `exec node /app/service.js` (HTTP :8932).
4. **Browsers**: we use `connectOverCDP`, so playwright-core needs no
   bundled browser — install with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
5. **Per-request CDP connect/disconnect** sidesteps any cloakserve idle
   behaviour (no need to probe idle-timeout flags).
6. Windows note: `docker run --entrypoint cat ... /path` mangles the path
   under Git Bash (MSYS). Use PowerShell or `MSYS_NO_PATHCONV=1`. The host
   lifecycle code uses execFile arg arrays, which avoids this.

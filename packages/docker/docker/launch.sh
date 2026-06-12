#!/bin/bash
# Started by the base image's /entrypoint.sh after Xvfb is up.
# Runs cloakserve (CDP multiplexer on :9222) in the background, then the
# fetch/convert service in the foreground. The service connects to CDP
# lazily and reports readiness on /healthz, so no explicit wait is needed;
# the host polls /healthz before sending work.
set -euo pipefail

cloakserve &

exec node /app/digest/service.mjs

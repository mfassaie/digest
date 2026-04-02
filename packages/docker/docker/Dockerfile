# Derived image: CloakBrowser base + digest fetch/convert service.
# Build context is this docker/ directory. Built locally by
# `npx digest setup` — NEVER pushed to a registry (the CloakBrowser
# binary licence forbids redistribution; internal/derived images are fine).
#
# Recon (.falk/02-discover/2026-06-10-cloakbrowser-recon.md): the base
# already ships Node 20 and an entrypoint that starts Xvfb then exec's CMD,
# so we add only our service and reuse both.
FROM cloakhq/cloakbrowser:latest

ENV SERVICE_PORT=8932 \
    CDP_URL=http://127.0.0.1:9222 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

WORKDIR /app/digest

# Runtime deps, installed with the base image's Node 20. connectOverCDP
# means playwright-core needs no bundled browser.
COPY runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Single-file service bundle (esbuild ESM) + launcher.
COPY service.mjs ./service.mjs
COPY launch.sh ./launch.sh
RUN chmod +x ./launch.sh

EXPOSE 8932

# The base ENTRYPOINT (/entrypoint.sh) sets up Xvfb, then exec's this CMD.
CMD ["/app/digest/launch.sh"]

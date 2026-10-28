# Build context must be the repo root (not web/), since the web app pulls in
# ../src/core and this is an npm workspace with one lockfile at the root —
# see the `docker build -f web/Dockerfile .` invocation in
# .github/workflows/release.yml.

FROM node:24-slim AS build
WORKDIR /app

# Installed as its own layer, before the source copy, so `docker build` only
# re-runs `npm ci` when a package.json/lockfile actually changes. npm ci with
# workspaces validates the lockfile against every workspace's package.json,
# so extension/package.json has to be present even though nothing in
# extension/ is otherwise needed to build the web app.
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY extension/package.json extension/package.json
RUN npm ci

COPY src ./src
COPY web ./web
RUN npm run build --workspace web

# Distroless nginx from github.com/neilcar/distroless (Wolfi packages pinned to
# released versions, rebuilt automatically): no shell or package manager, runs as
# non-root, so it listens on 8080. Mainline rather than stable: Wolfi's public
# nginx-stable is stuck at 1.30.2 with unfixed CVEs, mainline has none.
FROM ghcr.io/neilcar/distroless/nginx:mainline@sha256:281cd020a678e234a7f23cc0bad56e3934c31daf8b5283bcbe26a620ebf0b5c2
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080

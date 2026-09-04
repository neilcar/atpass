# Build context must be the repo root (not web/), since the web app pulls in
# ../src/core and this is an npm workspace with one lockfile at the root —
# see the `docker build -f web/Dockerfile .` invocation in
# .github/workflows/release.yml.

FROM node:22-slim AS build
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

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80

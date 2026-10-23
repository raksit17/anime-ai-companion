# Local Live2D renderer dist/types + Cubism Core/shaders are deliberately
# not in Git. Run live2d:setup on the host before building.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY vendor/pixi-live2d5/ vendor/pixi-live2d5/
RUN npm ci --no-audit --no-fund

COPY packages/contracts/ packages/contracts/
COPY apps/web/ apps/web/
# apps/web/.env is excluded from the Docker context: don't bake local
# localhost API URLs or secret configuration into the mobile build.
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 80

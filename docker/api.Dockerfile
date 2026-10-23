# Build from the repository root: docker compose build api
FROM node:22-bookworm-slim AS build
WORKDIR /app

# The web workspace depends on the local pixi-live2d5 package. Its compiled
# artifacts are prepared on the host by npm run live2d:setup.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY vendor/pixi-live2d5/ vendor/pixi-live2d5/
RUN npm ci --no-audit --no-fund

COPY apps/api/ apps/api/
COPY packages/contracts/ packages/contracts/
RUN npm run generate -w apps/api && npm run build -w apps/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package.json
COPY --from=build --chown=node:node /app/package-lock.json /app/package-lock.json
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/api /app/apps/api
COPY --from=build --chown=node:node /app/packages/contracts /app/packages/contracts
USER node
EXPOSE 3001
# Prisma 7 needs its CLI for migrate deploy, included in the build dependencies.
# Seed uses upsert and is safe to rerun without overwriting an existing Yuna.
CMD ["sh", "-c", "npm run db:migrate -w apps/api && npm run db:seed -w apps/api && npm run start -w apps/api"]

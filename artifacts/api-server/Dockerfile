FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/db/ ./lib/db/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter db migrate && pnpm --filter api-server start"]

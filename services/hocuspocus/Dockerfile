FROM node:22-alpine

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/hocuspocus/package.json services/hocuspocus/package.json

RUN pnpm install --frozen-lockfile --filter @tasknebula/hocuspocus --prod --ignore-scripts

COPY services/hocuspocus/src services/hocuspocus/src

WORKDIR /app/services/hocuspocus

USER node

CMD ["node", "src/server.mjs"]

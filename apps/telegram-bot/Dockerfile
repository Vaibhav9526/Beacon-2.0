FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/telegram-bot/package.json apps/telegram-bot/package.json
RUN npm ci --workspace apps/telegram-bot --include-workspace-root
COPY apps/telegram-bot apps/telegram-bot
RUN npm --workspace apps/telegram-bot run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/telegram-bot/package.json ./apps/telegram-bot/package.json
COPY --from=build /app/apps/telegram-bot/dist ./apps/telegram-bot/dist
CMD ["node", "apps/telegram-bot/dist/index.js"]

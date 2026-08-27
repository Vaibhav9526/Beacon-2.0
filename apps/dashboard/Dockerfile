FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/telegram-bot/package.json apps/telegram-bot/package.json
RUN npm ci --workspace apps/dashboard --include-workspace-root
COPY apps/dashboard apps/dashboard
RUN npm --workspace apps/dashboard run build

FROM node:22-alpine AS runner
WORKDIR /app/apps/dashboard
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/dashboard .
EXPOSE 3000
CMD ["npm", "run", "start"]

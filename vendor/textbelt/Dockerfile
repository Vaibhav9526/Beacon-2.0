FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY lib ./lib
COPY server ./server
ENV PORT=9090 NODE_ENV=production
EXPOSE 9090
CMD ["node", "server/app.js"]

FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node config ./config
RUN mkdir -p /data /logs && chown node:node /data /logs

USER node
VOLUME ["/data", "/logs"]
EXPOSE 5568/udp 9000/udp 9001/udp
CMD ["node", "dist/src/index.js"]

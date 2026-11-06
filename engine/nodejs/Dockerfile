# contour-engine — one Node.js 22.x service (Technology Radar: Invest) serving
# the Web UI (Contour Console) and the MCP tools (Contour MCP Server) over one
# core. Multi-stage: build UI + server, then a lean runtime image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vite.config.js ./
COPY src ./src
RUN npm run build:ui && npm run build:server

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8000
# Schema is applied at startup (CONTOUR_AUTO_MIGRATE defaults on).
CMD ["node", "dist/server/main.js"]

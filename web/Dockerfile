FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN mkdir -p public && npm ci

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./

EXPOSE 4324
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0"]

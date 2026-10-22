# build from the repo root:  docker build -f backend/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY shared shared
COPY backend backend
WORKDIR /app/backend
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]

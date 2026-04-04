FROM node:20-alpine

WORKDIR /workspace/app

# Install app dependencies first for better layer caching.
COPY app/package*.json ./
RUN npm ci --omit=dev

# Copy runtime sources required by server.js profile loading.
COPY app/ /workspace/app/
COPY template/ /workspace/template/
COPY examples/ /workspace/examples/

ENV NODE_ENV=production
ENV APP_PORT=8080

EXPOSE 8080

CMD ["npm", "start"]

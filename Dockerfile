FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public/ ./public/

RUN mkdir -p /app/data

ENV PORT=5454
ENV DOMAIN=lshang.top
ENV DATA_DIR=/app/data

EXPOSE 5454

CMD ["node", "server.js"]

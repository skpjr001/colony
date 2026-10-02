FROM node:26-alpine
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY server.mjs .
EXPOSE 8080
CMD ["node", "server.mjs"]

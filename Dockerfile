FROM node:20-slim
WORKDIR /app
COPY package.json server.js index.html style.css ./
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]

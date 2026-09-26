FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
ENV PORT=3000 DATA_DIR=/app/data
VOLUME /app/data
CMD ["node", "server.js"]

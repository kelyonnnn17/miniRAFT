FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY services/gateway/package*.json ./services/gateway/
COPY shared/package*.json ./shared/
RUN npm install

COPY . .
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@miniraft/gateway"]

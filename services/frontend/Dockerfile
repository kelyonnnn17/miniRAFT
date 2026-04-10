FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY services/frontend/package*.json ./services/frontend/
RUN npm install

COPY . .
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@miniraft/frontend"]

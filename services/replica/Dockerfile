FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY services/replica/package*.json ./services/replica/
COPY shared/package*.json ./shared/
RUN npm install

COPY . .
EXPOSE 5000
CMD ["npm", "run", "start", "-w", "@miniraft/replica"]

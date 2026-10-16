FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV TARGETS_CSV=test-data/audit-targets.csv

CMD ["npm", "run", "audit"]

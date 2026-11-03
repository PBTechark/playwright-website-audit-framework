# Keep this tag equal to @playwright/test in package-lock.json so the bundled browsers match.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV TARGETS_CSV=test-data/audit-targets.csv

CMD ["npm", "run", "audit"]

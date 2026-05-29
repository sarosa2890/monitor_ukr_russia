# Лёгкий образ для Node-приложения (без внешних зависимостей).
FROM node:20-alpine

WORKDIR /app

# Зависимостей нет, но копируем манифест для кэширования слоёв.
COPY package.json ./
RUN npm install --omit=dev || true

# Копируем код приложения.
COPY . .

# Хостинг задаёт порт через переменную окружения PORT.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]

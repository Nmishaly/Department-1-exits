# אימג' בסיס עם Node.js 22
FROM node:22-slim

WORKDIR /app

# התקנת התלויות. כלי הבנייה דרושים לקומפילציה של better-sqlite3 ומוסרים אחר כך.
COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# קוד האפליקציה
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# בסיס הנתונים נשמר על הכונן הקבוע (volume) שמותקן ב-/data
ENV DB_PATH=/data/data.db

EXPOSE 3000

CMD ["node", "server.js"]

FROM node:24-alpine AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 -m gifs && mkdir /data && chown gifs:gifs /data
COPY server.py ./
COPY migrations ./migrations
COPY --from=client /app/dist ./dist
ENV DATA_DIR=/data APP_ENV=production
EXPOSE 8000
USER gifs
CMD ["sh", "-c", "python server.py migrate && exec gunicorn --bind 0.0.0.0:8000 --workers 2 --access-logfile - server:app"]

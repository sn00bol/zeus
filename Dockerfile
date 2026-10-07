FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt package.json package-lock.json ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && npm ci --omit=dev --no-audit --no-fund

COPY . .

CMD ["python", "app.py"]

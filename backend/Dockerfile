FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl docker.io ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching.
COPY backend/pyproject.toml /app/backend/pyproject.toml
RUN pip install --no-cache-dir \
        "fastapi>=0.115" "uvicorn[standard]>=0.32" "arq>=0.26" "redis>=5.0" \
        "python-multipart>=0.0.12" "pydantic>=2.9" "python-slugify>=8.0" "nanoid>=2.0" \
        "requests>=2.32"

# pipeline + backend live side-by-side; both are mounted at runtime via compose.
ENV PYTHONPATH=/app

EXPOSE 8090

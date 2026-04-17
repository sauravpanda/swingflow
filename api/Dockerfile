FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY pyproject.toml ./
COPY src ./src

RUN pip install .

# Pre-warm the Beat This! checkpoint (~30MB) at build time so the
# first request in a cold container doesn't eat 20+ seconds
# downloading the model. Model weights land in ~/.cache/torch which
# is baked into the image.
RUN python -c "from beat_this.inference import File2Beats; File2Beats(device='cpu', dbn=False)" \
    || echo "WARN: Beat This! warm-up failed; runtime will download on first request"

EXPOSE 8080

CMD uvicorn wcs_api.main:app --host 0.0.0.0 --port ${PORT:-8080}

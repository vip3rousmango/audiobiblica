# Stage 1 -- build the user interface.
FROM node:26-slim AS ui

WORKDIR /ui

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci

COPY src/frontend ./
RUN npm run build

# Stage 2 -- runtime image: the API plus the built UI, on one port.
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src ./src

RUN pip install --no-cache-dir ".[scrapers]"

COPY --from=ui /ui/dist /app/ui

ENV AUDIOBIBLICA_UI_DIR=/app/ui \
    AUDIOBIBLICA_DATA_DIR=/data

EXPOSE 8000

CMD ["uvicorn", "src.backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

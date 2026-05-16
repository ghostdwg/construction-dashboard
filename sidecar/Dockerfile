FROM python:3.11-slim

WORKDIR /app

# Playwright Chromium needs these libs to render JS-driven municipal sites
# (CivicPlus AgendaCenter, etc.) during market source discovery.
RUN apt-get update && apt-get install -y \
  curl \
  fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
  libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium browser for Playwright. Headless-shell is ~140MB (vs full ~280MB).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN python -m playwright install chromium --only-shell && \
    chmod -R a+rx /ms-playwright

COPY . .

RUN addgroup --system --gid 1001 sidecar && \
    adduser --system --uid 1001 --ingroup sidecar sidecar
USER sidecar

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]

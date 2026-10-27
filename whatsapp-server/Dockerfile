FROM node:20-bookworm-slim

# Install Chromium browser, font packages, and CA certificates
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optimize build caching by copying package manifests first
COPY package*.json ./

# Skip Puppeteer's automated download of bundled Chrome since system Chromium is installed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Default host configuration (listening on all interfaces)
ENV WHATSAPP_HOST=0.0.0.0

CMD ["node", "index.js"]

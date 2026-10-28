FROM node:20-bookworm-slim

# Install Chromium browser, font packages, CA certificates, and tini init process
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    tini \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optimize build caching by copying package manifests first
COPY package*.json ./

# Skip Puppeteer's automated download of bundled Chrome since system Chromium is installed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Restrict Node.js heap to 160MB to leave headroom for Chromium within 512MB RAM limit
ENV NODE_OPTIONS="--max-old-space-size=160"

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Default host configuration (listening on all interfaces)
ENV WHATSAPP_HOST=0.0.0.0

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]

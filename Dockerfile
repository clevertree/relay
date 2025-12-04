# Multi-stage build for Relay all-in-one

FROM rust:1.83-slim as builder
WORKDIR /work
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# Cache deps
COPY . /work
WORKDIR /work/apps/server
RUN cargo build --release

FROM node:20-slim as client-builder
WORKDIR /work
# Copy only the client-web directory and root files needed for npm
COPY apps/client-web /work/apps/client-web
WORKDIR /work/apps/client-web
RUN npm ci && npm run build

FROM ubuntu:24.04
LABEL org.opencontainers.image.source="https://github.com/your-org/relay"
WORKDIR /srv/relay

# Install runtime deps: git-daemon, deluge, curl, tar, tini, nginx, certbot
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-daemon-run deluged deluge-web curl tar ca-certificates tini \
    nginx certbot python3-certbot-nginx jq nodejs npm build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:$PATH"

# Install IPFS (Kubo)
ARG TARGETARCH
ENV IPFS_VERSION=v0.28.0
# Download IPFS build matching target architecture (e.g., amd64 or arm64)
RUN curl -L https://dist.ipfs.tech/kubo/${IPFS_VERSION}/kubo_${IPFS_VERSION}_linux-${TARGETARCH}.tar.gz \
    | tar -xz && cp -v kubo/ipfs /usr/local/bin/ && rm -rf kubo

# Copy server binary
COPY --from=builder /work/target/release/relay-server /usr/local/bin/relay-server

# Copy client-web build
COPY --from=client-builder /work/apps/client-web/dist /srv/relay/www

# Create dirs
RUN mkdir -p /srv/relay/data /srv/relay/git /var/lib/deluge /var/log/relay

# Entrypoint script handles:
# - Repository initialization from RELAY_TEMPLATE_URL
# - IPFS, Deluge, and Git daemon startup
# - Relay server startup on RELAY_BIND port
# - DNS registration via Vercel API (if VERCEL_API_TOKEN set)
# - SSL certificate provisioning via Let's Encrypt (if RELAY_CERTBOT_EMAIL set)
# - Nginx proxy configuration for HTTPS
COPY docker/entrypoint.sh /entrypoint.sh
# Ensure entrypoint has Unix line endings inside the image (fixes CRLF from Windows hosts)
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose ports:
# 80, 443 - HTTP/HTTPS (nginx proxy)
# 8088 - Relay server direct access
# 9418 - Git daemon
# 4001 - IPFS swarm (TCP)
# 4001/udp - IPFS swarm (QUIC)
# 5001 - IPFS API
# 8080 - IPFS gateway
# 58846, 58946 - Deluge daemon and web UI
EXPOSE 80 443 8088 9418 4001 4001/udp 5001 8080 58846 58946 58946/udp

# Core configuration
ENV RELAY_REPO_PATH=/srv/relay/data/repo.git \
    RELAY_BIND=0.0.0.0:8088 \
    RELAY_TEMPLATE_URL=https://github.com/clevertree/relay-template

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

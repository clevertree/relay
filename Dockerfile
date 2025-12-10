# Multi-stage build for Relay all-in-one

FROM rust:1.83-slim AS builder
WORKDIR /work
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . /work
WORKDIR /work/apps/server
RUN cargo build --release

## Note: client-web is built outside of Docker (CI/local) and copied in.

FROM ubuntu:24.04
LABEL org.opencontainers.image.source="https://github.com/your-org/relay"
WORKDIR /srv/relay

# Install runtime deps: git-daemon, deluge, curl, tar, tini, certbot (no nginx)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-daemon-run deluged deluge-web curl tar ca-certificates tini \
    certbot jq nodejs npm build-essential pkg-config libssl-dev \
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

# Copy server binary from builder stage
COPY --from=builder /work/target/release/relay-server /usr/local/bin/relay-server

# Copy default self-signed certificates
COPY cert/server.crt cert/server.key /srv/relay/cert/

# Copy client-web build from host (built beforehand)
COPY apps/client-web/dist /srv/relay/www

# Create dirs
RUN mkdir -p /srv/relay/data /srv/relay/git /var/lib/deluge /var/log/relay

# Entrypoint script handles:
# - Repository initialization from RELAY_MASTER_REPO_LIST
# - IPFS, Deluge, and Git daemon startup (optional via env flags)
# - Relay server startup on RELAY_HTTP_PORT/RELAY_HTTPS_PORT (TLS optional)
# - DNS registration via Vercel API (if VERCEL_API_TOKEN set)
# - SSL certificate provisioning via Let's Encrypt webroot (if RELAY_CERTBOT_EMAIL set)
COPY docker/entrypoint.sh /entrypoint.sh
# Ensure entrypoint has Unix line endings inside the image (fixes CRLF from Windows hosts)
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose ports:
# 80, 443 - HTTP/HTTPS served directly by relay-server
# 9418 - Git daemon
# 4001 - IPFS swarm (TCP)
# 4001/udp - IPFS swarm (QUIC)
# 5001 - IPFS API
# 8082 - IPFS gateway
# 58846, 58946 - Deluge daemon and web UI
EXPOSE 80 443 9418 4001 4001/udp 5001 8082 58846 58946 58946/udp

# Core configuration (server treats RELAY_REPO_PATH as a repository ROOT directory now)
ENV RELAY_REPO_PATH=/srv/relay/data \
    RELAY_MASTER_REPO_LIST="" \
    RELAY_ENABLE_IPFS=false \
    RELAY_ENABLE_TORRENTS=false \
    RELAY_HTTP_PORT=80 \
    RELAY_HTTPS_PORT=443 \
    RELAY_ACME_DIR=/var/www/certbot \
    RELAY_STATIC_DIR=/srv/relay/www

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

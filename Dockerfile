# Multi-stage build for Relay all-in-one

FROM rust:1.83-slim as builder
WORKDIR /work
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# Cache deps
COPY apps/server/Cargo.toml apps/server/Cargo.toml
COPY apps/server/src apps/server/src
WORKDIR /work/apps/server
RUN cargo build --release

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/your-org/relay"
WORKDIR /srv/relay

# Install runtime deps: git-daemon, deluge, curl, tar, tini
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-daemon-run deluged deluge-web curl tar ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Install IPFS (Kubo)
ARG TARGETARCH
ENV IPFS_VERSION=v0.28.0
# Download IPFS build matching target architecture (e.g., amd64 or arm64)
RUN curl -L https://dist.ipfs.tech/kubo/${IPFS_VERSION}/kubo_${IPFS_VERSION}_linux-${TARGETARCH}.tar.gz \
    | tar -xz && cp -v kubo/ipfs /usr/local/bin/ && rm -rf kubo

# Copy server binary
COPY --from=builder /work/apps/server/target/release/relay-server /usr/local/bin/relay-server

# Create dirs
RUN mkdir -p /srv/relay/data /srv/relay/git /var/lib/deluge /var/log/relay

# Entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
# Ensure entrypoint has Unix line endings inside the image (fixes CRLF from Windows hosts)
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8088 9418 4001 5001 8080 58846 58946 58946/udp

ENV RELAY_REPO_PATH=/srv/relay/data/repo.git \
    RELAY_BIND=0.0.0.0:8088 \
    RELAY_TEMPLATE_URL=https://github.com/clevertree/relay-template

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

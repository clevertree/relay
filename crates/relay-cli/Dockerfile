# Build stage
FROM rust:1.82-bullseye AS builder
WORKDIR /workspace

# Copy only Cargo files first for caching
COPY Cargo.toml Cargo.lock ./
COPY crates/relay-cli/Cargo.toml crates/relay-cli/Cargo.toml
COPY crates/relay-core/Cargo.toml crates/relay-core/Cargo.toml
COPY crates/relay-repo/Cargo.toml crates/relay-repo/Cargo.toml

# Copy the whole repository
COPY . .

# Build release binary
RUN rustup target add x86_64-unknown-linux-gnu || true
RUN cargo build --release --manifest-path crates/relay-cli/Cargo.toml

# Runtime stage
FROM gcr.io/distroless/cc-debian11
# The crate produces a binary named `relay-cli` in workspace mode; copy and rename it
COPY --from=builder /workspace/target/release/relay-cli /usr/local/bin/relay
ENTRYPOINT ["/usr/local/bin/relay"]

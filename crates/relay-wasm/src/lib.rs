// Placeholder for WebAssembly-safe bindings to relay-core
// In future, gate features for wasm32 and expose JS-friendly APIs.

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

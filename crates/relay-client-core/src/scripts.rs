/// JavaScript engine abstraction and sandbox policy stubs.
use anyhow::Result;

pub trait ScriptEngine {
    fn name(&self) -> &str;
    fn eval(&mut self, code: &str) -> Result<ScriptValue>;
}

#[derive(Debug, Clone)]
pub enum ScriptValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Json(serde_json::Value),
}

#[derive(Debug, Clone, Default)]
pub struct SandboxPolicy {
    /// Allow `fetch` to the selected peer only.
    pub allow_fetch: bool,
    /// Max response bytes for fetch.
    pub fetch_max_bytes: usize,
    /// Per-request timeout millis.
    pub fetch_timeout_ms: u64,
}

/// Placeholder engine (no-op) until a real engine (e.g., rquickjs/boa) is wired.
pub struct NoopEngine;

impl ScriptEngine for NoopEngine {
    fn name(&self) -> &str { "noop" }
    fn eval(&mut self, _code: &str) -> Result<ScriptValue> {
        Ok(ScriptValue::Null)
    }
}

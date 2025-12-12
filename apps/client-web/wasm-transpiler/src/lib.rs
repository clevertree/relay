use wasm_bindgen::prelude::*;

use hook_transpiler::{transpile, TranspileOptions};

#[wasm_bindgen]
pub fn transpile_jsx(source: &str, filename: &str) -> String {
    let opts = TranspileOptions {
        filename: Some(filename.to_string()),
        react_dev: false,
        to_commonjs: false,
        pragma: Some("h".into()),
        pragma_frag: None,
    };

    match transpile(source, opts) {
        Ok(out) => out.code,
        Err(err) => format!("TranspileError: {}", err),
    }
}

#[wasm_bindgen]
pub fn get_version() -> String {
    hook_transpiler::version().to_string()
}

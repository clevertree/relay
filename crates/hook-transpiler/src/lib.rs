use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use swc_common::{errors::{ColorConfig, EmitterWriter, Handler}, sync::Lrc, FileName, Globals, Mark, SourceMap, Span, DUMMY_SP};
use swc_ecma_ast as ast;
use swc_ecma_ast::EsVersion;
use swc_ecma_codegen::{text_writer::JsWriter, Emitter};
use swc_ecma_parser::{EsConfig, Syntax, TsConfig};
use swc_ecma_parser::{lexer::Lexer, Parser, StringInput};
use swc_ecma_transforms_base::resolver;
use swc_ecma_transforms_module::common_js::common_js;
use swc_ecma_transforms_react::react;
use swc_ecma_transforms_typescript::strip as ts_strip;
use swc_ecma_visit::{as_folder, Fold, VisitMut, VisitMutWith};

#[derive(Debug, thiserror::Error)]
pub enum TranspileError {
    #[error("Parse error in {filename} at {line}:{col} — {message}")]
    ParseError { filename: String, line: usize, col: usize, message: String },
    #[error("Transform error in {filename}: {0}")]
    TransformError(String, #[source] anyhow::Error),
    #[error("Codegen error in {filename}: {0}")]
    CodegenError(String, #[source] anyhow::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TranspileOptions {
    pub filename: Option<String>,
    pub react_dev: bool,
    pub to_commonjs: bool,
    pub pragma: Option<String>,
    pub pragma_frag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranspileOutput {
    pub code: String,
    pub map: Option<String>,
}

/// Visitor to rewrite dynamic import(spec) to context.helpers.loadModule(spec)
struct ImportRewriter;
impl VisitMut for ImportRewriter {
    fn visit_mut_expr(&mut self, n: &mut ast::Expr) {
        n.visit_mut_children_with(self);
        if let ast::Expr::Call(call) = n {
            if let ast::Callee::Import(_) = call.callee {
                // import(arg) -> context.helpers.loadModule(arg)
                let arg = call.args.get(0).map(|a| (*a.expr).clone()).unwrap_or(ast::Expr::Lit(ast::Lit::Str(ast::Str { span: DUMMY_SP, value: "".into(), raw: None })));
                let member = ast::Expr::Member(ast::MemberExpr {
                    span: DUMMY_SP,
                    obj: ast::Expr::Member(ast::MemberExpr {
                        span: DUMMY_SP,
                        obj: ast::Expr::Ident(ast::Ident::new("context".into(), DUMMY_SP)).into(),
                        prop: ast::MemberProp::Ident(ast::Ident::new("helpers".into(), DUMMY_SP)),
                    }).into(),
                    prop: ast::MemberProp::Ident(ast::Ident::new("loadModule".into(), DUMMY_SP)),
                });
                *n = ast::Expr::Call(ast::CallExpr {
                    span: call.span,
                    callee: ast::Callee::Expr(Box::new(member)),
                    args: vec![ast::ExprOrSpread { spread: None, expr: Box::new(arg) }],
                    type_args: None,
                });
            }
        }
    }
}

pub fn transpile(source: &str, opts: TranspileOptions) -> std::result::Result<TranspileOutput, TranspileError> {
    let cm: Lrc<SourceMap> = Default::default();
    let filename = opts.filename.clone().unwrap_or_else(|| "module.tsx".to_string());
    let fm = cm.new_source_file(FileName::Custom(filename.clone()), source.to_string());

    let handler = Handler::with_emitter_writer(Box::new(EmitterWriter::stderr(ColorConfig::Never, Some(cm.clone()))), Some(cm.clone()));

    let globals = Globals::new();
    let result = swc_common::GLOBALS.set(&globals, || {
        let is_ts = filename.ends_with(".ts") || filename.ends_with(".tsx");
        let is_jsx = filename.ends_with(".jsx") || filename.ends_with(".tsx") || source.contains('<');
        let syntax = if is_ts {
            Syntax::Typescript(TsConfig { tsx: is_jsx, ..Default::default() })
        } else {
            Syntax::Es(EsConfig { jsx: is_jsx, ..Default::default() })
        };
        let lexer = Lexer::new(syntax, EsVersion::Es2022, StringInput::from(&*fm), None);
        let mut parser = Parser::new_from(lexer);
        let mut module = match parser.parse_module() {
            Ok(m) => m,
            Err(err) => {
                let diag = err.into_diagnostic(&handler);
                // Attempt to get a position
                let (line, col) = match diag.span_primary() {
                    Some(sp) => {
                        let loc = cm.lookup_char_pos(sp.lo());
                        (loc.line, loc.col.0 as usize + 1)
                    }
                    None => (0, 0),
                };
                return Err(TranspileError::ParseError { filename: filename.clone(), line, col, message: "Failed to parse module".into() });
            }
        };

        // Resolve and hygiene
        let unresolved = Mark::new();
        let top_level = Mark::new();
        module.visit_mut_with(&mut resolver(unresolved, top_level, false));

        // TS strip
        if is_ts {
            module.visit_mut_with(&mut as_folder(ts_strip(Default::default())));
        }

        // React transform (classic runtime with pragma)
        if is_jsx {
            let pragma = opts.pragma.clone().unwrap_or_else(|| "h".into());
            let pragma_frag = opts.pragma_frag.clone().unwrap_or_else(|| "React.Fragment".into());
            let react_cfg = react::Options {
                use_builtins: false,
                development: Some(opts.react_dev),
                throw_if_namespace: false,
                runtime: Some(react::Runtime::Classic),
                pragma: Some(pragma),
                pragma_frag: Some(pragma_frag),
                ..Default::default()
            };
            module.visit_mut_with(&mut as_folder(react(react_cfg)));
        }

        // Rewrite dynamic imports
        module.visit_mut_with(&mut ImportRewriter);

        // Optionally transform to CommonJS for environments expecting it
        if opts.to_commonjs {
            module.visit_mut_with(&mut as_folder(common_js(Default::default(), Default::default())));
        }

        // Codegen
        let mut buf = vec![];
        {
            let mut emitter = Emitter {
                cfg: swc_ecma_codegen::Config { target: EsVersion::Es2022, minify: false, ..Default::default() },
                comments: None,
                cm: cm.clone(),
                wr: JsWriter::new(cm.clone(), "\n", &mut buf, None),
            };
            if let Err(e) = emitter.emit_module(&module) {
                return Err(TranspileError::CodegenError(filename.clone(), anyhow::anyhow!(e)));
            }
        }
        let code = String::from_utf8(buf).unwrap_or_default();
        Ok(TranspileOutput { code, map: None })
    });

    match result {
        Ok(out) => Ok(out),
        Err(e) => Err(e),
    }
}

// WASM bindings to use in client-web (feature = "wasm")
#[cfg(feature = "wasm")]
mod wasm_api {
    use super::*;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn transpile_jsx(source: &str, filename: &str) -> JsValue {
        let opts = TranspileOptions {
            filename: Some(filename.to_string()),
            react_dev: false,
            to_commonjs: false,
            pragma: Some("h".to_string()),
            pragma_frag: None,
        };
        match transpile(source, opts) {
            Ok(out) => JsValue::from_str(&out.code),
            Err(e) => {
                // Return a JS Error string for simplicity; host can format nicely
                let msg = format!("TranspileError: {}", e);
                JsValue::from_str(&msg)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_str_eq;

    #[test]
    fn transpiles_basic_jsx() {
        let src = r#"/** @jsx h */\nexport default function App(){ return <div>Hello</div> }"#;
        let out = transpile(src, TranspileOptions { filename: Some("app.jsx".into()), react_dev: false, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).unwrap();
        assert!(out.code.contains("React.createElement") || out.code.contains("h("));
    }

    #[test]
    fn rewrites_dynamic_import() {
        let src = r#"async function x(){ const m = await import('./a.jsx'); return m }"#;
        let out = transpile(src, TranspileOptions { filename: Some("mod.jsx".into()), react_dev: false, to_commonjs: false, pragma: None, pragma_frag: None }).unwrap();
        assert!(out.code.contains("context.helpers.loadModule"));
    }

    #[test]
    fn transpiles_get_client() {
        // Keep short but representative snippet
        let src = r#"/** @jsx h */\nexport default async function getClient(ctx){ const el = <div/>; const q = await import('./query-client.jsx'); return el }"#;
        let out = transpile(src, TranspileOptions { filename: Some("get-client.jsx".into()), react_dev: true, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).unwrap();
        assert!(out.code.contains("context.helpers.loadModule(\"./query-client.jsx\")"));
    }

    #[test]
    fn transpiles_real_get_client_file_if_present() {
        // Attempt to read the actual template file from workspace; if not present, skip
        let candidate = std::path::Path::new("../../template/hooks/client/get-client.jsx");
        if !candidate.exists() {
            eprintln!("[test] Skipping real get-client.jsx transpile test: file not found at {:?}", candidate);
            return;
        }
        let src = std::fs::read_to_string(candidate).expect("read get-client.jsx");
        let out = transpile(
            &src,
            TranspileOptions { filename: Some("get-client.jsx".into()), react_dev: true, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }
        ).expect("transpile get-client.jsx");
        // Basic assertions: JSX transformed and dynamic import rewrites applied
        assert!(out.code.contains("context.helpers.loadModule"), "expected dynamic import rewrite");
        assert!(out.code.contains("React.createElement") || out.code.contains("h("), "expected JSX transform");
    }
}

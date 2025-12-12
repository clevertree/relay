use serde::{Deserialize, Serialize};
use std::io;
use swc_core::common::{comments::SingleThreadedComments, errors::Handler, sync::Lrc, FileName, Globals, Mark, SourceMap, Spanned, SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{self, EsVersion};
use swc_core::ecma::codegen::{text_writer::JsWriter, Config as CodegenConfig, Emitter};
use swc_core::ecma::parser::{lexer::Lexer, EsSyntax, Parser, StringInput, Syntax, TsSyntax};
use swc_core::ecma::transforms::{base::resolver, react, typescript::strip as ts_strip};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

#[derive(Debug, thiserror::Error)]
pub enum TranspileError {
    #[error("Parse error in {filename} at {line}:{col} — {message}")]
    ParseError { filename: String, line: usize, col: usize, message: String },
    #[error("Transform error in {filename}: {source}")]
    TransformError { filename: String, #[source] source: anyhow::Error },
    #[error("Codegen error in {filename}: {source}")]
    CodegenError { filename: String, #[source] source: anyhow::Error },
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
                let ident_ctx = |name: &str| ast::Ident::new(name.into(), DUMMY_SP, SyntaxContext::empty());
                let member = ast::Expr::Member(ast::MemberExpr {
                    span: DUMMY_SP,
                    obj: ast::Expr::Member(ast::MemberExpr {
                        span: DUMMY_SP,
                        obj: ast::Expr::Ident(ident_ctx("context")).into(),
                        prop: ast::MemberProp::Ident(ident_ctx("helpers").into()),
                    }).into(),
                    prop: ast::MemberProp::Ident(ident_ctx("loadModule").into()),
                });
                call.callee = ast::Callee::Expr(Box::new(member));
                call.args = vec![ast::ExprOrSpread { spread: None, expr: Box::new(arg) }];
                call.type_args = None;
            }
        }
    }
}

fn run_module_pass(pass: impl ast::Pass, module: ast::Module) -> ast::Module {
    let mut pass = pass;
    let mut program = ast::Program::Module(module);
    pass.process(&mut program);
    match program {
        ast::Program::Module(module) => module,
        ast::Program::Script(_) => unreachable!("pass unexpectedly produced a script"),
    }
}

pub fn transpile(source: &str, opts: TranspileOptions) -> std::result::Result<TranspileOutput, TranspileError> {
    let cm: Lrc<SourceMap> = Default::default();
    let filename = opts.filename.clone().unwrap_or_else(|| "module.tsx".to_string());
    let fm = cm.new_source_file(FileName::Custom(filename.clone()).into(), source.to_string());

    let handler = Handler::with_emitter_writer(Box::new(io::stderr()), Some(cm.clone()));

    let globals = Globals::new();
    let result = swc_core::common::GLOBALS.set(&globals, || {
        let is_ts = filename.ends_with(".ts") || filename.ends_with(".tsx");
        let is_jsx = filename.ends_with(".jsx") || filename.ends_with(".tsx") || source.contains('<');
        let syntax = if is_ts {
            Syntax::Typescript(TsSyntax { tsx: is_jsx, ..Default::default() })
        } else {
            Syntax::Es(EsSyntax { jsx: is_jsx, ..Default::default() })
        };
        let lexer = Lexer::new(syntax, EsVersion::Es2022, StringInput::from(&*fm), None);
        let mut parser = Parser::new_from(lexer);
        let mut module = match parser.parse_module() {
            Ok(m) => m,
            Err(err) => {
                let span = err.span();
                let kind = err.kind().clone();
                err.into_diagnostic(&handler).emit();
                let loc = cm.lookup_char_pos(span.lo());
                return Err(TranspileError::ParseError {
                    filename: filename.clone(),
                    line: loc.line,
                    col: loc.col.0 as usize + 1,
                    message: format!("{:?}", kind),
                });
            }
        };

        let unresolved = Mark::new();
        let top_level = Mark::new();
        module.visit_mut_with(&mut resolver(unresolved, top_level, false));

        if is_ts {
            module = run_module_pass(ts_strip(unresolved, top_level), module);
        }

        if is_jsx {
            let pragma = opts.pragma.clone().unwrap_or_else(|| "h".into());
            let pragma_frag = opts.pragma_frag.clone().unwrap_or_else(|| "React.Fragment".into());
            let react_cfg = react::Options {
                development: Some(opts.react_dev),
                runtime: Some(react::Runtime::Classic),
                pragma: Some(pragma.into()),
                pragma_frag: Some(pragma_frag.into()),
                ..Default::default()
            };
            let pass = react::react(
                cm.clone(),
                None::<SingleThreadedComments>,
                react_cfg,
                top_level,
                unresolved,
            );
            module = run_module_pass(pass, module);
        }

        module.visit_mut_with(&mut ImportRewriter);

        let mut buf = vec![];
        {
            let mut cfg = CodegenConfig::default();
            cfg.target = EsVersion::Es2022;
            cfg.minify = false;
            let mut emitter = Emitter {
                cfg,
                comments: None,
                cm: cm.clone(),
                wr: JsWriter::new(cm.clone(), "\n", &mut buf, None),
            };
            if let Err(e) = emitter.emit_module(&module) {
                return Err(TranspileError::CodegenError { filename: filename.clone(), source: anyhow::anyhow!(e) });
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

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// WASM bindings to use in client-web (feature = "wasm")
#[cfg(feature = "wasm")]
mod wasm_api {
    use super::*;
    use serde::Serialize;
    use serde_wasm_bindgen::to_value;
    use wasm_bindgen::prelude::*;

    #[derive(Serialize)]
    struct WasmTranspileResult {
        code: Option<String>,
        map: Option<String>,
        error: Option<String>,
    }

    #[wasm_bindgen]
    pub fn transpile_jsx(source: &str, filename: &str) -> JsValue {
        let opts = TranspileOptions {
            filename: Some(filename.to_string()),
            react_dev: false,
            to_commonjs: false,
            pragma: Some("h".to_string()),
            pragma_frag: None,
        };
        let result = match transpile(source, opts) {
            Ok(out) => WasmTranspileResult { code: Some(out.code), map: out.map, error: None },
            Err(err) => WasmTranspileResult { code: None, map: None, error: Some(err.to_string()) },
        };
        to_value(&result).unwrap_or_else(|err| JsValue::from_str(&format!("serde-wasm-bindgen error: {err}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use swc_core::common::{FileName, SourceMap};
    use swc_core::common::sync::Lrc;
    use swc_core::ecma::ast::EsVersion;
    use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax, EsSyntax};
    use std::fs;
    use std::path::PathBuf;

    fn assert_parseable(code: &str) {
        let cm: Lrc<SourceMap> = Default::default();
        let source = code.to_string();
        let fm = cm.new_source_file(FileName::Custom("transpiled.js".into()).into(), source);
        let lexer = Lexer::new(Syntax::Es(EsSyntax { jsx: false, ..Default::default() }), EsVersion::Es2022, StringInput::from(&*fm), None);
        let mut parser = Parser::new_from(lexer);
        parser.parse_module().expect("transpiled output should parse");
    }

    #[test]
    fn transpiles_basic_jsx() {
        let src = "/** @jsx h */\nexport default function App(){ return <div>Hello</div> }";
        let out = transpile(src, TranspileOptions { filename: Some("app.jsx".into()), react_dev: false, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).unwrap();
        assert!(out.code.contains("React.createElement") || out.code.contains("h("));
        assert_parseable(&out.code);
    }

    #[test]
    fn rewrites_dynamic_import() {
        let src = r#"async function x(){ const m = await import('./a.jsx'); return m }"#;
        let out = transpile(src, TranspileOptions { filename: Some("mod.jsx".into()), react_dev: false, to_commonjs: false, pragma: None, pragma_frag: None }).unwrap();
        assert!(out.code.contains("context.helpers.loadModule"));
        assert_parseable(&out.code);
    }

    #[test]
    fn transpiles_get_client() {
        let src = "/** @jsx h */\nexport default async function getClient(ctx){ const el = <div/>; const q = await import('./query-client.jsx'); return el }";
        let out = transpile(src, TranspileOptions { filename: Some("get-client.jsx".into()), react_dev: true, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).unwrap();
    assert!(out.code.contains("context.helpers.loadModule('./query-client.jsx')"));
        assert_parseable(&out.code);
    }

    #[test]
    fn transpiles_real_get_client_file_if_present() {
        let candidate = std::path::Path::new("../../template/hooks/client/get-client.jsx");
        if !candidate.exists() {
            eprintln!("[test] Skipping real get-client.jsx transpile test: file not found at {:?}", candidate);
            return;
        }
        let src = std::fs::read_to_string(candidate).expect("read get-client.jsx");
        let out = transpile(&src, TranspileOptions { filename: Some("get-client.jsx".into()), react_dev: true, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).expect("transpile get-client.jsx");
    assert!(out.code.contains("helpers.loadModule"), "expected helper loadModule usage");
        assert!(out.code.contains("React.createElement") || out.code.contains("h("), "expected JSX transform");
        assert_parseable(&out.code);
    }

    fn fixture_path(rel: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel)
    }

    #[test]
    fn transpiles_query_client_fixture() {
        let path = fixture_path("../../template/hooks/client/query-client.jsx");
        if !path.exists() {
            eprintln!("[test] Skipping query-client fixture test: {:?} does not exist", path);
            return;
        }
        let src = fs::read_to_string(&path).expect("read query-client.jsx");
        let out = transpile(&src, TranspileOptions { filename: Some("query-client.jsx".into()), react_dev: true, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).expect("transpile query-client.jsx");
        assert!(out.code.contains("helpers.loadModule('./components/MovieResults.jsx')"), "expected helpers.loadModule for MovieResults");
        assert!(out.code.contains("helpers.loadModule('./plugin/tmdb.mjs')"), "expected helpers.loadModule for tmdb plugin");
        assert_parseable(&out.code);
    }

    #[test]
    fn transpiles_layout_component_fixture() {
        let path = fixture_path("../../template/hooks/client/components/Layout.jsx");
        if !path.exists() {
            eprintln!("[test] Skipping Layout fixture test: {:?} does not exist", path);
            return;
        }
        let src = fs::read_to_string(&path).expect("read Layout.jsx");
        let out = transpile(&src, TranspileOptions { filename: Some("Layout.jsx".into()), react_dev: false, to_commonjs: false, pragma: Some("h".into()), pragma_frag: None }).expect("transpile Layout.jsx");
        assert!(out.code.contains("h("), "expected Layout output to call h");
        assert_parseable(&out.code);
    }
}

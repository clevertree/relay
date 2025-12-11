use wasm_bindgen::prelude::*;
use swc_core::common::{sync::Lrc, FileName, Globals, SourceMap, Mark, SyntaxContext, GLOBALS};
use swc_core::ecma::ast as ast;
use swc_core::ecma::ast::EsVersion;
use swc_core::ecma::codegen::{text_writer::JsWriter, Emitter};
use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax};
use swc_core::ecma::transforms::react::{react, Runtime, Options as ReactOptions};
use swc_core::ecma::transforms::typescript::strip as ts_strip;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

// Rewrite dynamic import(spec) -> context.helpers.loadModule(spec)
struct ImportRewriter;
impl VisitMut for ImportRewriter {
    fn visit_mut_expr(&mut self, n: &mut ast::Expr) {
        n.visit_mut_children_with(self);
        if let ast::Expr::Call(call) = n {
            if let ast::Callee::Import(_) = call.callee {
                let arg = call.args.get(0).map(|a| (*a.expr).clone()).unwrap_or(ast::Expr::Lit(ast::Lit::Str(ast::Str { span: Default::default(), value: "".into(), raw: None })));
                let member = ast::Expr::Member(ast::MemberExpr {
                    span: Default::default(),
                    obj: ast::Expr::Member(ast::MemberExpr {
                        span: Default::default(),
                        obj: ast::Expr::Ident(ast::Ident::new("context".into(), Default::default(), SyntaxContext::empty())).into(),
                        prop: ast::MemberProp::Ident(ast::Ident::new("helpers".into(), Default::default(), SyntaxContext::empty()).into()),
                    }).into(),
                    prop: ast::MemberProp::Ident(ast::Ident::new("loadModule".into(), Default::default(), SyntaxContext::empty()).into()),
                });
                *n = ast::Expr::Call(ast::CallExpr { span: call.span, ctxt: SyntaxContext::empty(), callee: ast::Callee::Expr(Box::new(member)), args: vec![ast::ExprOrSpread { spread: None, expr: Box::new(arg) }], type_args: None });
            }
        }
    }
}

#[wasm_bindgen]
pub fn transpile_jsx(source: &str, filename: &str) -> String {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(FileName::Custom(filename.to_string()).into(), source.to_string());
    let globals = Globals::new();
    let result = GLOBALS.set(&globals, || {
        let is_ts = filename.ends_with(".ts") || filename.ends_with(".tsx");
        let is_jsx = filename.ends_with(".jsx") || filename.ends_with(".tsx") || source.contains('<');
        // NOTE: EsConfig/TsConfig type locations vary across swc versions.
        // For v50, fall back to permissive modes: Typescript for .ts/.tsx and Es otherwise.
        // If JSX is present in Es mode, parser may error; code will be iterated if needed.
        let syntax = if is_ts { Syntax::Typescript(Default::default()) } else { Syntax::Es(Default::default()) };
        let lexer = Lexer::new(syntax, EsVersion::Es2022, StringInput::from(&*fm), None);
        let mut parser = Parser::new_from(lexer);
        let mut module = parser.parse_module().map_err(|e| e.into_kind().msg().to_string())?;

        // TS strip requires marks in newer API
        let unresolved = Mark::new();
        let top_level = Mark::new();
        if is_ts { module.visit_mut_with(&mut ts_strip(unresolved, top_level)); }
        // React transform (classic/runtime=classic, pragma h, frag React.Fragment)
        if is_jsx {
            let react_cfg = ReactOptions {
                use_builtins: Some(false),
                development: Some(false),
                throw_if_namespace: Some(false),
                runtime: Some(Runtime::Classic),
                pragma: Some("h".into()),
                pragma_frag: Some("React.Fragment".into()),
                ..Default::default()
            };
            module.visit_mut_with(&mut react(cm.clone(), None, react_cfg, unresolved, top_level));
        }
        // Rewrite dynamic imports
        module.visit_mut_with(&mut ImportRewriter);

        let mut buf = vec![];
        let mut cfg = swc_core::ecma::codegen::Config::default();
        cfg.target = EsVersion::Es2022;
        // Keep readable output during dev
        cfg.minify = false;
        let mut emitter = Emitter {
            cfg,
            comments: None,
            cm: cm.clone(),
            wr: JsWriter::new(cm.clone(), "\n", &mut buf, None),
        };
        emitter.emit_module(&module).map_err(|e| format!("codegen: {e}"))?;
        Ok(String::from_utf8(buf).unwrap_or_default())
    });
    match result { Ok(code) => code, Err(msg) => format!("TranspileError: {}", msg) }
}

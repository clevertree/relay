//! Markdown → Native UI abstraction layer (Valdi integration will live in the app crate).

#[derive(Debug, Clone, Default)]
pub struct MdRenderOptions {
    pub allow_inline_html: bool,
}

/// Parsed UI node representation (simplified placeholder).
#[derive(Debug, Clone)]
pub enum UiNode {
    Text(String),
    Heading { level: u8, text: String },
    Link { text: String, href: String },
    Image { alt: String, src: String },
    Container(Vec<UiNode>),
    CustomTag { name: String, props: serde_json::Value },
}

/// Convert markdown string into an intermediate UI tree.
pub fn parse_markdown_to_tree(md: &str, _opts: &MdRenderOptions) -> Vec<UiNode> {
    // NOTE: This is a minimal stub. Full implementation will use pulldown-cmark and an HTML whitelist
    // for custom tags like <video url="..."/> mapped into UiNode::CustomTag.
    vec![UiNode::Text(md.to_string())]
}

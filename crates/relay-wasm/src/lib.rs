// WebAssembly-safe bindings to relay-core (placeholder)
// In future, gate features for wasm32 and expose JS-friendly APIs.

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// -----------------------------
// Repo schema parsing (serde_yaml)
// -----------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentProperty {
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentDef {
    pub path: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub properties: Option<std::collections::BTreeMap<String, ContentProperty>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IndexDef {
    pub path: String,
    #[serde(default)]
    pub searchPath: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepoSchema {
    pub version: u32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_index")] 
    pub index: String,
    #[serde(default)]
    pub content: Option<ContentDef>,
    #[serde(default)]
    pub indices: Option<std::collections::BTreeMap<String, IndexDef>>,
}

fn default_index() -> String { "README.md".to_string() }

impl RepoSchema {
    pub fn basic(&self) -> (u32, Option<&str>, Option<&str>, &str) {
        (
            self.version,
            self.title.as_deref(),
            self.description.as_deref(),
            self.index.as_str(),
        )
    }

    pub fn content_path(&self) -> Option<&str> {
        self.content.as_ref().map(|c| c.path.as_str())
    }

    pub fn index_by_name(&self, name: &str) -> Option<&IndexDef> {
        self.indices.as_ref()?.get(name)
    }
}

/// Parse a repo `relay.yaml` string into a `RepoSchema`.
/// Returns an error if the YAML is invalid or required fields are missing.
pub fn parse_repo_schema(yaml: &str) -> Result<RepoSchema> {
    let mut schema: RepoSchema = serde_yaml::from_str(yaml)?;
    if schema.index.trim().is_empty() {
        schema.index = default_index();
    }
    // minimal required field validation
    if schema.version == 0 {
        anyhow::bail!("version must be >= 1");
    }
    if let Some(content) = schema.content.as_ref() {
        if content.path.trim().is_empty() {
            anyhow::bail!("content.path is required when content is provided");
        }
    }
    Ok(schema)
}

#[cfg(all(target_arch = "wasm32", feature = "wasm-bindgen"))]
#[wasm_bindgen]
pub fn parse_repo_schema_json(yaml: &str) -> Result<JsValue, JsValue> {
    let schema = parse_repo_schema(yaml).map_err(|e| JsValue::from_str(&e.to_string()))?;
    JsValue::from_serde(&schema).map_err(|e| JsValue::from_str(&e.to_string()))
}

//! relay-repo: Shared repository schema parsing, validation, templating, and FS helpers.
//! This crate centralizes `relay.yaml` logic used by CLI and WASM bindings.

use anyhow::{anyhow, bail, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// -----------------------------
// Schema types
// -----------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContentDef {
    pub path: String,
    #[serde(default = "default_meta_file")]
    pub metaFile: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub properties: Option<BTreeMap<String, ContentProperty>>,
}

fn default_meta_file() -> String { "meta.json".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexDef {
    pub path: String,
    #[serde(default)]
    pub searchPath: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    pub indices: Option<BTreeMap<String, IndexDef>>,
}

fn default_index() -> String { "README.md".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Violation {
    pub code: String,
    pub path: String,
    pub message: String,
}

// -----------------------------
// Parsing + structural validation
// -----------------------------

pub fn parse_repo_schema(yaml: &str) -> Result<RepoSchema> {
    let mut schema: RepoSchema = serde_yaml::from_str(yaml)
        .with_context(|| "Failed to parse relay.yaml")?;
    if schema.index.trim().is_empty() {
        schema.index = default_index();
    }
    if schema.version == 0 {
        bail!("version must be >= 1");
    }
    if let Some(content) = schema.content.as_ref() {
        if content.path.trim().is_empty() {
            bail!("content.path is required when content is provided");
        }
    }
    Ok(schema)
}

pub fn validate_schema(schema: &RepoSchema) -> Vec<Violation> {
    let mut v = Vec::new();
    if schema.version == 0 {
        v.push(Violation { code: "SCHEMA_VERSION".into(), path: "relay.yaml".into(), message: "version must be >= 1".into() });
    }
    if let Some(content) = schema.content.as_ref() {
        if content.path.trim().is_empty() {
            v.push(Violation { code: "CONTENT_PATH".into(), path: "relay.yaml#/content/path".into(), message: "content.path must be non-empty".into() });
        }
        // Check that placeholders used in templates are known properties
        let props = content.properties.as_ref().map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
        let placeholders = extract_placeholders(&content.path);
        for ph in placeholders {
            if !props.iter().any(|k| k == &ph) {
                v.push(Violation { code: "UNKNOWN_PLACEHOLDER".into(), path: format!("relay.yaml#/content/path:{}", ph), message: format!("placeholder {{{}}} not found in content.properties", ph) });
            }
        }
        if let Some(indices) = schema.indices.as_ref() {
            for (name, idx) in indices.iter() {
                for ph in extract_placeholders(&idx.path) {
                    if !props.iter().any(|k| k == &ph) {
                        v.push(Violation { code: "UNKNOWN_PLACEHOLDER".into(), path: format!("relay.yaml#/indices/{}/path:{}", name, ph), message: format!("placeholder {{{}}} not found in content.properties", ph) });
                    }
                }
            }
        }
        // Validate regex patterns compile
        if let Some(props_map) = content.properties.as_ref() {
            for (name, p) in props_map.iter() {
                if let Some(pat) = p.pattern.as_ref() {
                    if let Err(e) = Regex::new(pat) {
                        v.push(Violation { code: "INVALID_REGEX".into(), path: format!("relay.yaml#/content/properties/{}/pattern", name), message: format!("invalid regex: {}", e) });
                    }
                }
            }
        }
    }
    v
}

fn extract_placeholders(tpl: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut s = tpl;
    while let Some(start) = s.find('{') {
        if let Some(end) = s[start+1..].find('}') {
            let name = &s[start+1..start+1+end];
            if !name.is_empty() {
                out.push(name.to_string());
            }
            s = &s[start+1+end+1..];
        } else { break; }
    }
    out
}

// -----------------------------
// Slugify and templating
// -----------------------------

pub fn slugify<S: AsRef<str>>(s: S) -> String {
    let s = s.as_ref().trim().to_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        let is_alnum = ch.is_ascii_alphanumeric();
        if is_alnum {
            out.push(ch);
            prev_dash = false;
        } else if ch.is_whitespace() || "-_".contains(ch) {
            if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        } else {
            // non-alnum: collapse
            if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        }
    }
    // trim leading/trailing '-'
    while out.starts_with('-') { out.remove(0); }
    while out.ends_with('-') { out.pop(); }
    out
}

#[derive(Debug, Clone, Default)]
pub struct NormalizedProps {
    // raw original values
    pub raw: BTreeMap<String, JsonValue>,
    // slugified strings for path placeholders (only for keys in content.properties)
    pub slug: BTreeMap<String, String>,
}

pub fn normalize_props(content: &ContentDef, raw: &JsonValue) -> Result<NormalizedProps> {
    let mut out = NormalizedProps::default();
    let obj = raw.as_object().ok_or_else(|| anyhow!("--props must be a JSON object"))?;
    // store raw
    for (k, v) in obj.iter() { out.raw.insert(k.clone(), v.clone()); }
    let keys: Vec<String> = content
        .properties
        .as_ref()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    for key in keys {
        if let Some(val) = obj.get(&key) {
            // slugify any value as string
            let slug = if let Some(s) = val.as_str() {
                slugify(s)
            } else if val.is_number() || val.is_boolean() {
                slugify(val.to_string())
            } else { String::new() };
            out.slug.insert(key, slug);
        }
    }
    Ok(out)
}

fn render_template(tpl: &str, props: &NormalizedProps) -> String {
    let mut out = String::new();
    let mut i = 0usize;
    let bytes = tpl.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = tpl[i+1..].find('}') { 
                let name = &tpl[i+1..i+1+end];
                if let Some(val) = props.slug.get(name) { out.push_str(val); }
                i = i + 1 + end + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

pub fn render_content_dir(repo_root: &Path, content: &ContentDef, props: &NormalizedProps) -> PathBuf {
    let rel = render_template(&content.path, props);
    Path::new(repo_root).join(rel)
}

pub fn render_index_dirs(repo_root: &Path, schema: &RepoSchema, props: &NormalizedProps) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Some(indices) = schema.indices.as_ref() {
        for (name, idx) in indices.iter() {
            let rel = render_template(&idx.path, props);
            out.push((name.clone(), Path::new(repo_root).join(rel)));
        }
    }
    out
}

// -----------------------------
// JSON meta validation
// -----------------------------

pub fn validate_meta_against_properties(meta: &JsonValue, props: &Option<BTreeMap<String, ContentProperty>>) -> Vec<Violation> {
    let mut v = Vec::new();
    let obj = match meta.as_object() {
        Some(o) => o,
        None => {
            v.push(Violation { code: "META_NOT_OBJECT".into(), path: "meta".into(), message: "meta file must be a JSON object".into() });
            return v;
        }
    };
    if let Some(map) = props.as_ref() {
        for (name, p) in map.iter() {
            if p.required.unwrap_or(false) {
                if !obj.contains_key(name) || obj.get(name).map(|v| v.is_null()).unwrap_or(true) {
                    v.push(Violation { code: "META_REQUIRED".into(), path: format!("meta.{}", name), message: "required field missing".into() });
                    continue;
                }
            }
            if let Some(t) = p.r#type.as_ref() {
                if let Some(val) = obj.get(name) {
                    let type_ok = match t.as_str() {
                        "string" => val.is_string(),
                        "integer" => val.as_i64().is_some(),
                        "number" => val.is_number(),
                        "boolean" => val.is_boolean(),
                        _ => true,
                    };
                    if !type_ok {
                        v.push(Violation { code: "META_TYPE".into(), path: format!("meta.{}", name), message: format!("expected type {}", t) });
                    }
                    if let (Some(pat), Some(s)) = (p.pattern.as_ref(), val.as_str()) {
                        if Regex::new(pat).map(|re| re.is_match(s)).unwrap_or(false) == false {
                            v.push(Violation { code: "META_PATTERN".into(), path: format!("meta.{}", name), message: format!("value does not match pattern {}", pat) });
                        }
                    }
                }
            }
        }
    }
    v
}

// -----------------------------
// FS helpers (feature = "fs")
// -----------------------------

#[cfg(feature = "fs")]
pub mod fsx {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    pub fn create_dir_link(target: &Path, link: &Path) -> Result<()> {
        if link.exists() {
            // refresh if points elsewhere
            if link.read_link().ok().as_deref() != Some(target) {
                fs::remove_file(link).ok();
            } else { return Ok(()); }
        }
        std::os::unix::fs::symlink(&target, &link)
            .with_context(|| format!("failed to create symlink {:?} -> {:?}", link, target))
    }

    #[cfg(windows)]
    pub fn create_dir_link(target: &Path, link: &Path) -> Result<()> {
        use std::os::windows::fs as winfs;
        if link.exists() {
            // try remove existing
            if link.is_symlink() { std::fs::remove_file(link).ok(); }
            else if link.is_dir() { std::fs::remove_dir_all(link).ok(); }
        }
        // Prefer symlink_dir
        match winfs::symlink_dir(&target, &link) {
            Ok(_) => return Ok(()),
            Err(e1) => {
                // Try junction via cmd mklink /J (Windows requires privileges for symlink)
                let target_str = target.to_string_lossy();
                let link_str = link.to_string_lossy();
                let status = std::process::Command::new("cmd")
                    .args(["/C", "mklink", "/J", &link_str, &target_str])
                    .status();
                match status {
                    Ok(s) if s.success() => Ok(()),
                    _ => Err(anyhow!("failed to create Windows symlink/junction for {:?} -> {:?}: {}", link, target, e1)),
                }
            }
        }
    }

    pub fn atomic_write_json(path: &Path, value: &JsonValue) -> Result<()> {
        let dir = path.parent().ok_or_else(|| anyhow!("invalid path"))?;
        fs::create_dir_all(dir)?;
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

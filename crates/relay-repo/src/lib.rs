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

#[allow(non_snake_case)]
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

fn default_meta_file() -> String {
    "meta.json".to_string()
}

#[allow(non_snake_case)]
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

fn default_index() -> String {
    "README.md".to_string()
}

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
    let mut schema: RepoSchema =
        serde_yaml::from_str(yaml).with_context(|| "Failed to parse relay.yaml")?;
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
        v.push(Violation {
            code: "SCHEMA_VERSION".into(),
            path: "relay.yaml".into(),
            message: "version must be >= 1".into(),
        });
    }
    if let Some(content) = schema.content.as_ref() {
        if content.path.trim().is_empty() {
            v.push(Violation {
                code: "CONTENT_PATH".into(),
                path: "relay.yaml#/content/path".into(),
                message: "content.path must be non-empty".into(),
            });
        }
        // Check that placeholders used in templates are known properties
        let props = content
            .properties
            .as_ref()
            .map(|m| m.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let placeholders = extract_placeholders(&content.path);
        for ph in placeholders {
            if !props.iter().any(|k| k == &ph) {
                v.push(Violation {
                    code: "UNKNOWN_PLACEHOLDER".into(),
                    path: format!("relay.yaml#/content/path:{}", ph),
                    message: format!("placeholder {{{}}} not found in content.properties", ph),
                });
            }
        }
        if let Some(indices) = schema.indices.as_ref() {
            for (name, idx) in indices.iter() {
                for ph in extract_placeholders(&idx.path) {
                    if !props.iter().any(|k| k == &ph) {
                        v.push(Violation {
                            code: "UNKNOWN_PLACEHOLDER".into(),
                            path: format!("relay.yaml#/indices/{}/path:{}", name, ph),
                            message: format!(
                                "placeholder {{{}}} not found in content.properties",
                                ph
                            ),
                        });
                    }
                }
            }
        }
        // Validate regex patterns compile
        if let Some(props_map) = content.properties.as_ref() {
            for (name, p) in props_map.iter() {
                if let Some(pat) = p.pattern.as_ref() {
                    if let Err(e) = Regex::new(pat) {
                        v.push(Violation {
                            code: "INVALID_REGEX".into(),
                            path: format!("relay.yaml#/content/properties/{}/pattern", name),
                            message: format!("invalid regex: {}", e),
                        });
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
        if let Some(end) = s[start + 1..].find('}') {
            let name = &s[start + 1..start + 1 + end];
            if !name.is_empty() {
                out.push(name.to_string());
            }
            s = &s[start + 1 + end + 1..];
        } else {
            break;
        }
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
    while out.starts_with('-') {
        out.remove(0);
    }
    while out.ends_with('-') {
        out.pop();
    }
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
    let obj = raw
        .as_object()
        .ok_or_else(|| anyhow!("--props must be a JSON object"))?;
    // store raw
    for (k, v) in obj.iter() {
        out.raw.insert(k.clone(), v.clone());
    }
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
            } else {
                String::new()
            };
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
            if let Some(end) = tpl[i + 1..].find('}') {
                let name = &tpl[i + 1..i + 1 + end];
                if let Some(val) = props.slug.get(name) {
                    out.push_str(val);
                }
                i = i + 1 + end + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

pub fn render_content_dir(
    repo_root: &Path,
    content: &ContentDef,
    props: &NormalizedProps,
) -> PathBuf {
    let rel = render_template(&content.path, props);
    Path::new(repo_root).join(rel)
}

pub fn render_index_dirs(
    repo_root: &Path,
    schema: &RepoSchema,
    props: &NormalizedProps,
) -> Vec<(String, PathBuf)> {
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

pub fn validate_meta_against_properties(
    meta: &JsonValue,
    props: &Option<BTreeMap<String, ContentProperty>>,
) -> Vec<Violation> {
    let mut v = Vec::new();
    let obj = match meta.as_object() {
        Some(o) => o,
        None => {
            v.push(Violation {
                code: "META_NOT_OBJECT".into(),
                path: "meta".into(),
                message: "meta file must be a JSON object".into(),
            });
            return v;
        }
    };
    if let Some(map) = props.as_ref() {
        for (name, p) in map.iter() {
            if p.required.unwrap_or(false)
                && (!obj.contains_key(name) || obj.get(name).map(|v| v.is_null()).unwrap_or(true))
            {
                v.push(Violation {
                    code: "META_REQUIRED".into(),
                    path: format!("meta.{}", name),
                    message: "required field missing".into(),
                });
                continue;
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
                        v.push(Violation {
                            code: "META_TYPE".into(),
                            path: format!("meta.{}", name),
                            message: format!("expected type {}", t),
                        });
                    }
                    if let (Some(pat), Some(s)) = (p.pattern.as_ref(), val.as_str()) {
                        if !Regex::new(pat).map(|re| re.is_match(s)).unwrap_or(false) {
                            v.push(Violation {
                                code: "META_PATTERN".into(),
                                path: format!("meta.{}", name),
                                message: format!("value does not match pattern {}", pat),
                            });
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
            } else {
                return Ok(());
            }
        }
        std::os::unix::fs::symlink(&target, &link)
            .with_context(|| format!("failed to create symlink {:?} -> {:?}", link, target))
    }

    #[cfg(windows)]
    pub fn create_dir_link(target: &Path, link: &Path) -> Result<()> {
        use std::os::windows::fs as winfs;
        if link.exists() {
            // try remove existing
            if link.is_symlink() {
                std::fs::remove_file(link).ok();
            } else if link.is_dir() {
                std::fs::remove_dir_all(link).ok();
            }
        }
        // Prefer symlink_dir
        match winfs::symlink_dir(target, link) {
            Ok(_) => Ok(()),
            Err(e1) => {
                // Try junction via cmd mklink /J (Windows requires privileges for symlink)
                let target_str = target.to_string_lossy();
                let link_str = link.to_string_lossy();
                let status = std::process::Command::new("cmd")
                    .args(["/C", "mklink", "/J", &link_str, &target_str])
                    .status();
                match status {
                    Ok(s) if s.success() => Ok(()),
                    _ => Err(anyhow!(
                        "failed to create Windows symlink/junction for {:?} -> {:?}: {}",
                        link,
                        target,
                        e1
                    )),
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

// -----------------------------
// High-level repo operations (feature = "fs")
// -----------------------------

#[cfg(feature = "fs")]
pub mod ops {
    use super::*;
    use std::fs;

    pub fn load_schema_yaml(repo_root: &Path) -> Result<String> {
        let path = repo_root.join("relay.yaml");
        let s = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(s)
    }

    pub fn load_schema_from_repo(repo_root: &Path) -> Result<RepoSchema> {
        let yaml = load_schema_yaml(repo_root)?;
        parse_repo_schema(&yaml)
    }

    fn template_base_dir(tpl: &str) -> &str {
        match tpl.find('{') {
            Some(i) => tpl[..i].trim_end_matches('/'),
            None => tpl.trim_end_matches('/'),
        }
    }

    pub fn validate_repo(repo_root: &Path) -> Result<Vec<Violation>> {
        let mut out = Vec::new();
        let schema = load_schema_from_repo(repo_root)?;
        out.extend(super::validate_schema(&schema));
        // Content meta validation
        if let Some(content) = schema.content.as_ref() {
            let base = template_base_dir(&content.path);
            if !base.is_empty() {
                let root = repo_root.join(base);
                if root.exists() {
                    for entry in walkdir::WalkDir::new(&root)
                        .into_iter()
                        .filter_map(|e| e.ok())
                    {
                        if entry.file_type().is_file() && entry.file_name() == std::ffi::OsStr::new(&content.metaFile) {
                            let path = entry.path().to_path_buf();
                            match std::fs::read_to_string(&path) {
                                Ok(txt) => match serde_json::from_str::<JsonValue>(&txt) {
                                    Ok(json) => {
                                        let v = super::validate_meta_against_properties(
                                            &json,
                                            &content.properties,
                                        );
                                        for mut viol in v {
                                            viol.path = path
                                                .strip_prefix(repo_root)
                                                .unwrap_or(&path)
                                                .display()
                                                .to_string();
                                            out.push(viol);
                                        }
                                    }
                                    Err(e) => out.push(Violation {
                                        code: "META_JSON".into(),
                                        path: path
                                            .strip_prefix(repo_root)
                                            .unwrap_or(&path)
                                            .display()
                                            .to_string(),
                                        message: e.to_string(),
                                    }),
                                },
                                Err(e) => out.push(Violation {
                                    code: "META_READ".into(),
                                    path: path
                                        .strip_prefix(repo_root)
                                        .unwrap_or(&path)
                                        .display()
                                        .to_string(),
                                    message: e.to_string(),
                                }),
                            }
                        }
                    }
                }
            }
        }
        // Index link validation: ensure links under index roots resolve to existing dirs
        if let Some(indices) = schema.indices.as_ref() {
            for (name, idx) in indices.iter() {
                let base = template_base_dir(&idx.path);
                if base.is_empty() {
                    continue;
                }
                let idx_root = repo_root.join(base);
                if !idx_root.exists() {
                    continue;
                }
                for entry in walkdir::WalkDir::new(&idx_root)
                    .min_depth(1)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    let p = entry.path();
                    if entry.file_type().is_dir() {
                        // try read_link (works for symlink/junction); if not a link, skip
                        match std::fs::read_link(p) {
                            Ok(target) => {
                                let target_abs = if target.is_absolute() {
                                    target.clone()
                                } else {
                                    idx_root.join(target)
                                };
                                if !target_abs.exists() {
                                    out.push(Violation {
                                        code: "INDEX_BROKEN_LINK".into(),
                                        path: p
                                            .strip_prefix(repo_root)
                                            .unwrap_or(p)
                                            .display()
                                            .to_string(),
                                        message: format!(
                                            "index '{}' link target does not exist: {}",
                                            name,
                                            target_abs.display()
                                        ),
                                    });
                                }
                            }
                            Err(_) => { /* not a link */ }
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct InsertResult {
        pub content_dir: String,
        pub meta_path: String,
        pub index_links: BTreeMap<String, String>,
        pub replaced: bool,
    }

    pub fn insert_entry(
        repo_root: &Path,
        props_json: &JsonValue,
        replace: bool,
    ) -> Result<InsertResult> {
        let schema = load_schema_from_repo(repo_root)?;
        let content = schema
            .content
            .as_ref()
            .ok_or_else(|| anyhow!("schema has no content section"))?;
        let norm = super::normalize_props(content, props_json)?;
        // Ensure required placeholders have values
        if let Some(props_def) = content.properties.as_ref() {
            for (k, def) in props_def.iter() {
                if def.required.unwrap_or(false)
                && !norm.slug.get(k).map(|s| !s.is_empty()).unwrap_or(false)
            {
                bail!("missing required property '{}' for path rendering", k);
            }
            }
        }
        let content_dir = super::render_content_dir(repo_root, content, &norm);
        std::fs::create_dir_all(&content_dir)
            .with_context(|| format!("failed to create content dir: {}", content_dir.display()))?;
        let meta_path = content_dir.join(&content.metaFile);
        // Merge or replace
        let mut new_meta = props_json.clone();
        if meta_path.exists() && !replace {
            if let Ok(existing_txt) = std::fs::read_to_string(&meta_path) {
                if let Ok(mut existing) = serde_json::from_str::<JsonValue>(&existing_txt) {
                    if let (Some(dst), Some(src)) =
                        (existing.as_object_mut(), props_json.as_object())
                    {
                        for (k, v) in src.iter() {
                            dst.insert(k.clone(), v.clone());
                        }
                        new_meta = JsonValue::Object(dst.clone());
                    }
                }
            }
        }
        super::fsx::atomic_write_json(&meta_path, &new_meta)?;
        // Create index links
        let mut index_links = BTreeMap::new();
        if let Some(indices) = schema.indices.as_ref() {
            for (name, _) in indices.iter() {
                // Using public API to render per-index paths
                let dirs = super::render_index_dirs(repo_root, &schema, &norm);
                for (n, link_path) in dirs {
                    if &n != name {
                        continue;
                    }
                    if let Some(parent) = link_path.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    super::fsx::create_dir_link(&content_dir, &link_path)?;
                    index_links.insert(
                        n,
                        link_path
                            .strip_prefix(repo_root)
                            .unwrap_or(&link_path)
                            .display()
                            .to_string(),
                    );
                }
            }
        }
        Ok(InsertResult {
            content_dir: content_dir
                .strip_prefix(repo_root)
                .unwrap_or(&content_dir)
                .display()
                .to_string(),
            meta_path: meta_path
                .strip_prefix(repo_root)
                .unwrap_or(&meta_path)
                .display()
                .to_string(),
            index_links,
            replaced: meta_path.exists() && replace,
        })
    }

    pub fn search_index(
        repo_root: &Path,
        schema: &RepoSchema,
        index: &str,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<PathBuf>> {
        let idx = schema
            .indices
            .as_ref()
            .and_then(|m| m.get(index))
            .ok_or_else(|| anyhow!("unknown index: {}", index))?;
        let q = super::slugify(query);
        let base = template_base_dir(&idx.path);
        let root = repo_root.join(base);
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut results = Vec::new();
        for entry in walkdir::WalkDir::new(&root)
            .min_depth(1)
            .max_depth(4)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains(&q) {
                    // Prefer directories that are links
                    if std::fs::read_link(entry.path()).is_ok() {
                        results.push(entry.path().to_path_buf());
                    }
                }
            }
            if let Some(lim) = limit {
                if results.len() >= lim {
                    break;
                }
            }
        }
        Ok(results)
    }
}

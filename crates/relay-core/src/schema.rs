use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSchema {
    pub version: Option<String>,
    pub name: Option<String>,
    pub allow_extensions: Option<Vec<String>>,
    pub content: Option<Content>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Content {
    pub collections: Option<BTreeMap<String, Collection>>, // generic collections
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub path: Option<String>,
    pub file: Option<String>,
    pub fields: Option<Vec<FieldSpec>>,
    pub constraints: Option<Constraints>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldSpec {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: FieldType,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    String,
    Number,
    Boolean,
    Array,
    Object,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraints {
    pub max_file_size_kb: Option<u64>,
    pub allowed_mime: Option<Vec<String>>, // best-effort for now
}

pub fn find_schema_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".relay").join("schema.yaml")
}

pub fn load_schema_from_repo<P: AsRef<Path>>(repo_root: P) -> Result<RepoSchema> {
    let schema_path = find_schema_path(repo_root.as_ref());
    if !schema_path.exists() {
        bail!("Schema file not found: {}", schema_path.display());
    }
    let data = fs::read_to_string(&schema_path).with_context(|| {
        format!("Failed to read schema file at {}", schema_path.display())
    })?;
    let schema: RepoSchema = serde_yaml::from_str(&data)
        .with_context(|| format!("Failed to parse YAML schema at {}", schema_path.display()))?;
    Ok(schema)
}

/// Very minimal validation stub to ensure allowlist is present and sane.
pub fn quick_validate_repo<P: AsRef<Path>>(repo_root: P) -> Result<()> {
    let schema = load_schema_from_repo(&repo_root)?;
    if let Some(exts) = &schema.allow_extensions {
        if exts.is_empty() {
            bail!("allow_extensions is empty in schema");
        }
        for e in exts {
            if !e.starts_with('.') {
                bail!("Invalid extension in allow_extensions: {e} (must start with '.')");
            }
        }
    } else {
        bail!("Schema missing allow_extensions section");
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub passed: bool,
    pub errors: Vec<ValidationError>,
}

/// Full repository validation according to schema.
pub fn validate_repo<P: AsRef<Path>>(repo_root: P) -> Result<ValidationReport> {
    let root = repo_root.as_ref();
    let schema = load_schema_from_repo(root)?;

    // Build allowed extensions set (lowercased)
    let mut allowed_exts = HashMap::new();
    if let Some(exts) = schema.allow_extensions.clone() {
        for e in exts {
            allowed_exts.insert(e.to_ascii_lowercase(), ());
        }
    }

    let mut errors: Vec<ValidationError> = Vec::new();

    // Iterate collections
    if let Some(content) = &schema.content {
        if let Some(map) = &content.collections {
            for (name, coll) in map {
                // Resolve base path
                let rel = coll.path.clone().unwrap_or_default();
                let pattern = coll.file.clone().unwrap_or_else(|| "*".to_string());
                let base = root.join(rel);
                let glob_pattern = base.join(pattern);
                let pattern_str = glob_pattern.to_string_lossy().to_string();

                // Enumerate files
                match glob::glob(&pattern_str) {
                    Ok(paths) => {
                        for entry in paths.flatten() {
                            if entry.is_file() {
                                // Extension check
                                if let Some(ext) = entry.extension().and_then(|s| s.to_str()) {
                                    let dot_ext = format!(".{}", ext).to_ascii_lowercase();
                                    if !allowed_exts.is_empty() && !allowed_exts.contains_key(&dot_ext) {
                                        errors.push(ValidationError {
                                            path: entry.to_string_lossy().into_owned(),
                                            code: "ext.not_allowed".into(),
                                            message: format!("File extension '{}' not in allowlist for collection '{}'", dot_ext, name),
                                        });
                                    }
                                } else {
                                    // No extension
                                    if !allowed_exts.is_empty() {
                                        errors.push(ValidationError {
                                            path: entry.to_string_lossy().into_owned(),
                                            code: "ext.missing".into(),
                                            message: "File has no extension but allowlist is enforced".into(),
                                        });
                                    }
                                }

                                // Size check
                                if let Ok(md) = fs::metadata(&entry) {
                                    if let Some(max_kb) = coll
                                        .constraints
                                        .as_ref()
                                        .and_then(|c| c.max_file_size_kb)
                                    {
                                        let size_kb = (md.len() + 1023) / 1024; // ceil
                                        if size_kb > max_kb {
                                            errors.push(ValidationError {
                                                path: entry.to_string_lossy().into_owned(),
                                                code: "size.exceeded".into(),
                                                message: format!(
                                                    "File size {} KB exceeds limit {} KB",
                                                    size_kb, max_kb
                                                ),
                                            });
                                        }
                                    }
                                }

                                // MIME check (best-effort: extension-based for now)
                                if let Some(allowed) = coll
                                    .constraints
                                    .as_ref()
                                    .and_then(|c| c.allowed_mime.as_ref())
                                {
                                    let guessed = guess_mime_from_ext(&entry);
                                    if let Some(m) = guessed {
                                        if !allowed.iter().any(|a| a.eq_ignore_ascii_case(&m)) {
                                            errors.push(ValidationError {
                                                path: entry.to_string_lossy().into_owned(),
                                                code: "mime.not_allowed".into(),
                                                message: format!("MIME '{}' not allowed", m),
                                            });
                                        }
                                    }
                                }

                                // JSON field checks
                                if entry
                                    .extension()
                                    .and_then(|s| s.to_str())
                                    .map(|e| e.eq_ignore_ascii_case("json"))
                                    .unwrap_or(false)
                                {
                                    if let Some(fields) = &coll.fields {
                                        match fs::read_to_string(&entry) {
                                            Ok(txt) => match serde_json::from_str::<serde_json::Value>(&txt) {
                                                Ok(val) => validate_json_fields(&entry, fields, &mut errors, val),
                                                Err(e) => errors.push(ValidationError {
                                                    path: entry.to_string_lossy().into_owned(),
                                                    code: "json.parse_error".into(),
                                                    message: e.to_string(),
                                                }),
                                            },
                                            Err(e) => errors.push(ValidationError {
                                                path: entry.to_string_lossy().into_owned(),
                                                code: "file.read_error".into(),
                                                message: e.to_string(),
                                            }),
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => errors.push(ValidationError {
                        path: pattern_str.clone(),
                        code: "glob.error".into(),
                        message: e.to_string(),
                    }),
                }
            }
        }
    }

    Ok(ValidationReport { passed: errors.is_empty(), errors })
}

fn guess_mime_from_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let m = match ext.as_str() {
        "json" => "application/json",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "html" => "text/html",
        "css" => "text/css",
        "xml" => "application/xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => return None,
    };
    Some(m.to_string())
}

fn validate_json_fields(path: &Path, fields: &Vec<FieldSpec>, errors: &mut Vec<ValidationError>, val: serde_json::Value) {
    let obj = match val.as_object() {
        Some(o) => o,
        None => {
            errors.push(ValidationError {
                path: path.to_string_lossy().into_owned(),
                code: "json.not_object".into(),
                message: "Top-level JSON value must be an object".into(),
            });
            return;
        }
    };
    for f in fields {
        if !obj.contains_key(&f.key) {
            if f.required {
                errors.push(ValidationError {
                    path: path.to_string_lossy().into_owned(),
                    code: "field.missing".into(),
                    message: format!("Missing required field '{}'", f.key),
                });
            }
            continue;
        }
        let v = &obj[&f.key];
        let type_ok = match f.kind {
            FieldType::String => v.is_string(),
            FieldType::Number => v.is_number(),
            FieldType::Boolean => v.is_boolean(),
            FieldType::Array => v.is_array(),
            FieldType::Object => v.is_object(),
        };
        if !type_ok {
            errors.push(ValidationError {
                path: path.to_string_lossy().into_owned(),
                code: "field.type".into(),
                message: format!("Field '{}' has wrong type", f.key),
            });
        }
    }
}

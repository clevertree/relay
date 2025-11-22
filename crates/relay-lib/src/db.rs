use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use polodb_core::{bson, bson::doc, Database};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::path::PathBuf;

use crate::normalize_os_path;

// System fields injected into every stored document
pub const SYS_BRANCH: &str = "_branch";
pub const SYS_META_DIR: &str = "_meta_dir";
pub const SYS_CREATED_AT: &str = "_created_at";
pub const SYS_UPDATED_AT: &str = "_updated_at";

// Generic YAML-driven DB spec
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DbSpec {
    pub engine: String,                 // "polodb"
    pub collection: String,             // e.g., "items"
    #[serde(default)]
    pub unique: Vec<String>,            // list of field names (may include _branch)
    #[serde(default)]
    pub indexes: Vec<IndexSpec>,
    #[serde(default)]
    pub mapping: Vec<MapSpec>,
    #[serde(rename = "queryPolicy")]
    pub query_policy: Option<QueryPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexSpec {
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MapSpec {
    pub name: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
    #[serde(default)]
    pub derive: Option<DeriveSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeriveSpec {
    pub fn_: String, // e.g., "lower", "year", "number"
    #[serde(default)]
    pub args: Vec<DeriveArg>,
    #[serde(rename = "fn")]
    #[allow(dead_code)]
    fn_alias: Option<String>, // alias mapping when deserializing from YAML
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeriveArg {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub value: Option<JsonValue>,
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryPolicy {
    #[serde(default)]
    pub fields: Vec<QueryField>,
    #[serde(default)]
    pub sort: Vec<SortSpec>,
    #[serde(default)]
    pub pagination: PaginationSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryField {
    pub name: String,
    #[serde(default)]
    pub ops: Vec<String>, // eq, in, contains, gte, lte, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SortSpec {
    pub field: String,
    #[serde(default = "default_sort_dir")] 
    pub dir: String, // "asc" | "desc"
}

fn default_sort_dir() -> String { "asc".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaginationSpec {
    #[serde(default = "default_page_size")] 
    pub defaultPageSize: u32,
    #[serde(default = "default_max_page_size")] 
    pub maxPageSize: u32,
}

fn default_page_size() -> u32 { 25 }
fn default_max_page_size() -> u32 { 250 }

// Query input and output
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryParams {
    #[serde(default)]
    pub filter: Option<JsonValue>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default, rename = "pageSize")]
    pub page_size: Option<u32>,
    #[serde(default)]
    pub sort: Option<Vec<SortSpec>>, // optional override
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub total: u64,
    pub page: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    pub items: Vec<JsonValue>,
}

pub struct Db {
    pub path: PathBuf,
    pub inner: Database,
}

impl Db {
    pub fn open(path_str: &str) -> Result<Self> {
        let path = normalize_os_path(path_str);
        let inner = Database::open_file(&path)
            .with_context(|| format!("open polodb at {}", path.display()))?;
        Ok(Self { path, inner })
    }

    pub fn ensure_indexes(&self, _spec: &DbSpec) -> Result<()> { Ok(()) }

    pub fn upsert_from_meta(&self, spec: &DbSpec, branch: &str, meta: &JsonValue, meta_dir: &str) -> Result<()> {
        if spec.engine.to_lowercase() != "polodb" { return Err(anyhow!("unsupported engine: {}", spec.engine)); }
        let now: DateTime<Utc> = Utc::now();
        let mut doc_json = serde_json::Map::new();
        // mapping
        for m in &spec.mapping {
            let val = if let Some(der) = &m.derive { self.eval_derive(der, meta)? } else if let Some(from) = &m.from { self.extract_jsonpath(meta, from) } else { JsonValue::Null };
            doc_json.insert(m.name.clone(), val);
        }
        // system fields
        doc_json.insert(SYS_BRANCH.to_string(), JsonValue::String(branch.to_string()));
        doc_json.insert(SYS_META_DIR.to_string(), JsonValue::String(meta_dir.to_string()));
        let ts = JsonValue::String(now.to_rfc3339());
        if !doc_json.contains_key(SYS_CREATED_AT) { doc_json.insert(SYS_CREATED_AT.to_string(), ts.clone()); }
        doc_json.insert(SYS_UPDATED_AT.to_string(), ts);

        // Build filter from unique keys
        let mut filter = bson::Document::new();
        for k in &spec.unique {
            let v = doc_json.get(k).cloned().unwrap_or(JsonValue::Null);
            filter.insert(k, json_to_bson(v));
        }

        // Upsert: implement as delete+insert to avoid API differences
        let coll: polodb_core::Collection<bson::Document> = self.inner.collection(&spec.collection);
        let _ = coll.delete_many(filter)?;
        // Insert full document
        let bson_doc = match json_to_bson(JsonValue::Object(doc_json)) {
            bson::Bson::Document(d) => d,
            _ => bson::Document::new(),
        };
        let _ = coll.insert_one(bson_doc)?;
        Ok(())
    }

    pub fn delete_by_meta_dir(&self, spec: &DbSpec, branch: &str, meta_dir: &str) -> Result<u64> {
        let coll: polodb_core::Collection<bson::Document> = self.inner.collection(&spec.collection);
        let filter = doc!{ SYS_BRANCH: branch, SYS_META_DIR: meta_dir };
        let res = coll.delete_many(filter)?;
        Ok(res.deleted_count as u64)
    }

    pub fn query(&self, spec: &DbSpec, branch: Option<&str>, params: &QueryParams) -> Result<QueryResult> {
        let coll: polodb_core::Collection<bson::Document> = self.inner.collection(&spec.collection);
        let mut filter_doc = bson::Document::new();
        if let Some(b) = branch { if b != "all" { filter_doc.insert(SYS_BRANCH, b); } }
        if let Some(f) = &params.filter { self.apply_filter(&mut filter_doc, f, spec)?; }

        // Pagination
        let def_page_size = spec.query_policy.as_ref().map(|p| p.pagination.defaultPageSize).unwrap_or(25);
        let max_page_size = spec.query_policy.as_ref().map(|p| p.pagination.maxPageSize).unwrap_or(250);
        let page_size = params.page_size.unwrap_or(def_page_size).min(max_page_size);
        let page = params.page.unwrap_or(0);
        let skip = (page as u64) * (page_size as u64);

        // Sort
        let sorts = params.sort.as_ref().or_else(|| spec.query_policy.as_ref().map(|p| &p.sort)).cloned().unwrap_or_default();
        let mut sort_doc = bson::Document::new();
        for s in sorts { let dir = if s.dir.eq_ignore_ascii_case("desc") { -1i32 } else { 1i32 }; sort_doc.insert(s.field, dir); }

        // Find all matching docs and then sort/paginate in memory (portable)
        let mut cursor = coll.find(filter_doc.clone())?;
        let mut all_items: Vec<JsonValue> = Vec::new();
        while let Some(next) = cursor.next() {
            let doc = next?;
            all_items.push(bson_to_json(doc));
        }
        let total = all_items.len() as u64;
        // Apply sort (simple stable sort by stringified field values)
        if !sort_doc.is_empty() {
            let mut sort_fields: Vec<(String, i32)> = sort_doc.into_iter().map(|(k, v)| (k, v.as_i32().unwrap_or(1))).collect();
            // stable sort by last key first
            for (field, dir) in sort_fields.drain(..).rev() {
                let asc = dir >= 0;
                all_items.sort_by(|a, b| {
                    let va = a.get(&field).cloned().unwrap_or(JsonValue::Null);
                    let vb = b.get(&field).cloned().unwrap_or(JsonValue::Null);
                    let sa = json_to_sort_key(&va);
                    let sb = json_to_sort_key(&vb);
                    if asc { sa.cmp(&sb) } else { sb.cmp(&sa) }
                });
            }
        }
        // Pagination
        let start = skip as usize;
        let end = start.saturating_add(page_size as usize).min(all_items.len());
        let items = if start >= all_items.len() { vec![] } else { all_items[start..end].to_vec() };
        Ok(QueryResult { total, page, page_size, items })
    }

    // --- helpers ---
    fn extract_jsonpath(&self, meta: &JsonValue, path: &str) -> JsonValue {
        // Minimal JSONPath subset: $.a.b.c
        if !path.starts_with("$.") { return JsonValue::Null; }
        let mut cur = meta;
        for seg in path.trim_start_matches("$.").split('.') {
            match cur {
                JsonValue::Object(map) => {
                    cur = map.get(seg).unwrap_or(&JsonValue::Null);
                }
                _ => return JsonValue::Null,
            }
        }
        cur.clone()
    }

    fn eval_derive(&self, d: &DeriveSpec, meta: &JsonValue) -> Result<JsonValue> {
        let fname = if let Some(alias) = &d.fn_alias { if !alias.is_empty() { alias } else { &d.fn_ } } else { &d.fn_ };
        match fname.as_str() {
            "lower" => {
                let s = self.arg_as_string(d.args.get(0), meta)?;
                Ok(JsonValue::String(s.to_lowercase()))
            }
            "trim" => {
                let s = self.arg_as_string(d.args.get(0), meta)?;
                Ok(JsonValue::String(s.trim().to_string()))
            }
            "number" => {
                let s = self.arg_as_string(d.args.get(0), meta)?;
                let n = s.parse::<f64>().unwrap_or(0.0);
                Ok(JsonValue::from(n))
            }
            "year" => {
                let s = self.arg_as_string(d.args.get(0), meta)?;
                let y = s.get(0..4).and_then(|yy| yy.parse::<i64>().ok()).unwrap_or(0);
                Ok(JsonValue::from(y))
            }
            _ => Err(anyhow!("unknown derive.fn: {}", fname)),
        }
    }

    fn arg_as_string(&self, arg: Option<&DeriveArg>, meta: &JsonValue) -> Result<String> {
        let Some(a) = arg else { return Ok(String::new()); };
        if let Some(ref from) = a.from { 
            Ok(self.extract_jsonpath(meta, from).as_str().unwrap_or("").to_string())
        } else if let Some(ref v) = a.value { Ok(v.as_str().unwrap_or("").to_string()) } else { Ok(String::new()) }
    }
}

// --- JSON <-> BSON helpers ---
fn json_to_bson(v: JsonValue) -> bson::Bson {
    match v {
        JsonValue::Null => bson::Bson::Null,
        JsonValue::Bool(b) => bson::Bson::Boolean(b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() { bson::Bson::Int64(i) }
            else if let Some(u) = n.as_u64() { bson::Bson::Int64(u as i64) }
            else if let Some(f) = n.as_f64() { bson::Bson::Double(f) }
            else { bson::Bson::Null }
        }
        JsonValue::String(s) => bson::Bson::String(s),
        JsonValue::Array(arr) => bson::Bson::Array(arr.into_iter().map(json_to_bson).collect()),
        JsonValue::Object(obj) => {
            let mut d = bson::Document::new();
            for (k, v) in obj { d.insert(k, json_to_bson(v)); }
            bson::Bson::Document(d)
        }
    }
}

fn bson_to_json(d: bson::Document) -> JsonValue {
    let mut map = serde_json::Map::new();
    for (k, v) in d.into_iter() {
        map.insert(k, bson_to_json_val(v));
    }
    JsonValue::Object(map)
}

fn bson_to_json_val(v: bson::Bson) -> JsonValue {
    match v {
        bson::Bson::Null => JsonValue::Null,
        bson::Bson::Boolean(b) => JsonValue::Bool(b),
        bson::Bson::Int32(i) => JsonValue::from(i),
        bson::Bson::Int64(i) => JsonValue::from(i),
        bson::Bson::Double(f) => JsonValue::from(f),
        bson::Bson::String(s) => JsonValue::String(s),
        bson::Bson::Array(arr) => JsonValue::Array(arr.into_iter().map(bson_to_json_val).collect()),
        bson::Bson::Document(doc) => bson_to_json(doc),
        other => JsonValue::String(other.to_string()),
    }
    }

    fn json_to_sort_key(v: &JsonValue) -> String {
        match v {
            JsonValue::Null => String::new(),
            JsonValue::Bool(b) => b.to_string(),
            JsonValue::Number(n) => n.to_string(),
            JsonValue::String(s) => s.clone(),
            JsonValue::Array(_) | JsonValue::Object(_) => v.to_string(),
        }
    }

// Extend impl Db with filter application
impl Db {
    fn apply_filter(&self, out: &mut bson::Document, filter: &JsonValue, spec: &DbSpec) -> Result<()> {
        let qp = if let Some(q) = &spec.query_policy { q } else { return Ok(()); };
        let allowed: std::collections::HashMap<_, _> = qp
            .fields
            .iter()
            .map(|f| (f.name.clone(), f.ops.clone()))
            .collect();
        let obj = match filter {
            JsonValue::Object(m) => m,
            _ => return Ok(()),
        };
        for (field, cond) in obj.iter() {
            // skip not allowed fields
            if !allowed.contains_key(field) { continue; }
            let ops = &allowed[field];
            match cond {
                // implicit eq
                v @ (JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) | JsonValue::Array(_) | JsonValue::Object(_)) => {
                    // If value is object, interpret as op map below
                    if v.is_object() {
                        let map = v.as_object().unwrap();
                        let mut sub = bson::Document::new();
                        for (op, val) in map.iter() {
                            self.push_op(&mut sub, op, val, ops);
                        }
                        if !sub.is_empty() { out.insert(field, sub); }
                    } else {
                        // simple equality
                        out.insert(field, json_to_bson(v.clone()));
                    }
                }
            }
        }
        Ok(())
    }

    fn push_op(&self, sub: &mut bson::Document, op: &str, val: &JsonValue, allowed_ops: &Vec<String>) {
        let allow = |name: &str| allowed_ops.is_empty() || allowed_ops.iter().any(|o| o.eq_ignore_ascii_case(name));
        match op.to_ascii_lowercase().as_str() {
            "eq" if allow("eq") => { sub.insert("$eq", json_to_bson(val.clone())); }
            "in" if allow("in") => {
                let arr = match val { JsonValue::Array(a) => a.clone(), other => vec![other.clone()] };
                sub.insert("$in", json_to_bson(JsonValue::Array(arr)));
            }
            "gte" if allow("gte") => { sub.insert("$gte", json_to_bson(val.clone())); }
            "lte" if allow("lte") => { sub.insert("$lte", json_to_bson(val.clone())); }
            "contains" if allow("contains") => {
                // For arrays, Mongo-style shorthand: { field: value } works. Here we fallback to $eq
                sub.insert("$eq", json_to_bson(val.clone()));
            }
            _ => {}
        }
    }
}

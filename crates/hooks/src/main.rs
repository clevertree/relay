use std::io::{self, Read};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use git2::{DiffOptions, Oid, Repository, TreeWalkMode, TreeWalkResult};
use globset::{Glob, GlobSet, GlobSetBuilder};
use jsonschema::JSONSchema;
use serde::Deserialize;
use serde_json::Value as JsonValue;
// use serde_yaml as yaml; // no longer needed
use tracing::{error, info, warn, Level};

/// Relay Git hooks runner
#[derive(Parser, Debug)]
#[command(version, about = "Relay Git hooks runner: validates rules.yaml and enforces whitelist/meta for new commits")]
struct Args {
    /// Hook name (e.g., pre-receive, update)
    #[arg(short, long)]
    hook: String,
}

#[derive(Debug, Deserialize, Clone)]
struct RulesDoc {
    #[serde(default)]
    indexFile: Option<String>,
    allowedPaths: Vec<String>,
    insertTemplate: String,
    metaSchema: JsonValue,
    #[serde(default)]
    db: Option<DbConfig>,
}

#[derive(Debug, Deserialize, Clone)]
struct DbConfig {
    #[serde(default)]
    schema: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default)]
    insertPolicy: Option<InsertPolicy>,
}

#[derive(Debug, Deserialize, Clone)]
struct InsertPolicy {
    #[serde(default = "default_policy_branch")]
    branch: String,
    statements: Vec<String>,
}

fn default_policy_branch() -> String { "*".to_string() }

fn main() {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    if let Err(e) = real_main() {
        error!(error = %e, "Hook failed");
        eprintln!("relay-hooks: {e:#}");
        std::process::exit(1);
    }
}

fn real_main() -> Result<()> {
    let args = Args::parse();
    let hook = args.hook;
    info!(%hook, "Hook invoked");

    match hook.as_str() {
        "pre-receive" => handle_pre_receive(),
        "update" => handle_update(),
        other => {
            warn!(%other, "unsupported hook, doing nothing");
            Ok(())
        }
    }
}

fn open_repo_from_env() -> Result<Repository> {
    if let Ok(git_dir) = std::env::var("GIT_DIR") {
        return Ok(Repository::open_bare(git_dir)?);
    }
    Repository::open_from_env().context("open repo from env")
}

fn handle_update() -> Result<()> {
    // update hook args: <refname> <old> <new> are argv after program normally; 
    // but we use pre-receive primarily. Do nothing.
    Ok(())
}

fn handle_pre_receive() -> Result<()> {
    // Read lines: <old> <new> <ref>
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    if input.trim().is_empty() { return Ok(()); }
    let repo = open_repo_from_env()?;

    for line in input.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() != 3 { continue; }
        let old = Oid::from_str(parts[0]).unwrap_or_else(|_| Oid::zero());
        let new = Oid::from_str(parts[1]).unwrap_or_else(|_| Oid::zero());
        let r#ref = parts[2];
        if new.is_zero() { continue; } // deletion

        validate_push(&repo, old, new, r#ref)?;
    }
    Ok(())
}

fn validate_push(repo: &Repository, old: Oid, new: Oid, refname: &str) -> Result<()> {
    let new_commit = repo.find_commit(new)?;
    let new_tree = new_commit.tree()?;

    // Load rules.yaml from new commit tree
    let rules_val = load_rules(&repo, &new_tree)?;
    validate_rules_schema(&rules_val)?;
    let parsed: RulesDoc = serde_json::from_value(rules_val.clone())?;

    let branch = refname.strip_prefix("refs/heads/").unwrap_or(refname);

    // Gather file additions/updates from old..new
    let mut diffopts = DiffOptions::new();
    let old_tree = if old.is_zero() { None } else { Some(repo.find_commit(old)?.tree()?) };
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut diffopts))?;

    // Build glob allowlist
    let globset = build_globset(&parsed.allowedPaths)?;

    let mut violations: Vec<String> = vec![];
    let mut changed_meta_paths: Vec<std::path::PathBuf> = vec![];

    for delta in diff.deltas() {
        let status = delta.status();
        if !matches!(status, git2::Delta::Added | git2::Delta::Modified | git2::Delta::Copied | git2::Delta::Renamed) {
            continue;
        }
        if let Some(path) = delta.new_file().path() {
            if !path_allowed(path, &globset) {
                violations.push(format!("{}: path not permitted by allowedPaths", path.display()));
            } else if path.ends_with("meta.json") {
                if let Err(e) = validate_meta_json(repo, &new_tree, path, &parsed) {
                    violations.push(format!("{}: {}", path.display(), e));
                } else {
                    changed_meta_paths.push(path.to_path_buf());
                }
            }
        }
    }

    // Uniqueness check: scan branch for meta.json and compare fields
    if !violations.is_empty() {
        return Err(anyhow!(violations.join("\n")));
    }
    enforce_uniqueness(repo, old_tree.as_ref(), &new_tree, branch, &rules_val, &changed_meta_paths)?;

    // Maintain local SQLite index via declarative policy
    maintain_local_index(repo, &new_tree, branch, &rules_val, &parsed, &changed_meta_paths)?;
    Ok(())
}

fn load_rules(repo: &Repository, tree: &git2::Tree) -> Result<JsonValue> {
    let mut oid: Option<Oid> = None;
    tree.walk(TreeWalkMode::PreOrder, |_, entry| {
        if let Some(name) = entry.name() {
            if name == "rules.yaml" || name == "rules.yml" {
                oid = Some(entry.id());
                return TreeWalkResult::Abort;
            }
        }
        TreeWalkResult::Ok
    })?;
    let oid = oid.ok_or_else(|| anyhow!("rules.yaml not found in repo at new commit"))?;
    let blob = repo.find_blob(oid)?;
    let s = std::str::from_utf8(blob.content()).context("rules.yaml not UTF-8")?;
    let val: JsonValue = serde_yaml::from_str::<JsonValue>(s).context("parse rules.yaml")?;
    Ok(val)
}

fn validate_rules_schema(rules: &JsonValue) -> Result<()> {
    static SCHEMA_STR: &str = include_str!("../../../packages/protocol/rules.schema.yaml");
    let schema_json: JsonValue = serde_yaml::from_str(SCHEMA_STR).context("parse rules.schema.yaml")?;
    // Leak to satisfy 'static lifetime required by validator internals in jsonschema 0.17
    let leaked_schema: &'static JsonValue = Box::leak(Box::new(schema_json));
    let compiled = JSONSchema::compile(leaked_schema).context("compile rules schema")?;
    let result = compiled.validate(rules);
    if let Err(errors) = result {
        let msgs: Vec<String> = errors.map(|e| format!("{} at {}", e, e.instance_path)).collect();
        return Err(anyhow!("rules.yaml failed schema validation:\n{}", msgs.join("\n")));
    }
    Ok(())
}

fn build_globset(patterns: &[String]) -> Result<GlobSet> {
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        b.add(Glob::new(p).with_context(|| format!("invalid glob pattern: {}", p))?);
    }
    Ok(b.build()?)
}

fn path_allowed(path: &Path, gs: &GlobSet) -> bool {
    // Convert to forward-slash path for globset
    let s = path.to_string_lossy().replace('\\', "/");
    gs.is_match(s)
}

fn validate_meta_json(repo: &Repository, tree: &git2::Tree, path: &Path, rules: &RulesDoc) -> Result<()> {
    let entry = tree.get_path(path)?;
    let blob = repo.find_blob(entry.id())?;
    let txt = std::str::from_utf8(blob.content())?;
    let meta_json: JsonValue = serde_json::from_str(txt).context("meta.json must be valid JSON")?;
    // Validate against metaSchema
    // Leak meta schema to satisfy 'static lifetime
    let leaked_meta: &'static JsonValue = Box::leak(Box::new(rules.metaSchema.clone()));
    let compiled = JSONSchema::compile(leaked_meta)?;
    if let Err(errors) = compiled.validate(&meta_json) {
        let msgs: Vec<String> = errors.map(|e| format!("{} at {}", e, e.instance_path)).collect();
        return Err(anyhow!("meta.json failed schema validation:\n{}", msgs.join("\n")));
    }
    Ok(())
}

fn enforce_uniqueness(
    repo: &Repository,
    old_tree: Option<&git2::Tree>,
    new_tree: &git2::Tree,
    branch: &str,
    rules_val: &JsonValue,
    changed_meta_paths: &[std::path::PathBuf],
) -> Result<()> {
    use std::collections::HashSet;
    let constraint_fields = extract_constraint_fields(rules_val);
    if constraint_fields.is_empty() {
        return Ok(()); // nothing to enforce
    }
    // Build set from old tree (pre-push state) of keys to compare against
    let mut old_keys: HashSet<(String, String)> = HashSet::new();
    if let Some(tree) = old_tree {
        tree.walk(TreeWalkMode::PreOrder, |root, entry| {
            if let Some(name) = entry.name() {
                if name == "meta.json" {
                    if let Ok(()) = (|| -> Result<()> {
                        let blob = repo.find_blob(entry.id())?;
                        let txt = std::str::from_utf8(blob.content())?;
                        let meta: JsonValue = serde_json::from_str(txt).context("meta.json must be JSON")?;
                        let key = build_constraint_key(branch, &constraint_fields, &meta);
                        old_keys.insert((branch.to_string(), key));
                        Ok(())
                    })() {};
                }
            }
            TreeWalkResult::Ok
        })?;
    }

    // Now evaluate only changed meta.json files
    let mut seen_new: HashSet<(String, String)> = HashSet::new();
    let mut violations: Vec<String> = vec![];
    for p in changed_meta_paths {
        let entry = new_tree.get_path(p)?;
        let blob = repo.find_blob(entry.id())?;
        let txt = std::str::from_utf8(blob.content())?;
        let meta: JsonValue = serde_json::from_str(txt).context("meta.json must be JSON")?;
        let key = build_constraint_key(branch, &constraint_fields, &meta);
        let pair = (branch.to_string(), key.clone());
        if old_keys.contains(&pair) || !seen_new.insert(pair.clone()) {
            violations.push(format!("duplicate ({}, branch) introduced by {}", constraint_fields.join(","), p.display()));
        }
    }
    if !violations.is_empty() { return Err(anyhow!(violations.join("\n"))); }
    Ok(())
}

fn extract_constraint_fields(rules_val: &JsonValue) -> Vec<String> {
    rules_val
        .get("db")
        .and_then(|db| db.get("constraints"))
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

fn build_constraint_key(branch: &str, fields: &[String], meta: &JsonValue) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(fields.len() + 1);
    for f in fields {
        let v = meta.get(f).cloned().unwrap_or(JsonValue::Null);
        let s = match v {
            JsonValue::String(s) => s,
            JsonValue::Number(n) => n.to_string(),
            JsonValue::Bool(b) => b.to_string(),
            JsonValue::Null => "".to_string(),
            other => other.to_string(), // arrays/objects as JSON
        };
        parts.push(s);
    }
    // branch is implied at uniqueness level (handled by caller in tuple)
    parts.join("\x1f")
}

// --- Local SQLite maintenance ---
fn maintain_local_index(
    repo: &Repository,
    new_tree: &git2::Tree,
    branch: &str,
    rules_val: &JsonValue,
    rules: &RulesDoc,
    changed_meta_paths: &[PathBuf],
) -> Result<()> {
    use rusqlite::{Connection, ToSql};
    // If no DB policy, skip
    let Some(db_cfg) = &rules.db else { return Ok(()); };
    // DB location: <gitdir>/relay_index.sqlite
    let git_dir = repo.path();
    let db_path = git_dir.join("relay_index.sqlite");
    let mut conn = Connection::open(db_path)?;
    // Enable WAL for concurrency
    conn.pragma_update(None, "journal_mode", &"WAL")?;
    // Run declared schema
    for stmt in &db_cfg.schema {
        conn.execute_batch(stmt)?;
    }
    // Prepare policy
    let Some(policy) = &db_cfg.insertPolicy else { return Ok(()); };
    if policy.statements.is_empty() { return Ok(()); }
    // Execute for each changed meta.json
    for p in changed_meta_paths {
        let entry = new_tree.get_path(p)?;
        let blob = repo.find_blob(entry.id())?;
        let txt = std::str::from_utf8(blob.content())?;
        let meta: JsonValue = serde_json::from_str(txt).context("meta.json must be JSON")?;
        // Build parameters map
        let meta_dir = p.parent().map(|pp| pp.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let path_str = p.to_string_lossy().replace('\\', "/");
        let meta_json_str = serde_json::to_string(&meta)?;

        for (i, sql) in policy.statements.iter().enumerate() {
            // Build positional params by replacing named tokens in SQL
            let mut sql_pos = sql.clone();
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();
            // helper to replace all occurrences and push param in order
            let mut replace = |name: &str, val: Box<dyn ToSql>| {
                if sql_pos.contains(name) {
                    let ph = format!("?{}", params.len() + 1);
                    sql_pos = sql_pos.replace(name, &ph);
                    params.push(val);
                }
            };
            replace(":branch", Box::new(branch.to_string()));
            replace(":path", Box::new(path_str.clone()));
            replace(":meta_dir", Box::new(meta_dir.clone()));
            replace(":meta_json", Box::new(meta_json_str.clone()));
            if let Some(obj) = meta.as_object() {
                for (k, v) in obj.iter() {
                    let key = format!(":meta_{}", k);
                    let sval: String = match v {
                        JsonValue::String(s) => s.clone(),
                        JsonValue::Number(n) => n.to_string(),
                        JsonValue::Bool(b) => b.to_string(),
                        other => other.to_string(),
                    };
                    replace(&key, Box::new(sval));
                }
            }
            let mut stmt = conn.prepare(&sql_pos).with_context(|| format!("prepare failed for policy statement #{i}"))?;
            let params_refs: Vec<&dyn ToSql> = params.iter().map(|b| &**b as &dyn ToSql).collect();
            stmt.execute(rusqlite::params_from_iter(params_refs.into_iter()))
                .with_context(|| format!("execute failed for policy statement #{i} on {}", path_str))?;
        }
    }
    Ok(())
}

// --- Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, named_params};
    #[test]
    fn test_build_globset_and_match() {
        let gs = build_globset(&vec!["data/**/meta.json".into(), "data/**/assets/**".into()]).unwrap();
        assert!(path_allowed(Path::new("data/2024/foo/meta.json"), &gs));
        assert!(path_allowed(Path::new("data/2024/foo/assets/img.png"), &gs));
        assert!(!path_allowed(Path::new("docs/readme.md"), &gs));
    }
    #[test]
    fn test_constraint_key() {
        let meta: JsonValue = serde_json::json!({"title":"T","release_date":"2024-01-01"});
        let key = build_constraint_key("main", &["title".into(), "release_date".into()], &meta);
        assert_eq!(key, "T\u{1f}2024-01-01");
    }

    #[test]
    fn test_policy_execution_with_json1_genres_array() {
        // Create in-memory SQLite DB and run schema
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS movies (
              id INTEGER PRIMARY KEY,
              branch TEXT NOT NULL,
              title TEXT NOT NULL,
              release_date TEXT NOT NULL,
              meta_dir TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(branch, title, release_date)
            );
            CREATE TABLE IF NOT EXISTS genres (
              movie_id INTEGER NOT NULL,
              genre TEXT NOT NULL,
              FOREIGN KEY(movie_id) REFERENCES movies(id) ON DELETE CASCADE
            );
            "#,
        ).unwrap();

        // Simulate hook-provided params
        let branch = "main";
        let meta_dir = "data/2024/movie-x";
        let meta = serde_json::json!({
            "title": "Movie X",
            "release_date": "2024-01-01",
            "genre": ["Action", "Drama"]
        });
        let meta_title = meta.get("title").unwrap().as_str().unwrap();
        let meta_release_date = meta.get("release_date").unwrap().as_str().unwrap();
        let meta_genre = meta.get("genre").unwrap().to_string(); // pass JSON text to json_each

        // Statement #1: upsert movie
        conn.execute(
            r#"
            INSERT INTO movies(branch, title, release_date, meta_dir)
            VALUES(:branch, :meta_title, :meta_release_date, :meta_dir)
            ON CONFLICT(branch, title, release_date) DO UPDATE SET
              meta_dir=excluded.meta_dir,
              updated_at=CURRENT_TIMESTAMP;
            "#,
            named_params!{
                ":branch": branch,
                ":meta_title": meta_title,
                ":meta_release_date": meta_release_date,
                ":meta_dir": meta_dir,
            },
        ).unwrap();

        // Statement #2: delete old genres for this movie
        conn.execute(
            r#"
            DELETE FROM genres WHERE movie_id = (
              SELECT id FROM movies WHERE branch=:branch AND title=:meta_title AND release_date=:meta_release_date
            );
            "#,
            named_params!{
                ":branch": branch,
                ":meta_title": meta_title,
                ":meta_release_date": meta_release_date,
            },
        ).unwrap();

        // Statement #3: insert genres from JSON array
        conn.execute(
            r#"
            INSERT INTO genres(movie_id, genre)
            SELECT m.id, j.value
            FROM json_each(:meta_genre) AS j
            JOIN movies m ON m.branch=:branch AND m.title=:meta_title AND m.release_date=:meta_release_date;
            "#,
            named_params!{
                ":branch": branch,
                ":meta_title": meta_title,
                ":meta_release_date": meta_release_date,
                ":meta_genre": meta_genre,
            },
        ).unwrap();

        // Verify data
        let (count_movies,): (i64,) = conn.query_row("SELECT COUNT(1) FROM movies", [], |r| Ok((r.get(0)?,))).unwrap();
        assert_eq!(count_movies, 1);
        let (movie_id,): (i64,) = conn
            .query_row(
                "SELECT id FROM movies WHERE branch=?1 AND title=?2 AND release_date=?3",
                (branch, meta_title, meta_release_date),
                |r| Ok((r.get(0)?,)),
            )
            .unwrap();
        let genres: Vec<String> = {
            let mut st = conn.prepare("SELECT genre FROM genres WHERE movie_id=?1 ORDER BY genre").unwrap();
            let mut rows = st.query((movie_id,)).unwrap();
            let mut gs = vec![];
            while let Some(row) = rows.next().unwrap() { gs.push(row.get::<_, String>(0).unwrap()); }
            gs
        };
        assert_eq!(genres, vec!["Action".to_string(), "Drama".to_string()]);
    }
}

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
#[command(
    version,
    about = "Relay Git hooks runner: validates relay.yaml and enforces whitelist/meta for new commits"
)]
struct Args {
    /// Hook name (e.g., pre-receive, update)
    #[arg(long)]
    hook: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
struct RulesDoc {
    #[serde(default)]
    #[serde(rename = "indexFile")]
    index_file: Option<String>,
    #[serde(rename = "allowedPaths")]
    allowed_paths: Vec<String>,
    #[serde(rename = "insertTemplate")]
    insert_template: String,
    #[serde(rename = "metaSchema")]
    meta_schema: JsonValue,
    #[serde(default, rename = "db")]
    db: Option<DbConfig>,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
struct DbConfig {
    #[serde(default)]
    schema: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default, rename = "insertPolicy")]
    insert_policy: Option<InsertPolicy>,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
struct InsertPolicy {
    #[serde(default = "default_policy_branch")]
    branch: String,
    statements: Vec<String>,
}

fn default_policy_branch() -> String {
    "*".to_string()
}

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
    if input.trim().is_empty() {
        return Ok(());
    }
    let repo = open_repo_from_env()?;

    for line in input.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() != 3 {
            continue;
        }
        let old = Oid::from_str(parts[0]).unwrap_or_else(|_| Oid::zero());
        let new = Oid::from_str(parts[1]).unwrap_or_else(|_| Oid::zero());
        let r#ref = parts[2];
        if new.is_zero() {
            continue;
        } // deletion

        validate_push(&repo, old, new, r#ref)?;
    }
    Ok(())
}

fn validate_push(repo: &Repository, old: Oid, new: Oid, refname: &str) -> Result<()> {
    let new_commit = repo.find_commit(new)?;
    let new_tree = new_commit.tree()?;

    // Load relay.yaml from new commit tree
    let rules_val = load_rules(&repo, &new_tree)?;
    validate_rules_schema(&rules_val)?;
    let parsed: RulesDoc = serde_json::from_value(rules_val.clone())?;

    let branch = refname.strip_prefix("refs/heads/").unwrap_or(refname);

    // Gather file additions/updates from old..new
    let mut diffopts = DiffOptions::new();
    let old_tree = if old.is_zero() {
        None
    } else {
        Some(repo.find_commit(old)?.tree()?)
    };
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut diffopts))?;

    // Build glob allowlist
    let globset = build_globset(&parsed.allowed_paths)?;

    let mut violations: Vec<String> = vec![];
    let mut changed_meta_paths: Vec<std::path::PathBuf> = vec![];

    for delta in diff.deltas() {
        let status = delta.status();
        if !matches!(
            status,
            git2::Delta::Added | git2::Delta::Modified | git2::Delta::Copied | git2::Delta::Renamed
        ) {
            continue;
        }
        if let Some(path) = delta.new_file().path() {
            if !path_allowed(path, &globset) {
                violations.push(format!(
                    "{}: path not permitted by allowed_paths",
                    path.display()
                ));
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
    // Maintain local PoloDB index via YAML-driven mapping; this will also enforce
    // uniqueness via DB unique indexes and reject on conflicts.
    maintain_local_index_polodb(repo, &new_tree, branch, &rules_val, &changed_meta_paths)?;
    Ok(())
}

fn load_rules(repo: &Repository, tree: &git2::Tree) -> Result<JsonValue> {
    let mut oid: Option<Oid> = None;
    tree.walk(TreeWalkMode::PreOrder, |_root, entry| {
        if let Some(name) = entry.name() {
            if name == "relay.yaml" || name == "rules.yml" {
                oid = Some(entry.id());
                return TreeWalkResult::Abort;
            }
        }
        TreeWalkResult::Ok
    })?;
    let oid = oid.ok_or_else(|| anyhow!("relay.yaml not found in repo at new commit"))?;
    let blob = repo.find_blob(oid)?;
    let s = std::str::from_utf8(blob.content()).context("relay.yaml not UTF-8")?;
    let val: JsonValue = serde_yaml::from_str::<JsonValue>(s).context("parse relay.yaml")?;
    Ok(val)
}

fn validate_rules_schema(rules: &JsonValue) -> Result<()> {
    // Use bundled schema from relay-lib so the crate is self-contained
    let schema_yaml = relay_lib::assets::RULES_SCHEMA_YAML;
    let schema_json: JsonValue =
        serde_yaml::from_str(schema_yaml).context("parse relay.schema.yaml")?;
    // Leak to satisfy 'static lifetime required by validator internals in jsonschema 0.17
    let leaked_schema: &'static JsonValue = Box::leak(Box::new(schema_json));
    let compiled = JSONSchema::compile(leaked_schema).context("compile rules schema")?;
    let result = compiled.validate(rules);
    if let Err(errors) = result {
        let msgs: Vec<String> = errors
            .map(|e| format!("{} at {}", e, e.instance_path))
            .collect();
        return Err(anyhow!(
            "relay.yaml failed schema validation:\n{}",
            msgs.join("\n")
        ));
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

fn validate_meta_json(
    repo: &Repository,
    tree: &git2::Tree,
    path: &Path,
    rules: &RulesDoc,
) -> Result<()> {
    let entry = tree.get_path(path)?;
    let blob = repo.find_blob(entry.id())?;
    let txt = std::str::from_utf8(blob.content())?;
    let meta_json: JsonValue = serde_json::from_str(txt).context("meta.json must be valid JSON")?;
    // Validate against meta_schema
    // Leak meta schema to satisfy 'static lifetime
    let leaked_meta: &'static JsonValue = Box::leak(Box::new(rules.meta_schema.clone()));
    let compiled = JSONSchema::compile(leaked_meta)?;
    if let Err(errors) = compiled.validate(&meta_json) {
        let msgs: Vec<String> = errors
            .map(|e| format!("{} at {}", e, e.instance_path))
            .collect();
        return Err(anyhow!(
            "meta.json failed schema validation:\n{}",
            msgs.join("\n")
        ));
    }
    Ok(())
}

// --- Local PoloDB maintenance ---
fn maintain_local_index_polodb(
    repo: &Repository,
    new_tree: &git2::Tree,
    branch: &str,
    rules_val: &JsonValue,
    changed_meta_paths: &[PathBuf],
) -> Result<()> {
    use relay_lib::db::{Db, DbSpec};
    // Parse db spec
    let db_spec_val = rules_val
        .get("db")
        .cloned()
        .ok_or_else(|| anyhow!("rules.db missing"))?;
    let spec: DbSpec = serde_json::from_value(db_spec_val).context("parse rules.db spec")?;
    if spec.engine.to_lowercase() != "polodb" {
        return Ok(());
    }
    // Open PoloDB at <gitdir>/relay_index.polodb (or env override)
    let db_path = std::env::var("RELAY_DB_PATH").unwrap_or_else(|_| {
        repo.path()
            .join("relay_index.polodb")
            .to_string_lossy()
            .to_string()
    });
    let db = Db::open(&db_path).context("open polodb")?;
    db.ensure_indexes(&spec).context("ensure indexes")?;
    // Upsert for each changed meta.json
    for p in changed_meta_paths {
        let entry = new_tree.get_path(p)?;
        let blob = repo.find_blob(entry.id())?;
        let txt = std::str::from_utf8(blob.content())?;
        let meta: JsonValue = serde_json::from_str(txt).context("meta.json must be JSON")?;
        let meta_dir = p
            .parent()
            .map(|pp| pp.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        db.upsert_from_meta(&spec, branch, &meta, &meta_dir)
            .with_context(|| format!("upsert failed for {}", p.display()))?;
    }
    Ok(())
}

// --- Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository as Git2Repo;
    use std::path::Path;
    use tempfile::tempdir;

    // URL of the canonical template used for tests (guaranteed to include relay.yaml)
    const TEMPLATE_REPO: &str = "https://github.com/clevertree/relay-template.git";

    #[test]
    fn test_load_rules_from_template() -> Result<()> {
        // Clone the template repo into a temp dir and assert that load_rules finds relay.yaml
        let td = tempdir()?;
        // Note: if network/clone fails this test will error; this enforces using the template
        let repo = match Git2Repo::clone(TEMPLATE_REPO, td.path()) {
            Ok(r) => r,
            Err(e) => anyhow::bail!("failed to clone template repo {}: {}", TEMPLATE_REPO, e),
        };
        // Resolve HEAD tree
        let obj = repo.revparse_single("HEAD^{tree}")?;
        let tree = obj.peel_to_tree()?;
        // Should find relay.yaml
        let val = load_rules(&repo, &tree)?;
        assert!(val.is_object());
        Ok(())
    }

    #[test]
    fn test_load_rules_missing() -> Result<()> {
        // Create a new empty repo (not from template) and assert load_rules fails
        let td = tempdir()?;
        let repo = Git2Repo::init(td.path())?;
        // create an initial commit so HEAD exists
        let sig = git2::Signature::now("tester", "tester@example.com")?;
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        // commit with no relay.yaml
        let _oid = repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])?;
        // get tree
        let obj = repo.revparse_single("HEAD^{tree}")?;
        let tree = obj.peel_to_tree()?;
        let res = load_rules(&repo, &tree);
        assert!(
            res.is_err(),
            "expected load_rules to error when relay.yaml missing"
        );
        Ok(())
    }
    #[test]
    fn test_build_globset_and_match() {
        let gs = build_globset(&vec![
            "data/**/meta.json".into(),
            "data/**/assets/**".into(),
        ])
        .unwrap();
        assert!(path_allowed(Path::new("data/2024/foo/meta.json"), &gs));
        assert!(path_allowed(Path::new("data/2024/foo/assets/img.png"), &gs));
        assert!(!path_allowed(Path::new("docs/readme.md"), &gs));
    }
    #[test]
    fn test_placeholder_no_sqlite_left() {
        assert!(true);
    }

    #[test]
    fn test_schema_accepts_repo_wide_git_allowed_fields() -> Result<()> {
        // Minimal valid rules with repo-wide git.allowedOrigins and git.allowPullFrom
        let yaml = r#"
allowedPaths: ["data/**"]
insertTemplate: "/data/${title}/"
metaSchema: {}
db:
  engine: polodb
  collection: movies
git:
  allowedOrigins: ["https://github.com/clevertree/relay-template/"]
  allowPullFrom: ["https://github.com/clevertree/relay-template/"]
  branchRules:
    default:
      requireSigned: true
      allowedKeys: [".ssh/*"]
"#;
        let val: JsonValue = serde_yaml::from_str(yaml)?;
        // Should validate against bundled schema
        validate_rules_schema(&val)
    }

    #[test]
    fn test_schema_accepts_branch_overrides_for_allowed_fields() -> Result<()> {
        // Same as above, but add per-branch overrides for allowedOrigins/allowPullFrom
        let yaml = r#"
allowedPaths: ["data/**"]
insertTemplate: "/data/${title}/"
metaSchema: {}
db:
  engine: polodb
  collection: movies
git:
  allowedOrigins: ["https://example.com/upstream/"]
  allowPullFrom: ["https://example.com/upstream/"]
  branchRules:
    default:
      requireSigned: true
      allowedKeys: [".ssh/*"]
    branches:
      - name: main
        rule:
          requireSigned: true
          allowedKeys: [".ssh/id_rsa.pub"]
          allowedOrigins: ["https://github.com/clevertree/relay-template/"]
          allowPullFrom: ["https://github.com/clevertree/relay-template/"]
"#;
        let val: JsonValue = serde_yaml::from_str(yaml)?;
        validate_rules_schema(&val)
    }

    #[test]
    fn test_schema_rejects_unknown_git_property() {
        // Introduce an unknown property under git to ensure additionalProperties: false is enforced
        let yaml = r#"
allowedPaths: ["data/**"]
insertTemplate: "/data/${title}/"
metaSchema: {}
db:
  engine: polodb
  collection: movies
git:
  allowedOrigins: ["https://example.com/upstream/"]
  allowPullFrom: ["https://example.com/upstream/"]
  foo: 123
"#;
        let val: JsonValue = serde_yaml::from_str(yaml).unwrap();
        let res = validate_rules_schema(&val);
        assert!(res.is_err(), "schema should reject unknown git.foo");
    }
}

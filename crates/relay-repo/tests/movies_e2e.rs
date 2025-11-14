use relay_repo::ops;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn copy_file(src: &Path, dst: &Path) {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::copy(src, dst).unwrap();
}

fn temp_repo() -> PathBuf {
    let mut p = std::env::temp_dir();
    let uniq = format!(
        "relay_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    p.push(uniq);
    fs::create_dir_all(&p).unwrap();
    p
}

#[cfg_attr(windows, ignore)]
#[test]
fn insert_and_search_movies_repo() {
    // Prepare temp repo
    let repo = temp_repo();
    // Copy movies schema
    let schema_src = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("schema")
        .join("template")
        .join("movies")
        .join("relay.yaml");
    let relay_yaml = repo.join("relay.yaml");
    copy_file(&schema_src, &relay_yaml);
    write_file(&repo.join("README.md"), "# Movies\n\nTest repo.");

    // Insert a movie
    let props = json!({
        "title": "The Matrix",
        "year": 1999,
        "director": "Lana Wachowski"
    });

    let res = ops::insert_entry(&repo, &props, false).expect("insert_entry failed");

    // Expect meta file exists
    let meta_path = repo.join(&res.meta_path);
    assert!(
        meta_path.exists(),
        "meta file should exist at {}",
        meta_path.display()
    );

    // Load schema
    let schema = ops::load_schema_from_repo(&repo).unwrap();

    // Search byTitle
    let by_title = ops::search_index(&repo, &schema, "byTitle", "matrix", Some(10)).unwrap();
    assert!(
        !by_title.is_empty(),
        "expected at least one result for byTitle/matrix"
    );

    // Search byDirector
    let by_director = ops::search_index(&repo, &schema, "byDirector", "lana", Some(10)).unwrap();
    assert!(
        !by_director.is_empty(),
        "expected at least one result for byDirector/lana"
    );

    // Resolve one link and ensure it points to content dir
    let link_dir = &by_title[0];
    let link_target =
        std::fs::read_link(link_dir).expect("index entry should be a symlink/junction");
    let resolved = if link_target.is_absolute() {
        link_target
    } else {
        link_dir.parent().unwrap().join(link_target)
    };
    let content_dir = repo.join(&res.content_dir);
    assert!(
        resolved.exists(),
        "resolved content dir should exist: {}",
        resolved.display()
    );
    // We can't assert equality of absolute paths reliably across platforms, but ensure the content_dir endswith the expected path
    assert!(
        resolved.ends_with(content_dir.file_name().unwrap()),
        "link should point to content dir"
    );
}

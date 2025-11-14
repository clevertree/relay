fn main() {
  // Run the tauri build script to copy/prepare the tauri config into OUT_DIR.
  // This keeps the project self-contained and avoids referencing the removed
  // scaffold crate.
  tauri_build::build()
}

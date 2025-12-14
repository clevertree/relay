use anyhow::{anyhow, Context, Result};
use clap::{ArgAction, Parser, ValueHint};
use relay_hook_transpiler::{transpile, TranspileOptions};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Parser)]
#[command(name = "hook-transpiler", version, about = "Transpile JSX/TSX hooks to JS/CommonJS", long_about = None)]
struct Cli {
    /// Input file or directory. Use '-' to read from stdin.
    #[arg(value_hint = ValueHint::AnyPath)]
    input: Option<PathBuf>,

    /// Output directory for files. If omitted and input is a single file, prints to stdout.
    #[arg(short = 'o', long = "out-dir", value_hint = ValueHint::DirPath)]
    out_dir: Option<PathBuf>,

    /// Force CommonJS output (module.exports). Recommended for React Native.
    #[arg(long = "cjs", action = ArgAction::SetTrue, default_value_t = true)]
    cjs: bool,

    /// Development mode for React transform (adds debug identifiers)
    #[arg(long = "dev", action = ArgAction::SetTrue)]
    dev: bool,

    /// JSX pragma for classic runtime (e.g., h, React.createElement)
    #[arg(long = "pragma")]
    pragma: Option<String>,

    /// JSX fragment pragma for classic runtime (e.g., React.Fragment)
    #[arg(long = "pragma-frag")]
    pragma_frag: Option<String>,

    /// File extensions to include when input is a directory (comma-separated)
    #[arg(long = "ext", default_value = "jsx,tsx,js,mjs")]
    exts: String,

    /// Print result to stdout (only valid when input is a single file)
    #[arg(long = "stdout", action = ArgAction::SetTrue)]
    stdout: bool,
}

fn is_supported(path: &Path, allowed_exts: &[String]) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_l = ext.to_ascii_lowercase();
        allowed_exts.iter().any(|e| e == &ext_l)
    } else {
        false
    }
}

fn transpile_file_to_string(path: &Path, opts: &Cli) -> Result<String> {
    let src = if path == Path::new("-") {
        let mut buf = String::new();
        io::stdin().read_to_string(&mut buf)?;
        buf
    } else {
        fs::read_to_string(path)
            .with_context(|| format!("Failed to read input file: {}", path.display()))?
    };
    let filename = if path == Path::new("-") {
        opts
            .input
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .or_else(|| Some("stdin.jsx".to_string()))
    } else {
        Some(path.file_name().and_then(|s| s.to_str()).unwrap_or("module.jsx").to_string())
    };
    let out = transpile(
        &src,
        TranspileOptions {
            filename,
            react_dev: opts.dev,
            to_commonjs: opts.cjs,
            pragma: opts.pragma.clone(),
            pragma_frag: opts.pragma_frag.clone(),
        },
    )
    .map_err(|e| anyhow!(e.to_string()))?;
    Ok(out.code)
}

fn write_output(out_path: &Path, code: &str) -> Result<()> {
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create output directory: {}", parent.display()))?;
    }
    fs::write(out_path, code)
        .with_context(|| format!("Failed to write output file: {}", out_path.display()))?;
    Ok(())
}

fn output_filename_for(input: &Path) -> PathBuf {
    // Keep same basename, change extension to .js
    let mut fname = input.file_stem().and_then(|s| s.to_str()).unwrap_or("module").to_string();
    fname.push_str(".js");
    PathBuf::from(fname)
}

fn process_single_file(cli: &Cli, input_path: &Path) -> Result<()> {
    let code = transpile_file_to_string(input_path, cli)?;
    if cli.stdout && cli.out_dir.is_none() {
        let mut stdout = io::stdout().lock();
        stdout.write_all(code.as_bytes())?;
        return Ok(());
    }
    let out_path = if let Some(out_dir) = &cli.out_dir {
        out_dir.join(output_filename_for(input_path))
    } else {
        // In-place to sibling .js next to input
        let mut out = input_path.to_path_buf();
        out.set_extension("js");
        out
    };
    write_output(&out_path, &code)
}

fn process_directory(cli: &Cli, dir: &Path) -> Result<()> {
    let out_dir = cli
        .out_dir
        .clone()
        .ok_or_else(|| anyhow!("--out-dir is required when input is a directory"))?;
    let allowed_exts: Vec<String> = cli
        .exts
        .split(',')
        .map(|s| s.trim().trim_start_matches('.').to_ascii_lowercase())
        .collect();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && is_supported(path, &allowed_exts) {
            let rel = pathdiff::diff_paths(path, dir).unwrap_or_else(|| PathBuf::from(path.file_name().unwrap()));
            let mut out_path = out_dir.join(rel);
            out_path.set_extension("js");
            let code = transpile_file_to_string(path, cli)
                .with_context(|| format!("While transpiling {}", path.display()))?;
            write_output(&out_path, &code)?;
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    if cli.input.is_none() {
        // Read from stdin and write to stdout
        let code = transpile_file_to_string(Path::new("-"), &cli)?;
        io::stdout().write_all(code.as_bytes())?;
        return Ok(());
    }
    let input = cli.input.as_ref().unwrap();
    if input == Path::new("-") {
        let code = transpile_file_to_string(Path::new("-"), &cli)?;
        io::stdout().write_all(code.as_bytes())?;
        return Ok(());
    }
    let meta = fs::metadata(input).with_context(|| format!("Input path not found: {}", input.display()))?;
    if meta.is_file() {
        process_single_file(&cli, input)
    } else if meta.is_dir() {
        process_directory(&cli, input)
    } else {
        Err(anyhow!("Input must be a file or directory"))
    }
}

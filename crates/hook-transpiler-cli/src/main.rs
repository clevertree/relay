use anyhow::{anyhow, Context, Result};
use clap::{ArgAction, Parser, Subcommand, ValueHint};
use relay_hook_transpiler::{transpile, TranspileOptions};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

// Themed styler
use themed_styler::api::{SelectorStyles, State as StylerState};

#[derive(Debug, Parser)]
#[command(name = "hook-transpiler", version, about = "Transpile JSX/TSX hooks to JS/CommonJS and manage themed-styler state", long_about = None)]
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

    /// Subcommands. If omitted, defaults to transpile mode using the above options.
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Themed-styler state management and output
    #[command(subcommand)]
    Style(StyleCommands),
}

#[derive(Debug, Subcommand)]
enum StyleCommands {
    /// Initialize a default themed-styler state file
    Init {
        /// Path to state JSON file (default: .themed-styler-state.json)
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
    },
    /// Set the current theme
    SetTheme {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        /// Theme name
        name: String,
    },
    /// Add or merge a theme from a JSON file (mapping selector -> css-props)
    AddTheme {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        /// Theme name to add/merge into
        name: String,
        /// Path to JSON file containing { "selector": { "css-prop": value } }
        #[arg(value_hint = ValueHint::FilePath)]
        theme_json: PathBuf,
    },
    /// Replace variables (named colors) from JSON file { name: value }
    SetVars {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        #[arg(value_hint = ValueHint::FilePath)]
        vars_json: PathBuf,
    },
    /// Replace breakpoints from JSON file { xs: "480px", sm: "640px", ... }
    SetBps {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        #[arg(value_hint = ValueHint::FilePath)]
        bps_json: PathBuf,
    },
    /// Register selectors that are currently in use
    RegisterSelectors {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        /// Selectors (space-separated)
        selectors: Vec<String>,
    },
    /// Register classes that are currently in use
    RegisterClasses {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        classes: Vec<String>,
    },
    /// Clear usage (selectors/classes) from the state
    ClearUsage {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
    },
    /// Output web CSS for currently used selectors/classes
    Css {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        /// Optional output path. If omitted, prints to stdout.
        #[arg(short = 'o', long = "out", value_hint = ValueHint::FilePath)]
        out: Option<PathBuf>,
    },
    /// Output React Native style object for a selector and optional classes
    Rn {
        #[arg(short = 'f', long = "file", value_hint = ValueHint::FilePath)]
        file: Option<PathBuf>,
        /// The base selector (e.g., 'button' or 'View[type=primary]')
        selector: String,
        /// Css classes (space-separated)
        classes: Vec<String>,
    },
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

    if let Some(cmd) = &cli.command {
        return handle_subcommands(cmd);
    }

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

// ---------------- Themed-Styler Subcommands ----------------

fn default_state_path() -> PathBuf { PathBuf::from(".themed-styler-state.json") }

fn load_state(path: Option<&PathBuf>) -> Result<StylerState> {
    let path = path.cloned().unwrap_or_else(|| default_state_path());
    if !path.exists() {
        return Ok(StylerState::new_default());
    }
    let txt = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read state file: {}", path.display()))?;
    let val: serde_json::Value = serde_json::from_str(&txt)?;
    Ok(StylerState::from_json(val)?)
}

fn save_state(path: Option<&PathBuf>, st: &StylerState) -> Result<()> {
    let path = path.cloned().unwrap_or_else(|| default_state_path());
    let val = st.to_json();
    let txt = serde_json::to_string_pretty(&val)?;
    fs::write(&path, txt)
        .with_context(|| format!("Failed to write state file: {}", path.display()))?;
    Ok(())
}

fn handle_subcommands(cmd: &Commands) -> Result<()> {
    match cmd {
        Commands::Style(scmd) => match scmd {
            StyleCommands::Init { file } => {
                let st = StylerState::new_default();
                save_state(file.as_ref(), &st)
            }
            StyleCommands::SetTheme { file, name } => {
                let mut st = load_state(file.as_ref())?;
                st.set_theme(name.clone()).map_err(|e: themed_styler::Error| anyhow!(e.to_string()))?;
                save_state(file.as_ref(), &st)
            }
            StyleCommands::AddTheme { file, name, theme_json } => {
                let mut st = load_state(file.as_ref())?;
                let txt = fs::read_to_string(theme_json)
                    .with_context(|| format!("Failed to read theme json: {}", theme_json.display()))?;
                let map: SelectorStyles = serde_json::from_str(&txt)
                    .with_context(|| "Theme JSON must be an object of { selector: { css-prop: value } }")?;
                st.add_theme(name.clone(), map);
                save_state(file.as_ref(), &st)
            }
            StyleCommands::SetVars { file, vars_json } => {
                let mut st = load_state(file.as_ref())?;
                let txt = fs::read_to_string(vars_json)
                    .with_context(|| format!("Failed to read vars json: {}", vars_json.display()))?;
                let vars: indexmap::IndexMap<String, String> = serde_json::from_str(&txt)
                    .with_context(|| "Vars JSON must be an object of { name: value }")?;
                st.set_variables(vars);
                save_state(file.as_ref(), &st)
            }
            StyleCommands::SetBps { file, bps_json } => {
                let mut st = load_state(file.as_ref())?;
                let txt = fs::read_to_string(bps_json)
                    .with_context(|| format!("Failed to read breakpoints json: {}", bps_json.display()))?;
                let bps: indexmap::IndexMap<String, String> = serde_json::from_str(&txt)
                    .with_context(|| "Breakpoints JSON must be { xs: '480px', ... }")?;
                st.set_breakpoints(bps);
                save_state(file.as_ref(), &st)
            }
            StyleCommands::RegisterSelectors { file, selectors } => {
                let mut st = load_state(file.as_ref())?;
                st.register_selectors(selectors.iter().cloned());
                save_state(file.as_ref(), &st)
            }
            StyleCommands::RegisterClasses { file, classes } => {
                let mut st = load_state(file.as_ref())?;
                st.register_tailwind_classes(classes.iter().cloned());
                save_state(file.as_ref(), &st)
            }
            StyleCommands::ClearUsage { file } => {
                let mut st = load_state(file.as_ref())?;
                st.clear_usage();
                save_state(file.as_ref(), &st)
            }
            StyleCommands::Css { file, out } => {
                let st = load_state(file.as_ref())?;
                let css = st.css_for_web();
                if let Some(path) = out.as_ref() {
                    write_output(path, &css)
                } else {
                    io::stdout().write_all(css.as_bytes())?;
                    Ok(())
                }
            }
            StyleCommands::Rn { file, selector, classes } => {
                let st = load_state(file.as_ref())?;
                let json = st.rn_styles_for(selector, classes);
                let txt = serde_json::to_string_pretty(&json)?;
                io::stdout().write_all(txt.as_bytes())?;
                Ok(())
            }
        },
    }
}

# Windows Setup Guide (GNU Toolchain + MSYS2 UCRT64)

This document describes how to set up a Windows development environment for this project using the Rust GNU toolchain and MSYS2 UCRT64 toolchain.

If you've already completed these steps, use this as a reference for future contributors.

## Prerequisites
- Windows 10/11 x64
- Administrator rights (for PATH and package installation)
- [Rustup](https://rustup.rs/) installed
- [MSYS2](https://www.msys2.org/) installed
- [Node.js](https://nodejs.org/) (LTS version) installed
- [pnpm](https://pnpm.io/) installed (optional, can install via npm: `npm install -g pnpm`)

## 1) Install Rust GNU toolchain (x86_64-pc-windows-gnu)
Run in PowerShell:

```
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup default stable-x86_64-pc-windows-gnu
```

Verify:
```
rustc -V
cargo -V
```
You should see versions that correspond to the `x86_64-pc-windows-gnu` target.

## 2) Install additional Rust tools
Install the required CLI tools for the project:

```
cargo install tauri-cli
cargo install wasm-bindgen-cli
```

## 3) Install MSYS2 UCRT64 toolchain
Open the "MSYS2 UCRT64" shell (not PowerShell) and run:

```
pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain
```

This installs GCC, binutils, and related build tools for the UCRT64 environment.

## 4) Add MSYS2 UCRT64 to PATH (Windows)
Add the following directory to your Windows PATH so that `cargo` can find GCC and related tools:

```
C:\msys64\ucrt64\bin
```

Ways to set PATH:
- Temporary (current PowerShell session only):
  ```
  $env:Path = "C:\\msys64\\ucrt64\\bin;" + $env:Path
  ```
- Persistent (for your user account):
  ```
  setx PATH "C:\\msys64\\ucrt64\\bin;%PATH%"
  ```
  Note: Close and reopen your terminal after using `setx`.

Verify GCC is visible from PowerShell:
```
gcc --version
```

## 5) Build the project
From the project root in PowerShell:

First, install dependencies:
```
pnpm install
```

Then build:
```
pnpm run build
```

If everything is set correctly, the project should build successfully.

## 6) Proceed with development
Follow the project docs/plan for further steps. Typical commands:

- Run tests:
  ```
  cargo test
  ```
- Run the CLI (example):
  ```
  cargo run -p relay-cli -- --help
  ```
- Develop the web app:
  ```
  pnpm --filter ./apps/web dev
  ```

## Troubleshooting
- Linker not found (e.g., `link.exe` or `cc` errors): ensure `C:\msys64\ucrt64\bin` is at the front of PATH in the shell where you run `cargo`.
- Wrong Rust target: run `rustup show` and confirm `stable-x86_64-pc-windows-gnu` is the default.
- Multiple MSYS2 environments: use UCRT64 specifically (paths under `C:\msys64\ucrt64\...`).
- pnpm not found: install via `npm install -g pnpm` or use npm instead.
- Tauri build issues: ensure WebView2 is installed (Tauri will prompt if needed).

## Notes
- This project targets the GNU toolchain on Windows for compatibility with dependencies that expect GCC/MinGW.
- If you switch back to the MSVC toolchain later, use `rustup default stable-x86_64-pc-windows-msvc` and ensure MSVC build tools are installed.
- The project uses a monorepo setup with Rust crates, Next.js web app, and Tauri desktop app.

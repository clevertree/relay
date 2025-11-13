# Windows Setup Guide (GNU Toolchain + MSYS2 UCRT64)

This document describes how to set up a Windows development environment for this project using the Rust GNU toolchain and MSYS2 UCRT64 toolchain.

If you've already completed these steps, use this as a reference for future contributors.

## Prerequisites
- Windows 10/11 x64
- Administrator rights (for PATH and package installation)
- [Rustup](https://rustup.rs/) installed
- [MSYS2](https://www.msys2.org/) installed

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

## 2) Install MSYS2 UCRT64 toolchain
Open the "MSYS2 UCRT64" shell (not PowerShell) and run:

```
pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain
```

This installs GCC, binutils, and related build tools for the UCRT64 environment.

## 3) Add MSYS2 UCRT64 to PATH (Windows)
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

## 4) Build the project
From the project root in PowerShell:

```
cargo build
```

If everything is set correctly, the workspace should compile using the GNU toolchain.

## 5) Proceed with M3
Follow the Milestone 3 (M3) steps outlined in the project docs/plan. Typical commands:

- Run tests:
  ```
  cargo test
  ```
- Run the CLI (example):
  ```
  cargo run -p relay-cli -- --help
  ```

## Troubleshooting
- Linker not found (e.g., `link.exe` or `cc` errors): ensure `C:\msys64\ucrt64\bin` is at the front of PATH in the shell where you run `cargo`.
- Wrong Rust target: run `rustup show` and confirm `stable-x86_64-pc-windows-gnu` is the default.
- Multiple MSYS2 environments: use UCRT64 specifically (paths under `C:\msys64\ucrt64\...`).

## Notes
- This project targets the GNU toolchain on Windows for compatibility with dependencies that expect GCC/MinGW.
- If you switch back to the MSVC toolchain later, use `rustup default stable-x86_64-pc-windows-msvc` and ensure MSVC build tools are installed.

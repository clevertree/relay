#![allow(clippy::missing_safety_doc)]

// Minimal C ABI to unblock platform integration. Will expand to real APIs later.

#[no_mangle]
pub extern "C" fn relay_core_version() -> *const core::ffi::c_char {
    // Static null-terminated C string; safe to return as 'static lifetime
    static VERSION: &str = concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION"), "\0");
    VERSION.as_ptr() as *const core::ffi::c_char
}

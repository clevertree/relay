use crate::{TranspileOptions, transpile, version};

/// C-compatible string type for FFI
#[repr(C)]
pub struct CString {
    pub ptr: *const u8,
    pub len: usize,
}

impl CString {
    pub fn from_str(s: &str) -> Self {
        Self {
            ptr: s.as_ptr(),
            len: s.len(),
        }
    }

    pub unsafe fn to_string(&self) -> String {
        let slice = std::slice::from_raw_parts(self.ptr, self.len);
        String::from_utf8_lossy(slice).into_owned()
    }
}

/// Free a string allocated by Rust
#[no_mangle]
pub unsafe extern "C" fn hook_transpiler_free_string(s: *mut std::os::raw::c_char) {
    if !s.is_null() {
        drop(std::ffi::CString::from_raw(s));
    }
}

/// Transpile TypeScript/JSX code
#[no_mangle]
pub extern "C" fn hook_transpiler_transpile(
    code_ptr: *const u8,
    code_len: usize,
    filename_ptr: *const u8,
    filename_len: usize,
) -> *mut std::os::raw::c_char {
    let code = unsafe {
        let slice = std::slice::from_raw_parts(code_ptr, code_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let filename = unsafe {
        let slice = std::slice::from_raw_parts(filename_ptr, filename_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let opts = TranspileOptions {
        filename: Some(filename),
        react_dev: false,
        to_commonjs: true,
        pragma: Some("h".into()),
        pragma_frag: None,
    };

    match transpile(&code, opts) {
        Ok(output) => {
            match std::ffi::CString::new(output.code) {
                Ok(c_str) => c_str.into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// Get version string
#[no_mangle]
pub extern "C" fn hook_transpiler_version() -> *mut std::os::raw::c_char {
    match std::ffi::CString::new(version()) {
        Ok(c_str) => c_str.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

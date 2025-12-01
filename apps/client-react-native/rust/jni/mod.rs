//! JNI bindings for Android Native Module
//! This module provides JNI wrappers around the core C API for use from Kotlin/Java

#[cfg(target_os = "android")]
pub mod android {
    use jni::objects::{JClass, JString, JObject};
    use jni::sys::{jbyteArray, jstring, jlong};
    use jni::JNIEnv;
    use std::sync::Arc;

    /// Probe a peer - JNI wrapper
    #[no_mangle]
    pub unsafe extern "C" fn Java_com_relay_client_RelayCoreModule_nativeProbePeer(
        mut env: JNIEnv,
        _class: JClass,
        host: JString,
        timeout_ms: jlong,
    ) -> jstring {
        let host_cstring = match env.get_string(&host) {
            Ok(s) => match s.to_str() {
                Ok(str_val) => std::ffi::CString::new(str_val).unwrap_or_default(),
                Err(_) => return env.new_string("").unwrap_or_default().into_raw(),
            },
            Err(_) => return env.new_string("").unwrap_or_default().into_raw(),
        };

        let result_ptr = crate::relay_probe_peer(
            host_cstring.as_ptr(),
            timeout_ms as u64,
        );

        if result_ptr.is_null() {
            return env.new_string("").unwrap_or_default().into_raw();
        }

        let result_cstr = std::ffi::CStr::from_ptr(result_ptr as *const i8);
        let result_str = result_cstr.to_string_lossy().to_string();

        // Free the string from Rust
        crate::relay_free_string(result_ptr as *mut i8);

        match env.new_string(result_str) {
            Ok(jstr) => jstr.into_raw(),
            Err(_) => env.new_string("").unwrap_or_default().into_raw(),
        }
    }

    /// Fetch OPTIONS - JNI wrapper
    #[no_mangle]
    pub unsafe extern "C" fn Java_com_relay_client_RelayCoreModule_nativeFetchOptions(
        mut env: JNIEnv,
        _class: JClass,
        host: JString,
        timeout_ms: jlong,
    ) -> jstring {
        let host_cstring = match env.get_string(&host) {
            Ok(s) => match s.to_str() {
                Ok(str_val) => std::ffi::CString::new(str_val).unwrap_or_default(),
                Err(_) => return env.new_string("").unwrap_or_default().into_raw(),
            },
            Err(_) => return env.new_string("").unwrap_or_default().into_raw(),
        };

        let result_ptr = crate::relay_fetch_options(
            host_cstring.as_ptr(),
            timeout_ms as u64,
        );

        if result_ptr.is_null() {
            return env.new_string("").unwrap_or_default().into_raw();
        }

        let result_cstr = std::ffi::CStr::from_ptr(result_ptr as *const i8);
        let result_str = result_cstr.to_string_lossy().to_string();

        crate::relay_free_string(result_ptr as *mut i8);

        match env.new_string(result_str) {
            Ok(jstr) => jstr.into_raw(),
            Err(_) => env.new_string("").unwrap_or_default().into_raw(),
        }
    }

    /// Get file - JNI wrapper
    #[no_mangle]
    pub unsafe extern "C" fn Java_com_relay_client_RelayCoreModule_nativeGetFile(
        mut env: JNIEnv,
        _class: JClass,
        host: JString,
        path: JString,
        branch: JString,
        timeout_ms: jlong,
    ) -> jbyteArray {
        let host_cstring = match env.get_string(&host) {
            Ok(s) => match s.to_str() {
                Ok(str_val) => std::ffi::CString::new(str_val).unwrap_or_default(),
                Err(_) => return std::ptr::null_mut(),
            },
            Err(_) => return std::ptr::null_mut(),
        };

        let path_cstring = match env.get_string(&path) {
            Ok(s) => match s.to_str() {
                Ok(str_val) => std::ffi::CString::new(str_val).unwrap_or_default(),
                Err(_) => return std::ptr::null_mut(),
            },
            Err(_) => return std::ptr::null_mut(),
        };

        let branch_cstring = match env.get_string(&branch) {
            Ok(s) => match s.to_str() {
                Ok(str_val) => std::ffi::CString::new(str_val).unwrap_or_default(),
                Err(_) => std::ffi::CString::new("main").unwrap_or_default(),
            },
            Err(_) => std::ffi::CString::new("main").unwrap_or_default(),
        };

        let mut len = 0;
        let result_ptr = crate::relay_get_file(
            host_cstring.as_ptr(),
            path_cstring.as_ptr(),
            branch_cstring.as_ptr(),
            timeout_ms as u64,
            &mut len,
        );

        if result_ptr.is_null() || len == 0 {
            return std::ptr::null_mut();
        }

        let slice = std::slice::from_raw_parts(result_ptr, len);
        let jarray = env.new_byte_array(slice.len() as i32).unwrap_or(std::ptr::null_mut());
        
        if !jarray.is_null() {
            let _ = env.set_byte_array_region(jarray, 0, slice);
        }

        crate::relay_free_buffer(result_ptr as *mut _);

        jarray
    }
}

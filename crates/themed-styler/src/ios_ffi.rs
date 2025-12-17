use crate::{State, ThemeEntry, version};
use indexmap::IndexMap;
use serde::Deserialize;

#[derive(Deserialize, Default)]
struct UsageSnapshot {
    #[serde(default)]
    selectors: Vec<String>,
    #[serde(default)]
    classes: Vec<String>,
}

#[derive(Deserialize, Default)]
struct ThemesInput {
    #[serde(default)]
    themes: IndexMap<String, ThemeEntry>,
    #[serde(rename = "currentTheme", default)]
    current_theme: Option<String>,
}

fn build_state(usage: UsageSnapshot, themes_input: ThemesInput) -> State {
    let mut state = State::new_default();
    if !themes_input.themes.is_empty() {
        state.themes = themes_input.themes;
        if let Some(current) = themes_input.current_theme.clone() {
            if state.themes.contains_key(&current) {
                state.current_theme = current;
            }
        }
        if state.default_theme.is_empty() {
            if let Some((name, _)) = state.themes.iter().next() {
                state.default_theme = name.clone();
            }
        }
    }
    state.register_selectors(usage.selectors);
    for class in usage.classes {
        state.used_classes.insert(class);
    }
    state
}

/// Free a string allocated by Rust
#[no_mangle]
pub unsafe extern "C" fn themed_styler_free_string(s: *mut std::os::raw::c_char) {
    if !s.is_null() {
        drop(std::ffi::CString::from_raw(s));
    }
}

/// Render CSS from usage and themes JSON
#[no_mangle]
pub extern "C" fn themed_styler_render_css(
    usage_ptr: *const u8,
    usage_len: usize,
    themes_ptr: *const u8,
    themes_len: usize,
) -> *mut std::os::raw::c_char {
    let usage_json = unsafe {
        let slice = std::slice::from_raw_parts(usage_ptr, usage_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let themes_json = unsafe {
        let slice = std::slice::from_raw_parts(themes_ptr, themes_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let usage: UsageSnapshot = serde_json::from_str(&usage_json).unwrap_or_default();
    let themes: ThemesInput = serde_json::from_str(&themes_json).unwrap_or_default();
    let state = build_state(usage, themes);
    let css = state.css_for_web();

    match std::ffi::CString::new(css) {
        Ok(c_str) => c_str.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Get RN styles for selector and classes
#[no_mangle]
pub extern "C" fn themed_styler_get_rn_styles(
    selector_ptr: *const u8,
    selector_len: usize,
    classes_ptr: *const u8,
    classes_len: usize,
    themes_ptr: *const u8,
    themes_len: usize,
) -> *mut std::os::raw::c_char {
    let selector = unsafe {
        let slice = std::slice::from_raw_parts(selector_ptr, selector_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let classes_json = unsafe {
        let slice = std::slice::from_raw_parts(classes_ptr, classes_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let themes_json = unsafe {
        let slice = std::slice::from_raw_parts(themes_ptr, themes_len);
        String::from_utf8_lossy(slice).into_owned()
    };

    let classes: Vec<String> = serde_json::from_str(&classes_json).unwrap_or_default();
    let themes: ThemesInput = serde_json::from_str(&themes_json).unwrap_or_default();
    let state = build_state(UsageSnapshot::default(), themes);
    let styles = state.rn_styles_for(&selector, &classes);

    match serde_json::to_string(&styles) {
        Ok(json) => match std::ffi::CString::new(json) {
            Ok(c_str) => c_str.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Get default state as JSON
#[no_mangle]
pub extern "C" fn themed_styler_get_default_state() -> *mut std::os::raw::c_char {
    let state = State::default_state();
    match serde_json::to_string(&state.to_json()) {
        Ok(json) => match std::ffi::CString::new(json) {
            Ok(c_str) => c_str.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Get version
#[no_mangle]
pub extern "C" fn themed_styler_version() -> *mut std::os::raw::c_char {
    match std::ffi::CString::new(version()) {
        Ok(c_str) => c_str.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

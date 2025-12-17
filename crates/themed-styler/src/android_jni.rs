use crate::{State, ThemeEntry, version};
use indexmap::{IndexMap, IndexSet};
use jni::objects::{JObject, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use serde::Deserialize;
use std::collections::hash_map::Entry;

fn jstring_to_string(env: &mut JNIEnv, input: JString) -> Option<String> {
  match env.get_string(&input) {
    Ok(v) => v.to_str().ok().map(|s| s.to_string()),
    Err(_) => None,
  }
}

fn new_jstring(env: &mut JNIEnv, value: &str) -> jstring {
  match env.new_string(value) {
    Ok(jstr) => jstr.into_raw(),
    Err(_) => env.new_string("",).unwrap().into_raw(),
  }
}

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

fn parse_usage_json(json: &str) -> UsageSnapshot {
  serde_json::from_str(json).unwrap_or_default()
}

fn parse_themes_json(json: &str) -> ThemesInput {
  serde_json::from_str(json).unwrap_or_default()
}

#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_ThemedStylerModule_nativeRenderCss(
  mut env: JNIEnv,
  _this: JObject,
  usage_json: JString,
  themes_json: JString,
) -> jstring {
  let usage = jstring_to_string(&mut env, usage_json).unwrap_or_else(|| "{}".to_string());
  let themes = jstring_to_string(&mut env, themes_json).unwrap_or_else(|| "{}".to_string());
  let snapshot = parse_usage_json(&usage);
  let themes_input = parse_themes_json(&themes);
  let state = build_state(snapshot, themes_input);
  let css = state.css_for_web();
  new_jstring(&mut env, &css)
}

#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_ThemedStylerModule_nativeGetRnStyles(
  mut env: JNIEnv,
  _this: JObject,
  selector: JString,
  classes_json: JString,
  themes_json: JString,
) -> jstring {
  let selector_str = jstring_to_string(&mut env, selector).unwrap_or_else(|| String::new());
  let classes = jstring_to_string(&mut env, classes_json).unwrap_or_else(|| "[]".to_string());
  let themes = jstring_to_string(&mut env, themes_json).unwrap_or_else(|| "{}".to_string());
  let classes_vec: Vec<String> = serde_json::from_str(&classes).unwrap_or_default();
  let themes_input = parse_themes_json(&themes);
  let state = build_state(UsageSnapshot::default(), themes_input);
  let styles = state.rn_styles_for(&selector_str, &classes_vec);
  match serde_json::to_string(&styles) {
    Ok(json) => new_jstring(&mut env, &json),
    Err(_) => new_jstring(&mut env, "{}"),
  }
}

#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_ThemedStylerModule_nativeGetDefaultState(
  mut env: JNIEnv,
  _this: JObject,
) -> jstring {
  let state = State::default_state();
  match serde_json::to_string(&state.to_json()) {
    Ok(json) => new_jstring(&mut env, &json),
    Err(_) => new_jstring(&mut env, "{}"),
  }
}

#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_ThemedStylerModule_nativeGetVersion(
  mut env: JNIEnv,
  _this: JObject,
) -> jstring {
  new_jstring(&mut env, version())
}

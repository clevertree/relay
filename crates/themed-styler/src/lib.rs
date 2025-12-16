use indexmap::{IndexMap, IndexSet};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use wasm_bindgen::prelude::*;
mod default_state;
use default_state::bundled_state;

pub type CssProps = IndexMap<String, serde_json::Value>;
pub type SelectorStyles = IndexMap<String, CssProps>; // selector -> props

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThemeEntry {
    #[serde(default)]
    pub inherits: Option<String>,
    #[serde(default)]
    pub selectors: SelectorStyles,
    #[serde(default)]
    pub variables: IndexMap<String, String>,
    #[serde(default)]
    pub breakpoints: IndexMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct State {
    // New format: each theme has selectors, variables, breakpoints, and optional inherits
    pub themes: IndexMap<String, ThemeEntry>,
    pub default_theme: String,
    pub current_theme: String,
    // Legacy fields (kept for backward-compat JSON). Not used if themes[] carry variables/bps.
    #[serde(default)]
    pub theme_variables: IndexMap<String, IndexMap<String, String>>, // deprecated
    #[serde(default)]
    pub variables: IndexMap<String, String>, // deprecated global
    #[serde(default)]
    pub breakpoints: IndexMap<String, String>, // deprecated global
    #[serde(default)]
    pub used_selectors: IndexSet<String>,
    #[serde(default)]
    pub used_classes: IndexSet<String>,
}

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("theme not found: {0}")]
    ThemeNotFound(String),
}

impl State {
    pub fn new_default() -> Self {
        // Prefer embedded Rust bundled defaults
        return bundled_state();
    }

    /// Public helper to access the embedded default state.
    pub fn default_state() -> Self {
        bundled_state()
    }

    pub fn set_theme(&mut self, theme: impl Into<String>) -> Result<(), Error> {
        let name = theme.into();
        if !self.themes.contains_key(&name) {
            return Err(Error::ThemeNotFound(name));
        }
        self.current_theme = name;
        Ok(())
    }

    pub fn add_theme(&mut self, name: impl Into<String>, styles: SelectorStyles) {
        let name = name.into();
        let entry = self.themes.entry(name).or_default();
        for (sel, props) in styles.into_iter() {
            let e = entry.selectors.entry(sel).or_default();
            merge_props(e, &props);
        }
    }

    pub fn set_variables(&mut self, vars: IndexMap<String, String>) {
        // Back-compat: set on current theme entry
        let cur = self.current_theme.clone();
        let entry = self.themes.entry(cur).or_default();
        entry.variables = vars;
    }

    pub fn set_breakpoints(&mut self, map: IndexMap<String, String>) {
        let cur = self.current_theme.clone();
        let entry = self.themes.entry(cur).or_default();
        entry.breakpoints = map;
    }

    pub fn set_default_theme(&mut self, name: impl Into<String>) {
        self.default_theme = name.into();
    }

    pub fn register_selectors<I: IntoIterator<Item = String>>(&mut self, selectors: I) {
        for s in selectors {
            self.used_selectors.insert(s);
        }
    }

    pub fn register_tailwind_classes<I: IntoIterator<Item = String>>(&mut self, classes: I) {
        for c in classes {
            self.used_classes.insert(c);
        }
    }

    pub fn clear_usage(&mut self) {
        self.used_selectors.clear();
        self.used_classes.clear();
    }

    pub fn to_json(&self) -> serde_json::Value {
        json!({
            "themes": self.themes,
            "default_theme": self.default_theme,
            "current_theme": self.current_theme,
            // legacy fields are still serialized for back-compat but may be empty
            "theme_variables": self.theme_variables,
            "variables": self.variables,
            "breakpoints": self.breakpoints,
            "used_selectors": self.used_selectors,
            "used_classes": self.used_classes,
        })
    }

    pub fn from_json(value: serde_json::Value) -> anyhow::Result<Self> {
        let state: State = serde_json::from_value(value)?;
        Ok(state)
    }

    pub fn css_for_web(&self) -> String {
        // Compute CSS for used selectors + used classes resolved from the effective theme (with inheritance)
        let (eff, vars) = self.effective_theme_all();
        let mut out = String::new();
        for sel in &self.used_selectors {
            if let Some(props) = eff.get(sel) {
                out.push_str(sel);
                out.push_str("{");
                out.push_str(&css_props_string(props, &vars));
                out.push_str("}\n");
            }
        }
        for class in &self.used_classes {
            let selector = class_to_selector(class);
            if let Some(props) = eff.get(&selector) {
                out.push_str(&selector);
                out.push_str("{");
                out.push_str(&css_props_string(props, &vars));
                out.push_str("}\n");
                continue;
            }
            if let Some(dynamic_props) = dynamic_css_properties_for_class(class, &vars) {
                out.push_str(&selector);
                out.push_str("{");
                out.push_str(&css_props_string(&dynamic_props, &vars));
                out.push_str("}\n");
                continue;
            }
            if let Some(props) = eff.get(class) {
                out.push_str(class);
                out.push_str("{");
                out.push_str(&css_props_string(props, &vars));
                out.push_str("}\n");
            }
        }
        out
    }

    pub fn rn_styles_for(&self, selector: &str, classes: &[String]) -> IndexMap<String, serde_json::Value> {
        let (eff, vars) = self.effective_theme_all();
        let mut out: IndexMap<String, serde_json::Value> = IndexMap::new();
        if let Some(props) = eff.get(selector) {
            merge_rn_props(&mut out, props, &vars);
        }
        for class in classes {
            let sel = class_to_selector(class);
            if let Some(props) = eff.get(&sel) {
                merge_rn_props(&mut out, props, &vars);
                continue;
            }
            if let Some(dynamic_props) = dynamic_css_properties_for_class(class, &vars) {
                merge_rn_props(&mut out, &dynamic_props, &vars);
                continue;
            }
            if let Some(props) = eff.get(class) {
                merge_rn_props(&mut out, props, &vars);
            }
        }
        out
    }

    // Previously supported loading YAML at runtime; now defaults are embedded.

    // Build the inheritance chain from current theme upward via `inherits` and default fallback
    fn theme_chain(&self) -> Vec<String> {
        let mut chain = Vec::new();
        // Resolve base names
        let default_name = if self.themes.contains_key(&self.default_theme) {
            self.default_theme.clone()
        } else if let Some((k, _)) = self.themes.first() { k.clone() } else { return chain };
        let mut current_name = if self.themes.contains_key(&self.current_theme) {
            self.current_theme.clone()
        } else { default_name.clone() };
        // push child first
        let mut seen: IndexSet<String> = IndexSet::new();
        while !seen.contains(&current_name) {
            seen.insert(current_name.clone());
            chain.push(current_name.clone());
            // next parent via inherits, else stop
            let inherits = self.themes.get(&current_name).and_then(|t| t.inherits.clone());
            if let Some(p) = inherits {
                current_name = p;
            } else {
                break;
            }
        }
        if !chain.iter().any(|n| n == &default_name) {
            chain.push(default_name);
        }
        chain
    }

    // Compute effective selectors + variables + breakpoints with inheritance. Parent overrides child.
    fn effective_theme_all(&self) -> (SelectorStyles, IndexMap<String, String>) {
        let mut selectors: SelectorStyles = SelectorStyles::new();
        let mut vars: IndexMap<String, String> = IndexMap::new();
        // Start with deprecated globals as the lowest base
        for (k, v) in self.variables.iter() { vars.insert(k.clone(), v.clone()); }
        // Merge child first then parents, with later merges overriding
        let chain = self.theme_chain();
        for name in chain.into_iter() {
            if let Some(entry) = self.themes.get(&name) {
                // merge selectors: later (parent) overrides child
                for (sel, props) in entry.selectors.iter() {
                    let e = selectors.entry(sel.clone()).or_default();
                    merge_props(e, props);
                }
                // merge variables
                for (k, v) in entry.variables.iter() {
                    vars.insert(k.clone(), v.clone());
                }
            }
        }
        (selectors, vars)
    }

    // Effective breakpoints with inheritance; parent overrides child.
    pub fn effective_breakpoints(&self) -> IndexMap<String, String> {
        let mut bps: IndexMap<String, String> = IndexMap::new();
        // Start with deprecated globals
        for (k, v) in self.breakpoints.iter() { bps.insert(k.clone(), v.clone()); }
        let chain = self.theme_chain();
        for name in chain.into_iter() {
            if let Some(entry) = self.themes.get(&name) {
                for (k, v) in entry.breakpoints.iter() {
                    bps.insert(k.clone(), v.clone());
                }
            }
        }
        bps
    }
}

// wasm-bindgen exports
#[wasm_bindgen]
pub fn render_css_for_web(state_json: &str) -> String {
    match serde_json::from_str::<State>(state_json) {
        Ok(s) => s.css_for_web(),
        Err(_) => "".into(),
    }
}

#[wasm_bindgen]
pub fn get_rn_styles(state_json: &str, selector: &str, classes_json: &str) -> String {
    let classes: Vec<String> = serde_json::from_str(classes_json).unwrap_or_default();
    match serde_json::from_str::<State>(state_json) {
        Ok(s) => serde_json::to_string(&s.rn_styles_for(selector, &classes)).unwrap_or_else(|_| "{}".into()),
        Err(_) => "{}".into(),
    }
}

// Expose crate version to JS via wasm-bindgen
#[wasm_bindgen]
pub fn get_version() -> String {
    // CARGO_PKG_VERSION is provided at compile time
    env!("CARGO_PKG_VERSION").to_string()
}

/// Return the embedded default state as a JSON string.
#[wasm_bindgen]
pub fn get_default_state_json() -> String {
    let st = bundled_state();
    match serde_json::to_string(&st.to_json()) {
        Ok(s) => s,
        Err(_) => "{}".to_string(),
    }
}

fn merge_props(into: &mut CssProps, from: &CssProps) {
    for (k, v) in from.iter() {
        into.insert(k.clone(), v.clone());
    }
}

// merge_indexmap removed — unused

fn css_props_string(props: &CssProps, vars: &IndexMap<String, String>) -> String {
    let mut buf = String::new();
    for (k, v) in props.iter() {
        buf.push_str(k);
        buf.push(':');
        let val = if v.is_string() {
            let s = v.as_str().unwrap();
            resolve_vars(s, vars)
        } else {
            v.to_string()
        };
        buf.push_str(&val);
        if !val.ends_with(';') {
            buf.push(';');
        }
    }
    buf
}

// Support var(--name) and var(name)
static RE_VAR: Lazy<Regex> = Lazy::new(|| Regex::new(r"var\(\s*-{0,2}([a-zA-Z0-9_-]+)\s*\)").unwrap());

fn resolve_vars(input: &str, vars: &IndexMap<String, String>) -> String {
    let mut out = input.to_string();
    for cap in RE_VAR.captures_iter(input) {
        if let Some(name) = cap.get(1) {
            let key = name.as_str();
            if let Some(val) = vars.get(key) {
                // replace both var(--name) and var(name)
                out = out.replace(&format!("var(--{})", key), val);
                out = out.replace(&format!("var({})", key), val);
            }
        }
    }
    if out.starts_with('$') {
        if let Some(val) = vars.get(&out[1..]) {
            return val.clone();
        }
    }
    out
}

fn camel_case(name: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for ch in name.chars() {
        if ch == '-' {
            upper = true;
            continue;
        }
        if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}

fn css_value_to_rn(
    value: &serde_json::Value,
    vars: &IndexMap<String, String>,
) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            let s2 = resolve_vars(s, vars);
            if let Some(n) = s2.strip_suffix("px") {
                if let Ok(parsed) = n.trim().parse::<f64>() {
                    return json!(parsed);
                }
            }
            json!(s2)
        }
        _ => value.clone(),
    }
}

fn merge_rn_props(
    into: &mut IndexMap<String, serde_json::Value>,
    css_props: &CssProps,
    vars: &IndexMap<String, String>,
) {
    for (k, v) in css_props.iter() {
        let rn_key = match k.as_str() {
            // Minimal explicit mappings
            "background-color" => "backgroundColor".to_string(),
            "text-align" => "textAlign".to_string(),
            _ => camel_case(k),
        };
        let rn_val = css_value_to_rn(v, vars);
        into.insert(rn_key, rn_val);
    }
}

fn dynamic_css_properties_for_class(class: &str, vars: &IndexMap<String, String>) -> Option<CssProps> {
    if let Some(value) = class.strip_prefix("p-") {
        return parse_tailwind_spacing(value, &|px| padding_props(&["padding"], px));
    }
    if let Some(value) = class.strip_prefix("px-") {
        return parse_tailwind_spacing(value, &|px| padding_props(&["padding-left", "padding-right"], px));
    }
    if let Some(value) = class.strip_prefix("py-") {
        return parse_tailwind_spacing(value, &|px| padding_props(&["padding-top", "padding-bottom"], px));
    }
    for &(prefix, prop) in &[("pt-", "padding-top"), ("pr-", "padding-right"), ("pb-", "padding-bottom"), ("pl-", "padding-left")] {
        if let Some(value) = class.strip_prefix(prefix) {
            return parse_tailwind_spacing(value, &|px| padding_props(&[prop], px));
        }
    }
    if class == "border" {
        return Some(border_props(None, 1, vars));
    }
    if let Some(rest) = class.strip_prefix("border-") {
        let parts: Vec<&str> = rest.split('-').collect();
        if parts.is_empty() {
            return None;
        }
        let width_part = parts.last().unwrap();
        if let Ok(width) = width_part.parse::<i32>() {
            let side = if parts.len() == 2 { Some(parts[0]) } else { None };
            return Some(border_props(side, width, vars));
        }
    }
    None
}

fn parse_tailwind_spacing<F>(value: &str, builder: &F) -> Option<CssProps>
where
    F: Fn(i32) -> CssProps,
{
    if let Ok(n) = value.parse::<i32>() {
        let px = n * 4;
        return Some(builder(px));
    }
    None
}

fn padding_props(keys: &[&str], px_value: i32) -> CssProps {
    let mut props = CssProps::new();
    let val = format!("{}px", px_value);
    for key in keys {
        props.insert((*key).into(), json!(&val));
    }
    props
}

fn border_props(side: Option<&str>, width: i32, _vars: &IndexMap<String, String>) -> CssProps {
    let mut props = CssProps::new();
    let width_str = format!("{}px", width);
    match side {
        None => {
            props.insert("border-width".into(), json!(&width_str));
        }
        Some("t") => {
            props.insert("border-top-width".into(), json!(&width_str));
        }
        Some("b") => {
            props.insert("border-bottom-width".into(), json!(&width_str));
        }
        Some("l") => {
            props.insert("border-left-width".into(), json!(&width_str));
        }
        Some("r") => {
            props.insert("border-right-width".into(), json!(&width_str));
        }
        Some("x") => {
            props.insert("border-left-width".into(), json!(&width_str));
            props.insert("border-right-width".into(), json!(&width_str));
        }
        Some("y") => {
            props.insert("border-top-width".into(), json!(&width_str));
            props.insert("border-bottom-width".into(), json!(&width_str));
        }
        _ => {
            props.insert("border-width".into(), json!(&width_str));
        }
    };
    props.insert("border-color".into(), json!("var(border)"));
    props.insert("border-style".into(), json!("solid"));
    props
}

// ---------------- Tailwind subset ----------------

// static RE_NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?P<prefix>(hover:)?(xs:|sm:|md:|lg:|xl:)*)?(?P<base>.+)$").unwrap());

fn css_escape_class(class: &str) -> String { class.replace(':', "\\:") }

fn class_to_selector(class: &str) -> String {
    if let Some(rest) = class.strip_prefix("hover:") {
        format!(".{}:hover", css_escape_class(rest))
    } else {
        format!(".{}", css_escape_class(class))
    }
}

// ------------- helpers for CSS output of media selectors -------------

/// Flatten CSS with potential selectors that include media prelude.
/// This simple post-processor merges entries that use the special selector format
/// "@media (min-width: X) {<sel>" where we will close the block at the end.
/// We group by media and inside concatenate selectors.
pub fn post_process_css(
    raw_rules: &[(String, CssProps)],
    vars: &IndexMap<String, String>,
) -> String {
    // Group into normal rules and media rules
    let mut normal = vec![];
    let mut media_map: IndexMap<String, Vec<(String, CssProps)>> = IndexMap::new();
    for (sel, props) in raw_rules.iter() {
        if let Some((media, inner)) = sel.split_once('{') {
            if media.trim_start().starts_with("@media ") && inner.ends_with('}') {
                let inner_sel = inner.trim_end_matches('}').to_string();
                media_map
                    .entry(media.trim().to_string())
                    .or_default()
                    .push((inner_sel, props.clone()));
                continue;
            }
        }
        normal.push((sel.clone(), props.clone()));
    }
    let mut out = String::new();
    for (sel, props) in normal {
        out.push_str(&sel);
        out.push('{');
        out.push_str(&css_props_string(&props, vars));
        out.push_str("}\n");
    }
    for (media, entries) in media_map {
        out.push_str(&media);
        out.push('{');
        for (sel, props) in entries {
            out.push_str(&sel);
            out.push('{');
            out.push_str(&css_props_string(&props, vars));
            out.push_str("}");
        }
        out.push_str("}\n");
    }
    out
}

// re-export minimal API for CLI
pub mod api {
    pub use super::{SelectorStyles, State};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_has_p2() {
        let mut st = State::new_default();
        st.register_tailwind_classes(["p-2".to_string()]);
        let css = st.css_for_web();
        assert!(css.contains(".p-2{"));
        assert!(css.contains("padding:8px"));
    }

    #[test]
    fn rn_conversion() {
        let st = State::new_default();
        let out = st.rn_styles_for("button", &[]);
        assert!(out.get("backgroundColor").is_some());
    }

    #[test]
    fn embedded_defaults_and_version() {
        // default_state should contain the default theme and some variables
        let st = State::default_state();
        assert!(st.themes.contains_key("default"));
        let def = st.themes.get("default").unwrap();
        assert!(def.variables.contains_key("primary"));

        // Version should compile and be non-empty (env! evaluated at compile-time)
        let v = get_version();
        assert!(!v.trim().is_empty());
    }
}

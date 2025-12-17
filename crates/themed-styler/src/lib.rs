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
        let bps = self.effective_breakpoints();
        let mut rules: Vec<(String, CssProps)> = Vec::new();

        for sel in &self.used_selectors {
            if let Some(props) = eff.get(sel) {
                rules.push((sel.clone(), props.clone()));
            }
        }

        for class in &self.used_classes {
            let (bp_key, hover, base) = parse_prefixed_class(class);
            let selector = if hover { format!(".{}:hover", css_escape_class(&base)) } else { format!(".{}", css_escape_class(&base)) };

            // 1) Exact selector in effective theme (e.g. ".x:hover")
            if let Some(props) = eff.get(&selector) {
                let final_sel = wrap_with_media(&selector, bp_key.as_deref(), &bps);
                rules.push((final_sel, props.clone()));
                continue;
            }
            // 2) Dynamic generation for the base class (ignoring hover/breakpoint for props)
            if let Some(dynamic_props) = dynamic_css_properties_for_class(&base, &vars) {
                let sel = if hover { format!(".{}:hover", css_escape_class(&base)) } else { format!(".{}", css_escape_class(&base)) };
                let final_sel = wrap_with_media(&sel, bp_key.as_deref(), &bps);
                rules.push((final_sel, dynamic_props));
                continue;
            }
            // 3) Fallback: class key itself in theme (rare)
            if let Some(props) = eff.get(&base) {
                let final_sel = wrap_with_media(&selector, bp_key.as_deref(), &bps);
                rules.push((final_sel, props.clone()));
            }
        }

        post_process_css(&rules, &vars)
    }

    pub fn rn_styles_for(&self, selector: &str, classes: &[String]) -> IndexMap<String, serde_json::Value> {
        let (eff, vars) = self.effective_theme_all();
        let mut out: IndexMap<String, serde_json::Value> = IndexMap::new();
        if let Some(props) = eff.get(selector) {
            merge_rn_props(&mut out, props, &vars);
        }
        for class in classes {
            let (_bp, _hover, base) = parse_prefixed_class(class);
            // Prefer base selector match from theme
            let sel = class_to_selector(&base);
            if let Some(props) = eff.get(&sel) {
                merge_rn_props(&mut out, props, &vars);
                continue;
            }
            // Dynamic mapping for base class
            if let Some(dynamic_props) = dynamic_css_properties_for_class(&base, &vars) {
                merge_rn_props(&mut out, &dynamic_props, &vars);
                continue;
            }
            if let Some(props) = eff.get(&base) {
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

// Plain Rust accessor for crate version used by Android JNI glue
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
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

// Tailwind color palette - embedded from tailwind-colors.html
static TAILWIND_COLORS: Lazy<IndexMap<&'static str, IndexMap<&'static str, &'static str>>> = Lazy::new(|| {
    let mut colors = IndexMap::new();
    
    let mut slate = IndexMap::new();
    slate.insert("50", "#f8fafc"); slate.insert("100", "#f1f5f9"); slate.insert("200", "#e2e8f0");
    slate.insert("300", "#cbd5e1"); slate.insert("400", "#94a3b8"); slate.insert("500", "#64748b");
    slate.insert("600", "#475569"); slate.insert("700", "#334155"); slate.insert("800", "#1e293b");
    slate.insert("900", "#0f172a"); slate.insert("950", "#020617");
    colors.insert("slate", slate);
    
    let mut gray = IndexMap::new();
    gray.insert("50", "#f9fafb"); gray.insert("100", "#f3f4f6"); gray.insert("200", "#e5e7eb");
    gray.insert("300", "#d1d5db"); gray.insert("400", "#9ca3af"); gray.insert("500", "#6b7280");
    gray.insert("600", "#4b5563"); gray.insert("700", "#374151"); gray.insert("800", "#1f2937");
    gray.insert("900", "#111827"); gray.insert("950", "#030712");
    colors.insert("gray", gray);
    
    let mut zinc = IndexMap::new();
    zinc.insert("50", "#fafafa"); zinc.insert("100", "#f4f4f5"); zinc.insert("200", "#e4e4e7");
    zinc.insert("300", "#d4d4d8"); zinc.insert("400", "#a1a1aa"); zinc.insert("500", "#71717a");
    zinc.insert("600", "#52525b"); zinc.insert("700", "#3f3f46"); zinc.insert("800", "#27272a");
    zinc.insert("900", "#18181b"); zinc.insert("950", "#09090b");
    colors.insert("zinc", zinc);
    
    let mut neutral = IndexMap::new();
    neutral.insert("50", "#fafafa"); neutral.insert("100", "#f5f5f5"); neutral.insert("200", "#e5e5e5");
    neutral.insert("300", "#d4d4d4"); neutral.insert("400", "#a3a3a3"); neutral.insert("500", "#737373");
    neutral.insert("600", "#525252"); neutral.insert("700", "#404040"); neutral.insert("800", "#262626");
    neutral.insert("900", "#171717"); neutral.insert("950", "#0a0a0a");
    colors.insert("neutral", neutral);
    
    let mut stone = IndexMap::new();
    stone.insert("50", "#fafaf9"); stone.insert("100", "#f5f5f4"); stone.insert("200", "#e7e5e4");
    stone.insert("300", "#d6d3d1"); stone.insert("400", "#a8a29e"); stone.insert("500", "#78716c");
    stone.insert("600", "#57534e"); stone.insert("700", "#44403c"); stone.insert("800", "#292524");
    stone.insert("900", "#1c1917"); stone.insert("950", "#0c0a09");
    colors.insert("stone", stone);
    
    let mut red = IndexMap::new();
    red.insert("50", "#fef2f2"); red.insert("100", "#fee2e2"); red.insert("200", "#fecaca");
    red.insert("300", "#fca5a5"); red.insert("400", "#f87171"); red.insert("500", "#ef4444");
    red.insert("600", "#dc2626"); red.insert("700", "#b91c1c"); red.insert("800", "#991b1b");
    red.insert("900", "#7f1d1d"); red.insert("950", "#450a0a");
    colors.insert("red", red);
    
    let mut orange = IndexMap::new();
    orange.insert("50", "#fff7ed"); orange.insert("100", "#ffedd5"); orange.insert("200", "#fed7aa");
    orange.insert("300", "#fdba74"); orange.insert("400", "#fb923c"); orange.insert("500", "#f97316");
    orange.insert("600", "#ea580c"); orange.insert("700", "#c2410c"); orange.insert("800", "#9a3412");
    orange.insert("900", "#7c2d12"); orange.insert("950", "#431407");
    colors.insert("orange", orange);
    
    let mut amber = IndexMap::new();
    amber.insert("50", "#fffbeb"); amber.insert("100", "#fef3c7"); amber.insert("200", "#fde68a");
    amber.insert("300", "#fcd34d"); amber.insert("400", "#fbbf24"); amber.insert("500", "#f59e0b");
    amber.insert("600", "#d97706"); amber.insert("700", "#b45309"); amber.insert("800", "#92400e");
    amber.insert("900", "#78350f"); amber.insert("950", "#451a03");
    colors.insert("amber", amber);
    
    let mut yellow = IndexMap::new();
    yellow.insert("50", "#fefce8"); yellow.insert("100", "#fef9c3"); yellow.insert("200", "#fef08a");
    yellow.insert("300", "#fde047"); yellow.insert("400", "#facc15"); yellow.insert("500", "#eab308");
    yellow.insert("600", "#ca8a04"); yellow.insert("700", "#a16207"); yellow.insert("800", "#854d0e");
    yellow.insert("900", "#713f12"); yellow.insert("950", "#422006");
    colors.insert("yellow", yellow);
    
    let mut lime = IndexMap::new();
    lime.insert("50", "#f7fee7"); lime.insert("100", "#ecfccb"); lime.insert("200", "#d9f99d");
    lime.insert("300", "#bef264"); lime.insert("400", "#a3e635"); lime.insert("500", "#84cc16");
    lime.insert("600", "#65a30d"); lime.insert("700", "#4d7c0f"); lime.insert("800", "#3f6212");
    lime.insert("900", "#365314"); lime.insert("950", "#1a2e05");
    colors.insert("lime", lime);
    
    let mut green = IndexMap::new();
    green.insert("50", "#f0fdf4"); green.insert("100", "#dcfce7"); green.insert("200", "#bbf7d0");
    green.insert("300", "#86efac"); green.insert("400", "#4ade80"); green.insert("500", "#22c55e");
    green.insert("600", "#16a34a"); green.insert("700", "#15803d"); green.insert("800", "#166534");
    green.insert("900", "#14532d"); green.insert("950", "#052e16");
    colors.insert("green", green);
    
    let mut emerald = IndexMap::new();
    emerald.insert("50", "#ecfdf5"); emerald.insert("100", "#d1fae5"); emerald.insert("200", "#a7f3d0");
    emerald.insert("300", "#6ee7b7"); emerald.insert("400", "#34d399"); emerald.insert("500", "#10b981");
    emerald.insert("600", "#059669"); emerald.insert("700", "#047857"); emerald.insert("800", "#065f46");
    emerald.insert("900", "#064e3b"); emerald.insert("950", "#022c22");
    colors.insert("emerald", emerald);
    
    let mut teal = IndexMap::new();
    teal.insert("50", "#f0fdfa"); teal.insert("100", "#ccfbf1"); teal.insert("200", "#99f6e4");
    teal.insert("300", "#5eead4"); teal.insert("400", "#2dd4bf"); teal.insert("500", "#14b8a6");
    teal.insert("600", "#0d9488"); teal.insert("700", "#0f766e"); teal.insert("800", "#115e59");
    teal.insert("900", "#134e4a"); teal.insert("950", "#042f2e");
    colors.insert("teal", teal);
    
    let mut cyan = IndexMap::new();
    cyan.insert("50", "#ecfeff"); cyan.insert("100", "#cffafe"); cyan.insert("200", "#a5f3fc");
    cyan.insert("300", "#67e8f9"); cyan.insert("400", "#22d3ee"); cyan.insert("500", "#06b6d4");
    cyan.insert("600", "#0891b2"); cyan.insert("700", "#0e7490"); cyan.insert("800", "#155e75");
    cyan.insert("900", "#164e63"); cyan.insert("950", "#083344");
    colors.insert("cyan", cyan);
    
    let mut sky = IndexMap::new();
    sky.insert("50", "#f0f9ff"); sky.insert("100", "#e0f2fe"); sky.insert("200", "#bae6fd");
    sky.insert("300", "#7dd3fc"); sky.insert("400", "#38bdf8"); sky.insert("500", "#0ea5e9");
    sky.insert("600", "#0284c7"); sky.insert("700", "#0369a1"); sky.insert("800", "#075985");
    sky.insert("900", "#0c4a6e"); sky.insert("950", "#082f49");
    colors.insert("sky", sky);
    
    let mut blue = IndexMap::new();
    blue.insert("50", "#eff6ff"); blue.insert("100", "#dbeafe"); blue.insert("200", "#bfdbfe");
    blue.insert("300", "#93c5fd"); blue.insert("400", "#60a5fa"); blue.insert("500", "#3b82f6");
    blue.insert("600", "#2563eb"); blue.insert("700", "#1d4ed8"); blue.insert("800", "#1e40af");
    blue.insert("900", "#1e3a8a"); blue.insert("950", "#172554");
    colors.insert("blue", blue);
    
    let mut indigo = IndexMap::new();
    indigo.insert("50", "#eef2ff"); indigo.insert("100", "#e0e7ff"); indigo.insert("200", "#c7d2fe");
    indigo.insert("300", "#a5b4fc"); indigo.insert("400", "#818cf8"); indigo.insert("500", "#6366f1");
    indigo.insert("600", "#4f46e5"); indigo.insert("700", "#4338ca"); indigo.insert("800", "#3730a3");
    indigo.insert("900", "#312e81"); indigo.insert("950", "#1e1b4b");
    colors.insert("indigo", indigo);
    
    let mut violet = IndexMap::new();
    violet.insert("50", "#f5f3ff"); violet.insert("100", "#ede9fe"); violet.insert("200", "#ddd6fe");
    violet.insert("300", "#c4b5fd"); violet.insert("400", "#a78bfa"); violet.insert("500", "#8b5cf6");
    violet.insert("600", "#7c3aed"); violet.insert("700", "#6d28d9"); violet.insert("800", "#5b21b6");
    violet.insert("900", "#4c1d95"); violet.insert("950", "#2e1065");
    colors.insert("violet", violet);
    
    let mut purple = IndexMap::new();
    purple.insert("50", "#faf5ff"); purple.insert("100", "#f3e8ff"); purple.insert("200", "#e9d5ff");
    purple.insert("300", "#d8b4fe"); purple.insert("400", "#c084fc"); purple.insert("500", "#a855f7");
    purple.insert("600", "#9333ea"); purple.insert("700", "#7e22ce"); purple.insert("800", "#6b21a8");
    purple.insert("900", "#581c87"); purple.insert("950", "#3b0764");
    colors.insert("purple", purple);
    
    let mut fuchsia = IndexMap::new();
    fuchsia.insert("50", "#fdf4ff"); fuchsia.insert("100", "#fae8ff"); fuchsia.insert("200", "#f5d0fe");
    fuchsia.insert("300", "#f0abfc"); fuchsia.insert("400", "#e879f9"); fuchsia.insert("500", "#d946ef");
    fuchsia.insert("600", "#c026d3"); fuchsia.insert("700", "#a21caf"); fuchsia.insert("800", "#86198f");
    fuchsia.insert("900", "#701a75"); fuchsia.insert("950", "#4a044e");
    colors.insert("fuchsia", fuchsia);
    
    let mut pink = IndexMap::new();
    pink.insert("50", "#fdf2f8"); pink.insert("100", "#fce7f3"); pink.insert("200", "#fbcfe8");
    pink.insert("300", "#f9a8d4"); pink.insert("400", "#f472b6"); pink.insert("500", "#ec4899");
    pink.insert("600", "#db2777"); pink.insert("700", "#be185d"); pink.insert("800", "#9d174d");
    pink.insert("900", "#831843"); pink.insert("950", "#500724");
    colors.insert("pink", pink);
    
    let mut rose = IndexMap::new();
    rose.insert("50", "#fff1f2"); rose.insert("100", "#ffe4e6"); rose.insert("200", "#fecdd3");
    rose.insert("300", "#fda4af"); rose.insert("400", "#fb7185"); rose.insert("500", "#f43f5e");
    rose.insert("600", "#e11d48"); rose.insert("700", "#be123c"); rose.insert("800", "#9f1239");
    rose.insert("900", "#881337"); rose.insert("950", "#4c0519");
    colors.insert("rose", rose);
    
    colors
});

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
    // Display utilities
    match class {
        "block" => { let mut p = CssProps::new(); p.insert("display".into(), json!("block")); return Some(p); }
        "inline-block" => { let mut p = CssProps::new(); p.insert("display".into(), json!("inline-block")); return Some(p); }
        "inline" => { let mut p = CssProps::new(); p.insert("display".into(), json!("inline")); return Some(p); }
        "inline-flex" => { let mut p = CssProps::new(); p.insert("display".into(), json!("inline-flex")); return Some(p); }
        "grid" => { let mut p = CssProps::new(); p.insert("display".into(), json!("grid")); return Some(p); }
        "hidden" => { let mut p = CssProps::new(); p.insert("display".into(), json!("none")); return Some(p); }
        _ => {}
    }
    // Flexbox shorthands
    match class {
        "flex" => { let mut p = CssProps::new(); p.insert("display".into(), json!("flex")); return Some(p); }
        "flex-row" => { let mut p = CssProps::new(); p.insert("display".into(), json!("flex")); p.insert("flex-direction".into(), json!("row")); return Some(p); }
        "flex-col" => { let mut p = CssProps::new(); p.insert("display".into(), json!("flex")); p.insert("flex-direction".into(), json!("column")); return Some(p); }
        "flex-1" => { let mut p = CssProps::new(); p.insert("flex".into(), json!(1)); return Some(p); }
        _ => {}
    }
    if let Some(rest) = class.strip_prefix("items-") {
        let mut p = CssProps::new();
        let v = match rest { "start" => "flex-start", "end" => "flex-end", "center" => "center", "stretch" => "stretch", other => other };
        p.insert("align-items".into(), json!(v));
        return Some(p);
    }
    if let Some(rest) = class.strip_prefix("justify-") {
        let mut p = CssProps::new();
        let v = match rest { "start" => "flex-start", "end" => "flex-end", "center" => "center", "between" => "space-between", "around" => "space-around", "evenly" => "space-evenly", other => other };
        p.insert("justify-content".into(), json!(v));
        return Some(p);
    }
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
    // Parse arbitrary values like bg-[var(--primary)], text-[#ff0000], etc.
    if let Some(arb_value) = parse_arbitrary_value(class) {
        return Some(arb_value);
    }
    // text-{color}-{shade}
    if let Some(rest) = class.strip_prefix("text-") {
        if let Some(hex) = get_tailwind_color(rest) {
            let mut props = CssProps::new();
            props.insert("color".into(), json!(hex));
            return Some(props);
        }
    }
    // bg-{color}-{shade}
    if let Some(rest) = class.strip_prefix("bg-") {
        if let Some(hex) = get_tailwind_color(rest) {
            let mut props = CssProps::new();
            props.insert("background-color".into(), json!(hex));
            return Some(props);
        }
    }
    // divide-{color}-{shade} (sets border-color for child dividers)
    if let Some(rest) = class.strip_prefix("divide-") {
        if let Some(hex) = get_tailwind_color(rest) {
            let mut props = CssProps::new();
            props.insert("border-color".into(), json!(hex));
            return Some(props);
        }
    }
    if class == "border" {
        return Some(border_props(None, 1, vars));
    }
    if let Some(rest) = class.strip_prefix("border-") {
        // Check if it's a color first (e.g., border-slate-200)
        if let Some(hex) = get_tailwind_color(rest) {
            let mut props = CssProps::new();
            props.insert("border-color".into(), json!(hex));
            return Some(props);
        }
        // Otherwise, check for width/side (e.g., border-2, border-t-4)
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
    // rounded* (border-radius)
    if class == "rounded" { return Some(rounded_props(None, Some("md"))); }
    if let Some(sz) = class.strip_prefix("rounded-") {
        return Some(rounded_props(None, Some(sz)));
    }
    for &(pref, side) in &[("rounded-t", "t"), ("rounded-b", "b"), ("rounded-l", "l"), ("rounded-r", "r")] {
        if class == pref { return Some(rounded_props(Some(side), Some("md"))); }
        if let Some(sz) = class.strip_prefix(&(pref.to_string() + "-")) {
            return Some(rounded_props(Some(side), Some(sz)));
        }
    }
    // cursor-*
    if let Some(cur) = class.strip_prefix("cursor-") {
        let mut props = CssProps::new();
        props.insert("cursor".into(), json!(match cur {
            "pointer" => "pointer",
            "default" => "default",
            "text" => "text",
            "move" => "move",
            "wait" => "wait",
            "not-allowed" => "not-allowed",
            other => other,
        }));
        return Some(props);
    }
    // transition*
    if class == "transition" || class == "transition-all" {
        let mut props = CssProps::new();
        props.insert("transition-property".into(), json!("all"));
        props.insert("transition-duration".into(), json!("150ms"));
        props.insert("transition-timing-function".into(), json!("ease-in-out"));
        return Some(props);
    }
    if class == "transition-none" {
        let mut props = CssProps::new();
        props.insert("transition-property".into(), json!("none"));
        props.insert("transition-duration".into(), json!("0ms"));
        return Some(props);
    }
    if let Some(rest) = class.strip_prefix("transition-") {
        // e.g., transition-colors → limit property; keep default duration/ease
        let mut props = CssProps::new();
        let property = match rest {
            "colors" => "color, background-color, border-color, fill, stroke",
            "opacity" => "opacity",
            "transform" => "transform",
            "shadow" => "box-shadow",
            other => other,
        };
        props.insert("transition-property".into(), json!(property));
        props.insert("transition-duration".into(), json!("150ms"));
        props.insert("transition-timing-function".into(), json!("ease-in-out"));
        return Some(props);
    }
    // width utilities: w-*, w-full, w-screen, w-min, w-max (treat min/max as auto), w-px
    if let Some(val) = class.strip_prefix("w-") {
        return width_like_props("width", val);
    }
    if let Some(val) = class.strip_prefix("min-w-") {
        return width_like_props("min-width", val);
    }
    if let Some(val) = class.strip_prefix("max-w-") {
        return width_like_props("max-width", val);
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

fn rounded_props(side: Option<&str>, size: Option<&str>) -> CssProps {
    let mut props = CssProps::new();
    let px = match size.unwrap_or("md") {
        "none" => 0,
        "sm" => 2,
        "md" => 4,
        "lg" => 8,
        "xl" => 12,
        "2xl" => 16,
        "3xl" => 24,
        "full" => 9999,
        s => s.parse::<i32>().unwrap_or(4),
    };
    let v = json!(format!("{}px", px));
    match side {
        None => { props.insert("border-radius".into(), v); }
        Some("t") => {
            props.insert("border-top-left-radius".into(), v.clone());
            props.insert("border-top-right-radius".into(), v);
        }
        Some("b") => {
            props.insert("border-bottom-left-radius".into(), v.clone());
            props.insert("border-bottom-right-radius".into(), v);
        }
        Some("l") => { props.insert("border-top-left-radius".into(), v.clone()); props.insert("border-bottom-left-radius".into(), v); }
        Some("r") => { props.insert("border-top-right-radius".into(), v.clone()); props.insert("border-bottom-right-radius".into(), v); }
        _ => { props.insert("border-radius".into(), v); }
    }
    props
}

fn width_like_props(prop: &str, token: &str) -> Option<CssProps> {
    let mut props = CssProps::new();
    let value = match token {
        "full" => Some("100%".to_string()),
        "screen" => Some(if prop == "width" { "100vw" } else { "100%" }.to_string()),
        "min" => Some("min-content".to_string()),
        "max" => Some("max-content".to_string()),
        "fit" => Some("fit-content".to_string()),
        "auto" => Some("auto".to_string()),
        "px" => Some("1px".to_string()),
        other => {
            // numeric scale n => n*4px, fraction e.g., 1/2 => 50%
            if let Some((a, b)) = other.split_once('/') {
                if let (Ok(na), Ok(nb)) = (a.parse::<f64>(), b.parse::<f64>()) {
                    let pct = (na / nb) * 100.0;
                    Some(format!("{}%", trim_trailing_zeros(pct)))
                } else { None }
            } else if let Ok(n) = other.parse::<i32>() {
                Some(format!("{}px", n * 4))
            } else {
                None
            }
        }
    }?;
    props.insert(prop.into(), json!(value));
    Some(props)
}

fn trim_trailing_zeros(num: f64) -> String {
    let mut s = format!("{:.6}", num);
    while s.contains('.') && s.ends_with('0') { s.pop(); }
    if s.ends_with('.') { s.pop(); }
    s
}

// ---------------- Tailwind subset ----------------

// static RE_NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?P<prefix>(hover:)?(xs:|sm:|md:|lg:|xl:)*)?(?P<base>.+)$").unwrap());

fn css_escape_class(class: &str) -> String { class.replace(':', "\\:") }

fn class_to_selector(class: &str) -> String {
    let (_bp, hover, base) = parse_prefixed_class(class);
    if hover {
        format!(".{}:hover", css_escape_class(&base))
    } else {
        format!(".{}", css_escape_class(&base))
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

// -------- Prefix parsing (hover:, breakpoint:) --------

fn parse_prefixed_class(class: &str) -> (Option<String>, bool, String) {
    // Split by ':' to find prefixes like md:hover:block
    let parts: Vec<&str> = class.split(':').collect();
    if parts.len() == 1 {
        return (None, false, class.to_string());
    }
    let mut bp: Option<String> = None;
    let mut hover = false;
    for &p in &parts[..parts.len() - 1] {
        match p {
            "hover" => hover = true,
            "xs" | "sm" | "md" | "lg" | "xl" => bp = Some(p.to_string()),
            _ => {}
        }
    }
    let base = parts.last().unwrap().to_string();
    (bp, hover, base)
}

fn wrap_with_media(selector: &str, bp_key: Option<&str>, bps: &IndexMap<String, String>) -> String {
    if let Some(k) = bp_key {
        if let Some(val) = bps.get(k) {
            return format!("@media (min-width: {}) {{{}}}", val, selector);
        }
    }
    selector.to_string()
}

/// Get a Tailwind color hex value from a string like "slate-200" or "blue-500"
fn get_tailwind_color(color_shade: &str) -> Option<String> {
    let parts: Vec<&str> = color_shade.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let color_name = parts[0];
    let shade = parts[1];
    
    TAILWIND_COLORS
        .get(color_name)
        .and_then(|shades| shades.get(shade))
        .map(|&hex| hex.to_string())
}

/// Parse arbitrary values like bg-[var(--primary)], text-[#ff0000], border-[hsl(200,50%,50%)]
fn parse_arbitrary_value(class: &str) -> Option<CssProps> {
    // Match pattern: prefix-[value]
    if let Some(bracket_start) = class.find('[') {
        if !class.ends_with(']') {
            return None;
        }
        let prefix = &class[..bracket_start];
        let value = &class[bracket_start + 1..class.len() - 1];
        
        let mut props = CssProps::new();
        match prefix {
            "bg" => {
                props.insert("background-color".into(), json!(value));
                return Some(props);
            }
            "text" => {
                props.insert("color".into(), json!(value));
                return Some(props);
            }
            "border" => {
                props.insert("border-color".into(), json!(value));
                return Some(props);
            }
            "divide" => {
                props.insert("border-color".into(), json!(value));
                return Some(props);
            }
            _ => return None,
        }
    }
    None
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

    #[test]
    fn display_flex_hover_breakpoint() {
        let mut st = State::new_default();
        st.register_tailwind_classes([
            "block".into(),
            "inline-flex".into(),
            "hidden".into(),
            "md:flex".into(),
            "md:hover:block".into(),
        ]);
        let css = st.css_for_web();
        assert!(css.contains(".block{"));
        assert!(css.contains("display:block"));
        assert!(css.contains(".inline-flex{"));
        assert!(css.contains("display:inline-flex"));
        assert!(css.contains(".hidden{"));
        assert!(css.contains("display:none"));
        // breakpoint rule
        assert!(css.contains("@media (min-width: 768px)"));
        assert!(css.contains(".flex{display:flex"));
        // hover inside media (substring check)
        assert!(css.contains(":hover{display:block"));

        // RN resolves base class styles ignoring prefixes
        let rn = st.rn_styles_for("div", &["md:flex".into()]);
        assert_eq!(rn.get("display").and_then(|v| v.as_str()), Some("flex"));
    }
}

#[cfg(all(target_os = "android", feature = "android"))]
mod android_jni;

#[cfg(target_vendor = "apple")]
mod ios_ffi;

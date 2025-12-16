use crate::{CssProps, SelectorStyles, State, ThemeEntry};
use indexmap::{IndexMap, IndexSet};
use serde_json::json;

/// Return an embedded default State equivalent to `theme.yaml`.
pub fn bundled_state() -> State {
    let mut themes: IndexMap<String, ThemeEntry> = IndexMap::new();

    // default theme selectors
    let mut default_selectors: SelectorStyles = SelectorStyles::new();

    // body
    {
        let mut p = CssProps::new();
        p.insert("background-color".into(), json!("#0f172a"));
        p.insert("color".into(), json!("#f8fafc"));
        p.insert(
            "font-family".into(),
            json!("Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"),
        );
        default_selectors.insert("body".into(), p);
    }

    // button
    {
        let mut p = CssProps::new();
        p.insert("background-color".into(), json!("#2563eb"));
        p.insert("color".into(), json!("#ffffff"));
        p.insert("border-radius".into(), json!(6));
        p.insert("padding".into(), json!("8px 12px"));
        default_selectors.insert("button".into(), p);
    }

    // simple selectors
    default_selectors.insert("div".into(), {
        let mut p = CssProps::new();
        p.insert("padding".into(), json!("4px"));
        p
    });
    default_selectors.insert(".p-2".into(), {
        let mut p = CssProps::new();
        p.insert("padding".into(), json!("8px"));
        p
    });
    default_selectors.insert(".flex".into(), {
        let mut p = CssProps::new();
        p.insert("display".into(), json!("flex"));
        p
    });
    default_selectors.insert(".flex-col".into(), {
        let mut p = CssProps::new();
        p.insert("display".into(), json!("flex"));
        p.insert("flex-direction".into(), json!("column"));
        p
    });
    default_selectors.insert(".w-screen".into(), {
        let mut p = CssProps::new();
        p.insert("width".into(), json!("100vw"));
        p
    });
    default_selectors.insert(".h-screen".into(), {
        let mut p = CssProps::new();
        p.insert("height".into(), json!("100vh"));
        p
    });
    default_selectors.insert(".w-full".into(), {
        let mut p = CssProps::new();
        p.insert("width".into(), json!("100%"));
        p
    });
    default_selectors.insert(".h-full".into(), {
        let mut p = CssProps::new();
        p.insert("height".into(), json!("100%"));
        p
    });

    // hover mx
    {
        let mut p = CssProps::new();
        p.insert("margin-left".into(), json!("4px"));
        p.insert("margin-right".into(), json!("4px"));
        default_selectors.insert(".hover\\:mx-1:hover".into(), p);
    }

    // border utility (color is derived from theme variable)
    {
        let mut p = CssProps::new();
        p.insert("border-width".into(), json!("1px"));
        p.insert("border-style".into(), json!("solid"));
        p.insert("border-color".into(), json!("var(border)"));
        default_selectors.insert(".border".into(), p);
    }

    // headings and text
    {
        let mut p = CssProps::new();
        p.insert("margin-top".into(), json!("1.5rem"));
        p.insert("margin-bottom".into(), json!("0.5rem"));
        p.insert("line-height".into(), json!("1.2"));
        default_selectors.insert("h1, h2, h3, h4, h5, h6".into(), p);
    }
    default_selectors.insert("h1".into(), {
        let mut p = CssProps::new();
        p.insert("font-size".into(), json!("2.2rem"));
        p.insert("padding-bottom".into(), json!("0.35rem"));
        p
    });
    default_selectors.insert("h2".into(), {
        let mut p = CssProps::new();
        p.insert("font-size".into(), json!("1.75rem"));
        p.insert("padding-bottom".into(), json!("0.25rem"));
        p
    });
    default_selectors.insert("p".into(), {
        let mut p = CssProps::new();
        p.insert("margin-bottom".into(), json!("1rem"));
        p
    });
    default_selectors.insert("ul, ol".into(), {
        let mut p = CssProps::new();
        p.insert("margin-left".into(), json!("1.25rem"));
        p.insert("margin-bottom".into(), json!("1rem"));
        p
    });
    default_selectors.insert("blockquote".into(), {
        let mut p = CssProps::new();
        p.insert("border-left".into(), json!("4px solid var(primary)"));
        p.insert("padding-left".into(), json!("1rem"));
        p
    });
    default_selectors.insert("code".into(), {
        let mut p = CssProps::new();
        p.insert("background-color".into(), json!("var(bg)"));
        p.insert("border".into(), json!("1px solid var(border)"));
        p.insert("border-radius".into(), json!("0.5rem"));
        p.insert("padding".into(), json!("0.2rem 0.4rem"));
        p.insert(
            "font-family".into(),
            json!("'JetBrains Mono', 'Fira Code', Consolas, monospace"),
        );
        p
    });
    default_selectors.insert("pre".into(), {
        let mut p = CssProps::new();
        p.insert("background-color".into(), json!("var(bg)"));
        p.insert("border".into(), json!("1px solid var(border)"));
        p.insert("border-radius".into(), json!("0.75rem"));
        p.insert("padding".into(), json!("1rem"));
        p.insert("overflow-x".into(), json!("auto"));
        p
    });
    default_selectors.insert("table".into(), {
        let mut p = CssProps::new();
        p.insert("width".into(), json!("100%"));
        p.insert("border-collapse".into(), json!("collapse"));
        p.insert("margin-bottom".into(), json!("1rem"));
        p
    });
    default_selectors.insert("td, th".into(), {
        let mut p = CssProps::new();
        p.insert("border".into(), json!("1px solid var(border)"));
        p.insert("padding".into(), json!("0.75rem"));
        p
    });
    default_selectors.insert("th".into(), {
        let mut p = CssProps::new();
        p.insert("background-color".into(), json!("var(surface)"));
        p.insert("font-weight".into(), json!(600));
        p
    });
    default_selectors.insert("hr".into(), {
        let mut p = CssProps::new();
        p.insert("border".into(), json!(0));
        p.insert("height".into(), json!("1px"));
        p.insert("background-color".into(), json!("var(border)"));
        p.insert("margin".into(), json!("2rem 0"));
        p
    });

    // variables
    let variables: IndexMap<String, String> = IndexMap::from([
        ("text".into(), "#111b26".into()),
        ("bg".into(), "#ffffff".into()),
        ("surface".into(), "#f5f6fb".into()),
        ("border".into(), "#d9dee7".into()),
        ("muted".into(), "#5f6b7a".into()),
        ("primary".into(), "#1f73ff".into()),
        ("primary-strong".into(), "#0f59d2".into()),
        ("danger".into(), "#e75b64".into()),
    ]);

    let breakpoints: IndexMap<String, String> = IndexMap::from([
        ("xs".into(), "480px".into()),
        ("sm".into(), "640px".into()),
        ("md".into(), "768px".into()),
        ("lg".into(), "1024px".into()),
        ("xl".into(), "1280px".into()),
    ]);

    themes.insert(
        "default".into(),
        ThemeEntry { inherits: None, selectors: default_selectors, variables, breakpoints },
    );

    // dark theme inherits
    themes.insert(
        "dark".into(),
        ThemeEntry { inherits: Some("default".into()), ..Default::default() },
    );
    // light theme inherits
    themes.insert(
        "light".into(),
        ThemeEntry { inherits: Some("default".into()), ..Default::default() },
    );

    State {
        themes,
        default_theme: "default".into(),
        current_theme: "default".into(),
        theme_variables: IndexMap::new(),
        variables: IndexMap::new(),
        breakpoints: IndexMap::new(),
        used_selectors: IndexSet::new(),
        used_classes: IndexSet::new(),
    }
}

# themed-styler

Client-side runtime styling engine for web and React Native with theme support and Tailwind-style utility classes defined in themes. It stores theme-aware selector styles using CSS property names, tracks which selectors/classes are actually used, and can output either:

- Web CSS for currently-used selectors/classes
- React Native style objects for a selector combined with Tailwind-like utility classes

This crate is designed to be embedded in clients or tooling. A CLI wrapper is available via the hook-transpiler-cli crate.

## Features

- Theme registry with default/current theme switching
- CSS-attribute-based style storage per selector
- Per-theme variables and breakpoints (xs, sm, md, lg, xl), with inheritance
- Tailwind utilities are provided by the theme (no whitelist). The default theme ships with a minimal set and other themes inherit from it.
- Output:
  - Web: flat CSS string for currently used selectors/classes
  - React Native: camelCased style object with basic unit conversion (e.g., "8px" → 8)
- Tracks used selectors/classes so only in-DOM styles get emitted

## Quick start (Rust)

```text
use themed_styler::api::State;
use indexmap::IndexMap;

// 1) Start with a default state
let mut st = State::new_default();

// 2) Register what is currently used in your app
st.register_selectors(["body".to_string(), "button".to_string()]);
st.register_tailwind_classes(["p-2".to_string(), "hover:mx-1".to_string()]);

// 3) Emit CSS for the web
let css = st.css_for_web();
println!("{}", css);

// 4) Emit RN styles for a specific selector + classes
let rn = st.rn_styles_for("button", &["p-2".into()]);
println!("{}", serde_json::to_string_pretty(&rn).unwrap());

// 5) Themes/variables/breakpoints can be customized
st.set_theme("light").ok();
st.set_variables(IndexMap::from([
    ("primary".into(), "#2563eb".into()),
]));
st.set_breakpoints(IndexMap::from([
    ("md".into(), "768px".into()),
]));
```

## Tailwind utilities

- There is no runtime whitelist or generator anymore. Classes used at runtime are matched directly against the active theme’s selectors (for example, the class "p-2" is looked up as ".p-2" in the theme; "hover:p-2" is looked up as ".p-2:hover").
- The crate bundles a default YAML theme that includes a small subset of utilities as examples; apps can extend it by adding selectors to their own theme(s).

## Theme format and inheritance

- The default state is defined in YAML and bundled with the crate: crates/themed-styler/theme.yaml.
- Each theme entry contains selectors, variables, and breakpoints, plus an optional inherits pointing to a parent theme.
- Inheritance merges child → parent(s) → default, with parent overriding child on conflicts. This means default can define the canonical utility classes and common selectors, while other themes only specify overrides.

Example (YAML):

```yaml
themes:
  default:
    selectors:
      ".p-2": { padding: "8px" }
    variables:
      text: "#111b26"
      bg: "#ffffff"
    breakpoints:
      xs: "480px"
      md: "768px"
  dark:
    inherits: default
    selectors:
      body: { color: "#f8fafc" }
    variables:
      bg: "#0f172a"
default_theme: default
current_theme: dark
```

On load and theme switch, themed-styler computes effective selectors, variables, and breakpoints by following the inherits chain and finally the default theme.

### Variables and breakpoints (per-theme)

- Variables and breakpoints live inside each theme under variables and breakpoints.
- Resolution order for variables: legacy global variables (lowest) → current theme variables → parents (via inherits) → default theme variables (highest). Breakpoints follow the same order.
- React Native output resolves var tokens too. Supported syntaxes: var(--name), var(name), and $name.

Example YAML (variables and breakpoints):

```yaml
themes:
  default:
    selectors:
      body:
        background-color: "var(bg)"
        color: "var(text)"
    variables:
      bg: "#ffffff"
      text: "#111b26"
    breakpoints:
      xs: "480px"
      sm: "640px"
default_theme: default
current_theme: default
```

## CLI integration

The hook-transpiler-cli crate embeds themed-styler state management as subcommands. Example workflow:

```text
# Initialize a state file
hook-transpiler-cli style init --file .themed-styler-state.json

# Register usage (selectors/classes)
hook-transpiler-cli style register-selectors --file .themed-styler-state.json body button
hook-transpiler-cli style register-classes   --file .themed-styler-state.json p-2 hover:mx-1

# Output web CSS (stdout)
hook-transpiler-cli style css --file .themed-styler-state.json

# Output RN style object for a selector + classes
hook-transpiler-cli style rn --file .themed-styler-state.json button p-2
```

## State format

State can be serialized/deserialized for tooling. Internally the crate uses Serde and accepts JSON; the built-in default is YAML.

```json
{
  "themes": {
    "default": {
      "selectors": {
        "body": { "background-color": "var(bg)", "color": "var(text)" }
      },
      "variables": { "bg": "#ffffff", "text": "#111b26" },
      "breakpoints": { "xs": "480px", "md": "768px" }
    },
    "dark": {
      "inherits": "default",
      "selectors": { "body": { "color": "#f8fafc" } },
      "variables": { "bg": "#0f172a" }
    }
  },
  "default_theme": "default",
  "current_theme": "default",
  "used_selectors": ["body", "button"],
  "used_classes": ["p-2", "hover:mx-1"]
}
```

## Status & next steps

- **Core theme storage & usage tracking:** `State` already captures selectors/styles per theme with `dark`/`light` defaults and allows `register_selectors`/`register_tailwind_classes`, but the runtime client/global-context wiring described in the requirements still needs the createElement wrapper/hooks to keep the state in sync with components that render and unmount.
- **Theme overrides, variables, and breakpoints:** CLI helpers (`add_theme`, `set_vars`, `set_bps`, `set_theme`) are in place, yet we still need a shared theme file that exposes the `default/dark/light` combinations and gives consumers a place to override selectors before the runtime or tooling reads them.
- **Web CSS & RN output:** `css_for_web` and `rn_styles_for` (plus the CLI `style css`/`style rn` commands) already handle selected selectors and Tailwind utilities, but the RN conversion needs to be wired into the React Native runtime wrapper so selectors in the tree can query the instantiated styles directly.
- **Runtime Tailwind support:** Tailwind utilities are theme-defined (no whitelist). The default YAML includes a minimal set (e.g., `.p-2`, `.hover\:mx-1:hover`) and apps can add more in their themes.
- **Client-web stylesheet updates:** Not yet implemented; the requirement to repaint or replace the global stylesheet whenever DOM selectors/classes change (and to avoid loading unused styles) remains outstanding and will need a global style manager on the web side that reacts to runtime selector registration.
- **Tailwind/nativewind removal & custom wrapper:** The web and RN clients still ship with their existing Tailwind stylesheets and nativewind wiring. We need to delete `index.css`/`globals.css` and any Tailwind/nativewind references, then rewire both apps to use the themed-styler binary via the custom styled wrapper.
- **Example theme file & hooks:** While `State::new_default` provides in-memory defaults, there is no filesystem example that can be shared with the template repo. We should add a JSON theme file (with `default` aliasing `dark`, plus explicit `dark` and `light`) and refactor `template-ui/theme.js` to use the new hooks to set selectors/themes/values instead of the old boilerplate.
- **React Native selectors:** The backend supports selector registration, but we still need to capture the actual string tag names from `createElement` (or a wrapper) so selectors like `View[type=primary]` stay accurate in React Native.
- **CLI commands & tests:** The CLI already exposes `style init`, `register-selectors`, `register-classes`, `css`, and `rn`, but the requirements also expect exposing theme/variables/breakpoint updates and tailored outputs for selectors. We need new unit tests that exercise `set-theme`, `add-theme`, `set-vars`, etc., to ensure the commands manipulate the state as expected.
- **Tailwind CSS files:** Legacy Tailwind CSS imports should be removed from clients; runtime styling comes from themed-styler + theme utilities.

## Default theme file

A default YAML state is bundled at `crates/themed-styler/theme.yaml` and loaded automatically by `State::new_default()`. You can still manage state via JSON with the CLI if preferred.

Notes about selectors and HTML tag usage
- Use HTML tags for all selectors in themes (for example `div`, `button`, `h1`). The React Native app will render JSX `div` into a styled native `View` at runtime, so keeping HTML tags in themes makes selector logic identical between web and RN.
- The runtime and CLI accept class selectors such as `.myClass` or combined selectors like `div.myClass` (these are stored as literal selector keys in theme objects). Ensure your components emit matching selector strings when registering usage.

Runtime integration (overview)
- The next step is adding a small createElement wrapper / hooks in the template/client apps that:
  - preserve the original string tag used in JSX (e.g., `div`) so selectors like `div[type=primary]` or `div.myClass` can match in RN and web alike,
  - call the runtime to `register_selectors`/`register_tailwind_classes` on mount and `unregister` on unmount (to keep `used_selectors` accurate), and
  - on the web, call the style manager to fetch `css_for_web()` and write it into a single global <style> tag when the used selectors/classes set changes.

We'll implement these runtime helpers in `template-ui` as the next task and provide concrete JS/TS files and usage examples for both `client-web` and `client-react-native`.

## Notes

- Store attributes using CSS property names; RN output will camelCase and convert px to numbers when possible.
- CSS output is flat by design initially; media queries may be emitted in future iterations.
- Only styles for registered selectors/classes are emitted to keep output minimal.

## License

MIT OR Apache-2.0

## Web wrapper example (TSDiv)

The client-web app uses a very small wrapper component named `TSDiv` that reports usage to the unified themed-styler bridge and renders a normal DOM element. This keeps usage tracking opt-in, instead of wrapping every element globally.

Example (simplified):

```text
// apps/client-web/src/components/TSDiv.tsx
import React, { useEffect } from 'react'
import { unifiedBridge, styleManager } from '@relay/shared'

type DivProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
  tag?: string
}

export const TSDiv: React.FC<DivProps> = ({ children, tag = 'div', ...props }) => {
  useEffect(() => {
    try {
      unifiedBridge.registerUsage(tag, props as any)
      styleManager.requestRender()
    } catch {}
  }, [props.className])

  return React.createElement(tag, props, children)
}
```

Usage in the app:

```text
import { TSDiv } from './components/TSDiv'

// Replace <div> with <TSDiv> and pass className normally
<TSDiv className="flex flex-col w-screen h-screen">
  ...
</TSDiv>
```

Notes:
- The wrapper passes the same tag string (default 'div', or via `tag` prop) to `registerUsage` so selectors like `div.myClass` can match across web and RN.
- Only wrapped elements are registered; this prevents over-collecting and keeps the emitted stylesheet minimal.

Hierarchy tracking and selector generation
-----------------------------------------

The `TSDiv` wrapper also tracks a lightweight hierarchy of wrapped nodes and their classes. When present, the runtime bridge accepts a third `hierarchy` argument: an array of nodes from the root down to the current node where each node is `{ tag: string, classes?: string[] }`.

Providing the hierarchy enables the themed-styler bridge to emit additional descendant selectors to improve specificity and reduce accidental matches. Examples of selectors that may be generated when a node with `tag='button'` and class `['primary']` is nested under an ancestor `div` with class `['card']` include:

- `div button`
- `div button.primary`
- `.card button`
- `.card button.primary`
- `.card .primary`

The bridge will not emit direct-child (`>`) selectors; only descendant relationships are used. If the hierarchy argument is omitted, the bridge keeps the previous (lighter-weight) behavior and only registers the element's tag and classes themselves (e.g., `button`, `.primary`, `button.primary`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PluginSource {
    /// Built-in native Repo Browser plugin
    BuiltInDefault,
    /// Built-in webview-based plugin
    BuiltInWebview,
    /// Plugin fetched from the current repository (remote server GET)
    RepoProvided { url: String, name: Option<String>, manifest_hash: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginCaps {
    pub uses_network: bool,
    pub uses_js_runtime: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDescriptor {
    pub id: String,
    pub source: PluginSource,
    pub capabilities: PluginCaps,
}

/// Minimal context available to plugins
#[derive(Debug, Clone, Default)]
pub struct RepoContext {
    pub peer_base_url: String,
    pub branch: String,
    pub repo: String,
    pub path: String,
}

/// Message/event exchanged with plugins
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PluginEvent {
    Navigate { path: String },
    Query { body: serde_json::Value },
    Custom(serde_json::Value),
}

/// Abstract plugin interface (UI-specific render target will be added in the Valdi app)
pub trait Plugin {
    fn id(&self) -> &str;
    fn handle_event(&mut self, _event: PluginEvent) {}
}

/// Registry lists and loads available plugins for a given context.
pub struct PluginRegistry;

impl PluginRegistry {
    pub fn list_available(
        repo_plugin_url: Option<(String, Option<String>, Option<String>)>,
    ) -> Vec<PluginDescriptor> {
        let mut v = Vec::new();
        // Note: Selection priority at runtime: RepoProvided -> BuiltInDefault -> BuiltInWebview
        if let Some((url, name, hash)) = repo_plugin_url {
            v.push(PluginDescriptor {
                id: format!("repo:{}", name.clone().unwrap_or_else(|| url.clone())),
                source: PluginSource::RepoProvided { url, name, manifest_hash: hash },
                capabilities: PluginCaps { uses_network: true, uses_js_runtime: false },
            });
        }
        v.push(PluginDescriptor {
            id: "builtin:default".into(),
            source: PluginSource::BuiltInDefault,
            capabilities: PluginCaps { uses_network: true, uses_js_runtime: false },
        });
        v.push(PluginDescriptor {
            id: "builtin:webview".into(),
            source: PluginSource::BuiltInWebview,
            capabilities: PluginCaps { uses_network: true, uses_js_runtime: true },
        });
        v
    }
}

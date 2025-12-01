/**
 * Plugin Switcher UI Component
 * Allows users to select which plugin to use for a given repo/peer
 */

import React, {useState, useCallback} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useAppState, PluginType} from '../state/store';
import {BUILTIN_PLUGINS, type PluginDescriptor, PLUGIN_PRIORITY} from './registry';

interface PluginSwitcherProps {
  tabId: string;
  visible: boolean;
  onClose: () => void;
  availablePlugins: PluginDescriptor[];
}

const PluginSwitcherComponent: React.FC<PluginSwitcherProps> = ({
  tabId,
  visible,
  onClose,
  availablePlugins,
}) => {
  const updateTab = useAppState((s) => s.updateTab);
  const tabs = useAppState((s) => s.tabs);
  const tab = tabs.find((t) => t.id === tabId);

  const allPlugins = [...availablePlugins, ...BUILTIN_PLUGINS].reduce(
    (acc, p) => {
      if (!acc.find((x) => x.id === p.id)) acc.push(p);
      return acc;
    },
    [] as PluginDescriptor[],
  );

  const handleSelectPlugin = useCallback(
    (plugin: PluginDescriptor) => {
      updateTab(tabId, (t) => ({
        ...t,
        pluginId: plugin.id,
      }));
      onClose();
    },
    [tabId, updateTab, onClose],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Plugin</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {allPlugins.map((plugin) => (
            <TouchableOpacity
              key={plugin.id}
              style={[
                styles.pluginItem,
                tab?.pluginId === plugin.id && styles.pluginItemSelected,
              ]}
              onPress={() => handleSelectPlugin(plugin)}>
              <View style={styles.pluginInfo}>
                <Text style={styles.pluginName}>{plugin.name}</Text>
                {plugin.description && (
                  <Text style={styles.pluginDescription} numberOfLines={2}>
                    {plugin.description}
                  </Text>
                )}
                <View style={styles.pluginMeta}>
                  <Text style={styles.pluginType}>{plugin.type}</Text>
                  {plugin.version && (
                    <Text style={styles.pluginVersion}>{plugin.version}</Text>
                  )}
                </View>
              </View>
              {tab?.pluginId === plugin.id && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.info}>
          <Text style={styles.infoText}>
            Plugins are selected in priority order: Repo-provided → Native → WebView
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#999',
  },
  content: {
    flex: 1,
  },
  pluginItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  pluginItemSelected: {
    backgroundColor: '#f0f8ff',
  },
  pluginInfo: {
    flex: 1,
  },
  pluginName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  pluginDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  pluginMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  pluginType: {
    fontSize: 11,
    color: '#999',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 3,
  },
  pluginVersion: {
    fontSize: 11,
    color: '#999',
  },
  checkmark: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: '700',
    marginLeft: 12,
  },
  info: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  infoText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
});

export const PluginSwitcher = PluginSwitcherComponent;
export default PluginSwitcherComponent;

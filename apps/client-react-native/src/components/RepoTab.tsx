import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useAppState } from '../state/store';
import { fetchPeerOptions } from '../services/probing';
import HookRenderer from './HookRenderer';
import { styled } from '../tailwindRuntime';

interface RepoTabProps {
  tabId: string;
}

interface OptionsInfo {
  branches?: string[];
  repos?: string[];
  branchHeads?: Record<string, string>;
  relayYaml?: unknown;
  lastUpdateTs?: number;
}

const RepoTabComponent: React.FC<RepoTabProps> = ({ tabId }) => {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId));
  const updateTab = useAppState((s) => s.updateTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_optionsInfo, setOptionsInfo] = useState<OptionsInfo>({});
  const [pathInput, setPathInput] = useState(tab?.path ?? '/');

  useEffect(() => {
    if (!tab) {
      console.warn(`[RepoTab] Tab with ID ${tabId} not found. Tabs available:`, useAppState.getState().tabs.map(t => t.id));
      return;
    }
    loadOptions();
  }, [tab?.host, tabId]);

  const loadOptions = async () => {
    if (!tab) return;
    console.log('[RepoTab] loadOptions called for host:', tab.host);
    setLoading(true);
    setError(null);

    try {
      // Skip actual fetch for now - use defaults and let HookRenderer handle loading
      console.log('[RepoTab] Using default options (skipping fetch)');
      setOptionsInfo({
        branches: ['main'],
      });

      if (!tab.currentBranch) {
        updateTab(tabId, (t) => ({
          ...t,
          branches: ['main'],
          currentBranch: 'main',
        }));
      }
    } catch (e) {
      console.error('[RepoTab] Error in loadOptions:', e);
      setError(e instanceof Error ? e.message : 'Failed to load peer info');
    } finally {
      console.log('[RepoTab] loadOptions finished, setting loading=false');
      setLoading(false);
    }
  };

  const TWView = styled(View);
  const TWText = styled(Text);
  const TWButton = styled(TouchableOpacity);

  if (!tab) {
    return (
      <TWView className="flex-1 min-h-0 bg-white">
        <TWView className="flex-1 items-center justify-center p-5">
          <TWText className="text-red-600 text-center mb-3">Tab not found (ID: {tabId})</TWText>
          <TWText className="text-gray-600 mt-2 text-xs">
            The tab may have been closed or is still loading.
          </TWText>
        </TWView>
      </TWView>
    );
  }

  return (
    <TWView className="flex-1 min-h-0 bg-white">
      {/* Header with host info */}
      <TWView className="flex-row items-center px-3 py-3 border-b border-gray-200 bg-gray-50">
        <TWText className="text-base font-semibold flex-1">{tab.host}</TWText>
        {tab.currentBranch && (
          <TWView className="bg-blue-500 px-2 py-1 rounded mr-2">
            <TWText className="text-white text-xs font-medium">{tab.currentBranch}</TWText>
          </TWView>
        )}
      </TWView>

      {/* Content area */}
      {loading ? (
        <TWView className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#007AFF" />
          <TWText className="mt-3 text-gray-600">Loading peer info...</TWText>
        </TWView>
      ) : error ? (
        <TWView className="flex-1 items-center justify-center p-5">
          <TWText className="text-red-600 text-center mb-3">{error}</TWText>
          <TWButton className="bg-blue-500 px-5 py-2 rounded-md" onPress={loadOptions}>
            <TWText className="text-white font-semibold">Retry</TWText>
          </TWButton>
        </TWView>
      ) : (
        <TWView className="flex-1 min-h-0">
          <HookRenderer host={tab.host} />
        </TWView>
      )}
    </TWView>
  );
};

export const RepoTab = RepoTabComponent;
export default RepoTabComponent;

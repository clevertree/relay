import React from 'react';
import { Text, View } from 'react-native';
import { useAppState } from '../state/store';
import HookRenderer from './HookRenderer';
import { styled } from '../tailwindRuntime';

interface RepoTabProps {
  tabId: string;
}

const TWView = styled(View);
const TWText = styled(Text);

const RepoTabComponent: React.FC<RepoTabProps> = ({ tabId }) => {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId));

  if (!tab) {
    return (
      <TWView className="flex-1 min-h-0 bg-white">
        <TWView className="flex-1 items-center justify-center p-5">
          <TWText className="text-red-600 text-center mb-3">Tab not found (ID: {tabId})</TWText>
          <TWText className="text-gray-600 mt-2 text-xs">
            The tab was removed or is still syncing. Try reopening a peer or switching tabs.
          </TWText>
        </TWView>
      </TWView>
    );
  }

  return (
    <TWView className="flex-1 min-h-0 bg-white">
      <TWView className="flex-row items-center px-3 py-3 border-b border-gray-200 bg-gray-50">
        <TWText className="text-base font-semibold flex-1">{tab.host}</TWText>
        {tab.currentBranch && (
          <TWView className="bg-blue-500 px-2 py-1 rounded mr-2">
            <TWText className="text-white text-xs font-medium">{tab.currentBranch}</TWText>
          </TWView>
        )}
      </TWView>
      <TWView className="flex-1 min-h-0">
        <HookRenderer host={tab.host} />
      </TWView>
    </TWView>
  );
};

export const RepoTab = RepoTabComponent;
export default RepoTabComponent;

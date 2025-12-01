import React, {useEffect} from 'react';
import {FlatList, RefreshControl, SafeAreaView, Text, TouchableOpacity, View} from 'react-native';
import {useAppState, type PeerInfo} from '../state/store';
import {RelayCore} from '../../native/RelayCoreModule';

export const PeersView: React.FC = () => {
  const peers = useAppState((s) => s.peers);
  const setPeers = useAppState((s) => s.setPeers);

  const refresh = async () => {
    const envPeers = await RelayCore.getMasterPeerList();
    setPeers(envPeers);
  };

  useEffect(() => {
    refresh();
  }, []);

  const renderItem = ({item}: {item: PeerInfo}) => {
    const https = item.probes.find((p) => p.protocol === 'https');
    return (
      <TouchableOpacity
        style={{padding: 12, borderBottomWidth: 1, borderColor: '#eee'}}
        onPress={() => {
          // Placeholder: open tab in future milestone
        }}
      >
        <Text style={{fontWeight: '600'}}>{item.host}</Text>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 4}}>
          <Text style={{color: https?.ok ? 'green' : 'red'}}>
            HTTPS {https?.ok ? `${https?.latencyMs ?? '-'}ms` : 'down'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{flex: 1}}>
      <FlatList
        data={peers}
        keyExtractor={(p) => p.host}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
        ListEmptyComponent={
          <View style={{padding: 16}}>
            <Text>No peers configured. Set RELAY_MASTER_PEER_LIST or add manually.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

export default PeersView;

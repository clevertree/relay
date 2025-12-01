import React from 'react';
import {SafeAreaView, StatusBar, View, Text} from 'react-native';
import PeersView from './components/PeersView';

const App: React.FC = () => {
  return (
    <SafeAreaView style={{flex: 1}}>
      <StatusBar barStyle="dark-content" />
      <View style={{padding: 12, borderBottomWidth: 1, borderColor: '#eee'}}>
        <Text style={{fontSize: 18, fontWeight: '700'}}>Relay Client</Text>
      </View>
      <PeersView />
    </SafeAreaView>
  );
};

export default App;

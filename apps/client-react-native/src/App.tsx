import React, { useEffect } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  useWindowDimensions,
  AppRegistry,
} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import PeersView from './components/PeersView';
import RepoTab from './components/RepoTab';
import {useAppState} from './state/store';
import { useAppUpdate } from './hooks/useAppUpdate';
import { UpdateModal } from './components/UpdateModal';

type RootStackParamList = {
  Home: undefined;
  RepoTab: {tabId: string};
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const TabBar: React.FC<{navigation: any}> = ({navigation}) => {
  const tabs = useAppState((s) => s.tabs);
  const activeTabId = useAppState((s) => s.activeTabId);
  const setActiveTab = useAppState((s) => s.setActiveTab);
  const closeTab = useAppState((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <View style={styles.tabBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tabs.map((tab) => (
          <View key={tab.id} style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTabId === tab.id && styles.tabActive]}
              onPress={() => {
                setActiveTab(tab.id);
                navigation.navigate('RepoTab', {tabId: tab.id});
              }}>
              <Text
                style={[
                  styles.tabText,
                  activeTabId === tab.id && styles.tabTextActive,
                ]}
                numberOfLines={1}>
                {tab.title}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                closeTab(tab.id);
                if (tabs.length === 1) {
                  navigation.navigate('Home');
                }
              }}>
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const HomeScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const openTab = useAppState((s) => s.openTab);
  const {width} = useWindowDimensions();
  const isTablet = width >= 768;
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  // Check for updates on component mount
  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  const handlePeerPress = (host: string) => {
    const tabId = openTab(host);
    navigation.navigate('RepoTab', {tabId});
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Relay Client</Text>
        <TouchableOpacity 
          style={styles.updateButton}
          onPress={checkForUpdate}
        >
          <Text style={styles.updateButtonText}>🔄</Text>
        </TouchableOpacity>
      </View>
      <TabBar navigation={navigation} />
      <View style={isTablet ? styles.splitContainer : styles.fullContainer}>
        <View style={isTablet ? styles.sidePanel : styles.fullPanel}>
          <PeersView onPeerPress={handlePeerPress} />
        </View>
      </View>
      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </SafeAreaView>
  );
};

const RepoTabScreen: React.FC<{route: any; navigation: any}> = ({route, navigation}) => {
  const {tabId} = route.params;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Peers</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Relay Client</Text>
        <View style={styles.headerSpacer} />
      </View>
      <TabBar navigation={navigation} />
      <RepoTab tabId={tabId} />
    </SafeAreaView>
  );
};

class ErrorBoundary extends React.Component<{}, {error: Error | null}> {
  constructor(props: {}) {
    super(props);
    this.state = {error: null};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
    this.setState({error});
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
          <Text style={{color: '#dc3545'}}>A rendering error occurred. Check logs.</Text>
        </SafeAreaView>
      );
    }
    // @ts-ignore allow children
    return this.props.children;
  }
}

const App: React.FC = () => {
  // Debug: log component availability to help diagnose undefined SceneView errors
  // (SceneView will throw if a screen's component is undefined)
  // eslint-disable-next-line no-console
  console.log('HomeScreen type:', typeof HomeScreen);
  // eslint-disable-next-line no-console
  console.log('RepoTabScreen type:', typeof RepoTabScreen);
  // eslint-disable-next-line no-console
  console.log('PeersView type:', typeof PeersView, 'RepoTab import type:', typeof RepoTab);

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Stack.Navigator id="RootNavigator" screenOptions={{headerShown: false}}>
          <Stack.Screen
            name="Home">
            {(props) => {
              try {
                // eslint-disable-next-line no-console
                console.log('Rendering HomeScreen, PeersView type:', typeof PeersView);
                return <HomeScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('HomeScreen render failed', err);
                return (
                  <SafeAreaView style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text>Home render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
          <Stack.Screen
            name="RepoTab">
            {(props) => {
              try {
                // eslint-disable-next-line no-console
                console.log('Rendering RepoTabScreen, RepoTab type:', typeof RepoTab);
                return <RepoTabScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('RepoTabScreen render failed', err);
                return (
                  <SafeAreaView style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text>RepoTab render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  updateButton: {
    padding: 8,
    marginLeft: 12,
  },
  updateButtonText: {
    fontSize: 18,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  headerSpacer: {
    width: 60,
  },
  tabBar: {
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    maxWidth: 150,
  },
  tabActive: {
    borderBottomColor: '#007AFF',
    backgroundColor: '#fff',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
  },
  tabTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  closeButton: {
    padding: 8,
    marginRight: 4,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#999',
    fontWeight: '600',
  },
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  fullContainer: {
    flex: 1,
  },
  sidePanel: {
    width: 320,
    borderRightWidth: 1,
    borderRightColor: '#eee',
  },
  fullPanel: {
    flex: 1,
  },
});

// Register the app component as required by React Native
AppRegistry.registerComponent('RelayClient', () => App);

export default App;

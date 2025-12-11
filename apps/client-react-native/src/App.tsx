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
import DebugTab from './components/DebugTab';
import {useAppState} from './state/store';
import { useAppUpdate } from './hooks/useAppUpdate';
import { UpdateModal } from './components/UpdateModal';

type RootStackParamList = {
  Main: undefined;
  RepoTab: {tabId: string};
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const TabBar: React.FC<{navigation: any}> = ({navigation}) => {
  const tabs = useAppState((s) => s.tabs);
  const activeTabId = useAppState((s) => s.activeTabId);
  const setActiveTab = useAppState((s) => s.setActiveTab);
  const closeTab = useAppState((s) => s.closeTab);
  const homeTabId = useAppState((s) => s.homeTabId);

  // Include home tab and debug tab
  const allTabs = [
    {id: homeTabId, title: 'Home', isHome: true},
    ...tabs,
    {id: 'debug', title: 'Debug', isDebug: true}
  ];

  return (
    <View style={styles.tabBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {allTabs.map((tab) => (
          <View key={tab.id} style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTabId === tab.id && styles.tabActive]}
              onPress={() => {
                setActiveTab(tab.id);
                if (tab.id === homeTabId) {
                  navigation.navigate('Main');
                } else if (tab.id === 'debug') {
                  navigation.navigate('Debug');
                } else {
                  navigation.navigate('RepoTab', {tabId: tab.id});
                }
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
            {!tab.isHome && !tab.isDebug && (
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  closeTab(tab.id);
                  if (activeTabId === tab.id) {
                    navigation.navigate('Main');
                  }
                }}>
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const MainScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const openTab = useAppState((s) => s.openTab);
  const activeTabId = useAppState((s) => s.activeTabId);
  const homeTabId = useAppState((s) => s.homeTabId);
  const {width} = useWindowDimensions();
  const isTablet = width >= 768;
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  // Check for updates on component mount
  useEffect(() => {
    checkForUpdate();
    console.log('[MainScreen] Mounted, activeTabId:', activeTabId);
  }, [checkForUpdate]);

  const handlePeerPress = (host: string) => {
    openTab(host).then((tabId) => {
      navigation.navigate('RepoTab', {tabId});
    }).catch((err) => {
      console.error('Failed to open tab:', err);
    });
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
          {!activeTabId || activeTabId === homeTabId ? (
            <>
              {console.log('[MainScreen] Rendering PeersView, activeTabId:', activeTabId, 'homeTabId:', homeTabId)}
              <PeersView onPeerPress={handlePeerPress} />
            </>
          ) : activeTabId === 'debug' ? (
            <>
              {console.log('[MainScreen] Rendering DebugTab, activeTabId:', activeTabId)}
              <DebugTab />
            </>
          ) : (
            <>
              {console.log('[MainScreen] Rendering RepoTab, activeTabId:', activeTabId)}
              <RepoTab tabId={activeTabId} />
            </>
          )}
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
      <View style={styles.contentWrapper}>
        <RepoTab tabId={tabId} />
      </View>
    </SafeAreaView>
  );
};

const DebugScreen: React.FC<{navigation: any}> = ({navigation}) => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Home</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Debug Tools</Text>
        <View style={styles.headerSpacer} />
      </View>
      <TabBar navigation={navigation} />
      <View style={styles.contentWrapper}>
        <DebugTab />
      </View>
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
  console.log('MainScreen type:', typeof MainScreen);
  // eslint-disable-next-line no-console
  console.log('RepoTabScreen type:', typeof RepoTabScreen);
  // eslint-disable-next-line no-console
  console.log('PeersView type:', typeof PeersView, 'RepoTab import type:', typeof RepoTab);

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Stack.Navigator id="RootNavigator" screenOptions={{headerShown: false}}>
          <Stack.Screen
            name="Main">
            {(props) => {
              try {
                // eslint-disable-next-line no-console
                console.log('Rendering MainScreen, PeersView type:', typeof PeersView);
                return <MainScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('MainScreen render failed', err);
                return (
                  <SafeAreaView style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text>Main render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
          <Stack.Screen
            name="Debug">
            {(props) => {
              try {
                return <DebugScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('DebugScreen render failed', err);
                return (
                  <SafeAreaView style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text>Debug render error</Text>
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
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#eee',
  },
  fullPanel: {
    flex: 1,
  },
  contentWrapper: {
    flex: 1,
  },
});

// Register the app component as required by React Native
AppRegistry.registerComponent('RelayClient', () => App);

export default App;

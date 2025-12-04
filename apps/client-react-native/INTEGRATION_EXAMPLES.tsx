/**
 * Example: How to integrate the Update feature into your App
 * 
 * This file shows different ways to add the self-update feature to your app.
 * Choose the approach that works best for your needs.
 */

// ============================================================================
// OPTION 1: Simple Integration in App.tsx (Recommended for getting started)
// ============================================================================

import React, { useEffect } from 'react';
import { SafeAreaView, TouchableOpacity, Text, View } from 'react-native';
import { useAppUpdate } from './hooks/useAppUpdate';
import { UpdateModal } from './components/UpdateModal';

export function AppExample1() {
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  // Check for updates on app launch
  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  return (
    <SafeAreaView>
      {/* Your app content */}
      <View>
        <Text>Relay Client</Text>
      </View>

      {/* Settings button to manually check for updates */}
      <TouchableOpacity onPress={checkForUpdate}>
        <Text>Check for Updates</Text>
      </TouchableOpacity>

      {/* Update modal - shows automatically if update available */}
      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
        onUpdateCompleted={() => {
          // Optional: handle post-update (usually app restarts)
          console.log('Update completed, app will restart');
        }}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// OPTION 2: Settings Screen with Update Button
// ============================================================================

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface SettingsScreenProps {
  navigation: any;
}

export function SettingsScreenExample(props: SettingsScreenProps) {
  const { showUpdateModal, setShowUpdateModal, checkForUpdate, isChecking } =
    useAppUpdate();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <TouchableOpacity
          style={styles.settingRow}
          onPress={checkForUpdate}
          disabled={isChecking}>
          <Text style={styles.settingLabel}>
            {isChecking ? 'Checking for updates...' : 'Check for Updates'}
          </Text>
          <Text style={styles.settingValue}>→</Text>
        </TouchableOpacity>
      </View>

      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </ScrollView>
  );
}

// ============================================================================
// OPTION 3: Periodic Check with Silent Updates
// ============================================================================

import React, { useEffect, useRef } from 'react';

export function AppWithPeriodicUpdates() {
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();
  const checkIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Check for update on launch
    checkForUpdate();

    // Check every 24 hours
    checkIntervalRef.current = setInterval(() => {
      checkForUpdate();
    }, 24 * 60 * 60 * 1000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkForUpdate]);

  return (
    <>
      {/* Your app components */}
      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </>
  );
}

// ============================================================================
// OPTION 4: Custom Implementation with Error Handling
// ============================================================================

import React, { useState } from 'react';
import { Alert } from 'react-native';
import * as UpdateManager from './services/UpdateManager';

export function AppWithCustomUpdate() {
  const handleCheckUpdate = async () => {
    try {
      const result = await UpdateManager.checkForUpdate();

      if (result.hasUpdate) {
        Alert.alert(
          'Update Available',
          `Version ${result.latestVersion} is available.\nCurrent: ${result.currentVersion}`,
          [
            {
              text: 'Later',
              onPress: () => console.log('Update postponed'),
              style: 'cancel',
            },
            {
              text: 'Update',
              onPress: () => handlePerformUpdate(),
              style: 'default',
            },
          ]
        );
      } else {
        Alert.alert('Up to Date', 'You already have the latest version');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to check for updates');
    }
  };

  const handlePerformUpdate = async () => {
    try {
      const success = await UpdateManager.performUpdate((progress) => {
        console.log(`Update: ${progress.message} (${progress.progress}%)`);
      });

      if (!success) {
        Alert.alert('Update Failed', 'Please try again later');
      }
    } catch (error) {
      Alert.alert('Error', 'Update installation failed');
    }
  };

  return (
    <TouchableOpacity onPress={handleCheckUpdate}>
      <Text>Check for Updates (Custom)</Text>
    </TouchableOpacity>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  section: {
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#999',
    paddingHorizontal: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
  },
  settingValue: {
    fontSize: 14,
    color: '#999',
  },
});

// ============================================================================
// INTEGRATION STEPS
// ============================================================================

/**
 * To integrate the update feature into your App.tsx:
 *
 * 1. Import the components:
 *    import { useAppUpdate } from './hooks/useAppUpdate';
 *    import { UpdateModal } from './components/UpdateModal';
 *
 * 2. Add to your main App component:
 *    const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();
 *
 * 3. Call checkForUpdate on app launch:
 *    useEffect(() => {
 *      checkForUpdate();
 *    }, []);
 *
 * 4. Add the UpdateModal component to your JSX:
 *    <UpdateModal
 *      visible={showUpdateModal}
 *      onDismiss={() => setShowUpdateModal(false)}
 *    />
 *
 * 5. Rebuild the app:
 *    npm install
 *    npm run android
 *
 * 6. Test by triggering a new build on GitHub Actions:
 *    - Make a commit to main
 *    - The android-build workflow will run
 *    - Once successful, the app will detect the update
 */

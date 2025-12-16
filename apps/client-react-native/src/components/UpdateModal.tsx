import React, { useState, useEffect } from 'react';
import { Modal, ActivityIndicator, ProgressBarAndroid, Platform } from 'react-native';
import { View, Text, TouchableOpacity, ScrollView } from '../themedPrimitives'
import * as UpdateManager from '../services/UpdateManager';

interface UpdateModalProps {
  visible: boolean;
  onDismiss: () => void;
  onUpdateCompleted?: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  onDismiss,
  onUpdateCompleted,
}) => {
  const [stage, setStage] = useState<
    'idle' | 'checking' | 'available' | 'updating' | 'completed' | 'error'
  >('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion?: string;
    latestVersion?: string;
  }>({});

  useEffect(() => {
    if (visible && stage === 'idle') {
      checkForUpdate();
    }
  }, [visible]);

  const checkForUpdate = async () => {
    setStage('checking');
    setProgress(0);
    setMessage('Checking for updates...');
    setError(null);

    const result = await UpdateManager.checkForUpdate();
    setUpdateInfo({
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
    });

    if (result.hasUpdate) {
      setStage('available');
      setMessage(
        `Update available!\nCurrent: ${result.currentVersion}\nLatest: ${result.latestVersion}`
      );
    } else {
      setStage('completed');
      setProgress(100);
      setMessage('App is already up to date');
    }
  };

  const handleUpdate = async () => {
    if (Platform.OS !== 'android') {
      setError('Updates are only available on Android');
      setStage('error');
      return;
    }

    setStage('updating');
    setProgress(0);
    setError(null);

    try {
      await UpdateManager.performUpdate((progressUpdate) => {
        setProgress(Math.round(progressUpdate.progress));
        setMessage(progressUpdate.message);

        if (progressUpdate.error) {
          setError(progressUpdate.error);
        }
      });

      setStage('completed');
      setProgress(100);
      setMessage('Update completed! The app will restart.');

      // Wait a bit before callback
      setTimeout(() => {
        onUpdateCompleted?.();
      }, 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setStage('error');
      setMessage('Update failed');
    }
  };

  const handleDismiss = () => {
    setStage('idle');
    setProgress(0);
    setMessage('');
    setError(null);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}>
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
        <View className="bg-white rounded-xl p-5" style={{ width: '85%', maxHeight: '80%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 }}>
          <Text className="text-lg font-bold mb-4" style={{ color: '#333' }}>App Update</Text>

          <ScrollView style={{ minHeight: 150, marginBottom: 16 }}>
            {stage === 'checking' && (
              <View className="items-center justify-center">
                <ActivityIndicator size="large" color="#0066CC" />
                <Text className="text-base text-center mb-3" style={{ color: '#333', lineHeight: 24 }}>{message}</Text>
              </View>
            )}

            {stage === 'available' && (
              <View className="items-center justify-center">
                <Text className="mb-4" style={{ fontSize: 48 }}>📦</Text>
                <Text className="text-base text-center mb-3" style={{ color: '#333', lineHeight: 24 }}>{message}</Text>
                <Text className="text-sm text-center mt-2" style={{ color: '#666' }}>
                  A new version is available. Would you like to update now?
                </Text>
              </View>
            )}

            {stage === 'updating' && (
              <View className="items-center justify-center">
                <ActivityIndicator size="large" color="#0066CC" />
                <Text className="text-base text-center mb-3" style={{ color: '#333', lineHeight: 24 }}>{message}</Text>
                <View className="mt-4 w-full">
                  <ProgressBarAndroid
                    styleAttr="Horizontal"
                    progress={progress / 100}
                    color="#0066CC"
                  />
                  <Text className="text-center mt-2 font-bold" style={{ color: '#0066CC' }}>{progress}%</Text>
                </View>
              </View>
            )}

            {stage === 'completed' && (
              <View className="items-center justify-center">
                <Text className="mb-4" style={{ fontSize: 48 }}>✓</Text>
                <Text className="text-base text-center mb-3" style={{ color: '#333', lineHeight: 24 }}>{message}</Text>
              </View>
            )}

            {stage === 'error' && (
              <View className="items-center justify-center">
                <Text className="mb-4 text-red-600" style={{ fontSize: 48 }}>✕</Text>
                <Text className="text-base text-center mb-3 text-red-600">{message}</Text>
                {error && <Text className="text-xs text-center mt-2" style={{ color: '#999' }}>{error}</Text>}
              </View>
            )}
          </ScrollView>

          <View className="flex-row justify-end" style={{ columnGap: 12 }}>
            {stage === 'available' && (
              <>
                <TouchableOpacity
                  className="px-4 py-2 rounded-lg items-center"
                  style={{ backgroundColor: '#f0f0f0', minWidth: 100 }}
                  onPress={handleDismiss}>
                  <Text className="font-semibold" style={{ color: '#333' }}>Later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="px-4 py-2 rounded-lg items-center"
                  style={{ backgroundColor: '#0066CC', minWidth: 100 }}
                  onPress={handleUpdate}>
                  <Text className="text-white font-semibold">Update Now</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'checking' && (
              <TouchableOpacity
                className="px-4 py-2 rounded-lg items-center"
                style={{ backgroundColor: '#f0f0f0', minWidth: 100 }}
                onPress={handleDismiss}>
                <Text className="font-semibold" style={{ color: '#333' }}>Cancel</Text>
              </TouchableOpacity>
            )}

            {(stage === 'completed' || stage === 'error') && (
              <TouchableOpacity
                className="px-4 py-2 rounded-lg items-center"
                style={{ backgroundColor: '#0066CC', minWidth: 100 }}
                onPress={handleDismiss}>
                <Text className="text-white font-semibold">Done</Text>
              </TouchableOpacity>
            )}

            {stage === 'idle' && (
              <TouchableOpacity
                className="px-4 py-2 rounded-lg items-center"
                style={{ backgroundColor: '#0066CC', minWidth: 100 }}
                onPress={checkForUpdate}>
                <Text className="text-white font-semibold">Check for Updates</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

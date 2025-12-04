import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ProgressBarAndroid,
  ScrollView,
  Platform,
} from 'react-native';
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
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>App Update</Text>

          <ScrollView style={styles.content}>
            {stage === 'checking' && (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.message}>{message}</Text>
              </View>
            )}

            {stage === 'available' && (
              <View style={styles.centerContent}>
                <Text style={styles.icon}>📦</Text>
                <Text style={styles.message}>{message}</Text>
                <Text style={styles.note}>
                  A new version is available. Would you like to update now?
                </Text>
              </View>
            )}

            {stage === 'updating' && (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.message}>{message}</Text>
                <View style={styles.progressContainer}>
                  <ProgressBarAndroid
                    styleAttr="Horizontal"
                    progress={progress / 100}
                    color="#0066CC"
                  />
                  <Text style={styles.progressText}>{progress}%</Text>
                </View>
              </View>
            )}

            {stage === 'completed' && (
              <View style={styles.centerContent}>
                <Text style={styles.icon}>✓</Text>
                <Text style={styles.message}>{message}</Text>
              </View>
            )}

            {stage === 'error' && (
              <View style={styles.centerContent}>
                <Text style={styles.errorIcon}>✕</Text>
                <Text style={styles.errorMessage}>{message}</Text>
                {error && <Text style={styles.errorDetail}>{error}</Text>}
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            {stage === 'available' && (
              <>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={handleDismiss}>
                  <Text style={styles.cancelButtonText}>Later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.updateButton]}
                  onPress={handleUpdate}>
                  <Text style={styles.updateButtonText}>Update Now</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'checking' && (
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleDismiss}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}

            {(stage === 'completed' || stage === 'error') && (
              <TouchableOpacity
                style={[styles.button, styles.updateButton]}
                onPress={handleDismiss}>
                <Text style={styles.updateButtonText}>Done</Text>
              </TouchableOpacity>
            )}

            {stage === 'idle' && (
              <TouchableOpacity
                style={[styles.button, styles.updateButton]}
                onPress={checkForUpdate}>
                <Text style={styles.updateButtonText}>Check for Updates</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  content: {
    minHeight: 150,
    marginBottom: 16,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
    color: '#FF3B30',
  },
  message: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 24,
  },
  errorMessage: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 12,
  },
  errorDetail: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  note: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  progressContainer: {
    marginTop: 16,
    width: '100%',
  },
  progressText: {
    textAlign: 'center',
    marginTop: 8,
    color: '#0066CC',
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  updateButton: {
    backgroundColor: '#0066CC',
  },
  updateButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});

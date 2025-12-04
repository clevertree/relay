import { useState, useCallback } from 'react';
import * as UpdateManager from '../services/UpdateManager';

export interface UseUpdateResult {
  showUpdateModal: boolean;
  setShowUpdateModal: (show: boolean) => void;
  checkForUpdate: () => Promise<void>;
  isChecking: boolean;
  updateAvailable: boolean;
  performUpdate: () => Promise<void>;
  isUpdating: boolean;
}

/**
 * Hook to manage app updates
 * Usage in your app:
 *   const { showUpdateModal, setShowUpdateModal } = useAppUpdate();
 *   // In your JSX:
 *   <UpdateModal visible={showUpdateModal} onDismiss={() => setShowUpdateModal(false)} />
 */
export function useAppUpdate(): UseUpdateResult {
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const checkForUpdate = useCallback(async () => {
    setIsChecking(true);
    try {
      const result = await UpdateManager.checkForUpdate();
      setUpdateAvailable(result.hasUpdate);
      if (result.hasUpdate) {
        setShowUpdateModal(true);
      }
    } catch (error) {
      console.error('Error checking for update:', error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const performUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      await UpdateManager.performUpdate();
    } catch (error) {
      console.error('Error performing update:', error);
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    showUpdateModal,
    setShowUpdateModal,
    checkForUpdate,
    isChecking,
    updateAvailable,
    performUpdate,
    isUpdating,
  };
}

/**
 * Network Debugging Utilities for React Native
 * 
 * This module provides debugging functions to diagnose network issues in the Android APK
 */

import { NativeModules, Platform } from 'react-native';

export interface NetworkDebugInfo {
  isConnected: boolean;
  connectionType: string;
  isInternetReachable: boolean;
  peers: string[];
  peerReachability: Record<string, boolean>;
  permissions: {
    internet: boolean;
    networkState: boolean;
  };
}

/**
 * Create a fetch with AbortController timeout
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Get comprehensive network debugging information
 */
export async function getNetworkDebugInfo(): Promise<NetworkDebugInfo> {
  const info: NetworkDebugInfo = {
    isConnected: true,
    connectionType: 'unknown',
    isInternetReachable: false,
    peers: [],
    peerReachability: {},
    permissions: {
      internet: false,
      networkState: false,
    },
  };

  try {
    // Get master peer list
    const RelayCore = NativeModules.RelayCore;
    if (RelayCore && typeof RelayCore.getMasterPeerList === 'function') {
      info.peers = await RelayCore.getMasterPeerList();
      console.debug('[NetworkDebug] Got peers from RelayCore:', info.peers);
    }
  } catch (error) {
    console.error('[NetworkDebug] Failed to get peers:', error);
  }

  // Test peer reachability with simple HEAD requests
  for (const peer of info.peers) {
    try {
      const protocol = peer.startsWith('http') ? '' : 'http://';
      const url = `${protocol}${peer}/`;
      
      console.debug(`[NetworkDebug] Testing peer: ${url}`);
      const response = await fetchWithTimeout(url, 5000);
      
      info.peerReachability[peer] = response.ok || response.status < 500;
      console.debug(`[NetworkDebug] Peer ${peer}: ${response.status} ${response.ok ? 'OK' : 'FAIL'}`);
      
      if (response.ok) {
        info.isInternetReachable = true;
      }
    } catch (error) {
      info.peerReachability[peer] = false;
      console.error(`[NetworkDebug] Failed to reach ${peer}:`, error);
    }
  }

  return info;
}

/**
 * Log network debug information to console
 */
export async function logNetworkDebugInfo(): Promise<void> {
  const info = await getNetworkDebugInfo();
  
  console.log('='.repeat(60));
  console.log('NETWORK DEBUG INFO');
  console.log('='.repeat(60));
  console.log('Platform:', Platform.OS);
  console.log('Peers configured:', info.peers.length);
  console.log('Peers:', info.peers.join(', '));
  console.log('Internet reachable:', info.isInternetReachable);
  console.log('');
  console.log('Peer Reachability:');
  for (const [peer, reachable] of Object.entries(info.peerReachability)) {
    console.log(`  ${peer}: ${reachable ? '✓ Reachable' : '✗ Unreachable'}`);
  }
  console.log('='.repeat(60));
}

/**
 * Enhanced logging for fetch calls to diagnose network issues
 */
export function createDebugFetch(label: string = 'FetchDebug') {
  return async (url: string, options?: RequestInit) => {
    console.debug(`[${label}] Fetching: ${url}`);
    console.debug(`[${label}] Method: ${(options?.method || 'GET').toUpperCase()}`);
    
    try {
      const startTime = Date.now();
      const response = await fetchWithTimeout(url, 5000);
      
      const duration = Date.now() - startTime;
      console.debug(`[${label}] Success: ${response.status} ${response.statusText} (${duration}ms)`);
      
      return response;
    } catch (error) {
      const errorStr = error instanceof Error ? error.message : String(error);
      console.error(`[${label}] Failed: ${errorStr}`);
      throw error;
    }
  };
}

/**
 * Test specific peer connectivity
 */
export async function testPeerConnectivity(peer: string, protocol: 'http' | 'https' = 'https'): Promise<boolean> {
  try {
    const url = `${protocol}://${peer}/`;
    console.debug(`[PeerTest] Testing ${peer} on ${protocol}: ${url}`);
    
    const response = await fetchWithTimeout(url, 5000);
    
    const success = response.ok || response.status < 500;
    console.debug(`[PeerTest] Result: ${response.status} - ${success ? 'SUCCESS' : 'FAILED'}`);
    
    return success;
  } catch (error) {
    console.error(`[PeerTest] Exception: ${error}`);
    return false;
  }
}

/**
 * Diagnose network security config issues
 */
export async function diagnoseNetworkSecurity(): Promise<{
  httpAvailable: boolean;
  httpsAvailable: boolean;
  localhostAccessible: boolean;
  recommendations: string[];
}> {
  const diagnosis = {
    httpAvailable: false,
    httpsAvailable: false,
    localhostAccessible: false,
    recommendations: [] as string[],
  };

  // Test HTTP to localhost
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch('http://localhost:3000/', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    diagnosis.httpAvailable = true;
    diagnosis.localhostAccessible = true;
    console.debug('[NetworkSecurity] HTTP localhost: OK');
  } catch (error) {
    console.debug('[NetworkSecurity] HTTP localhost: FAILED');
    diagnosis.recommendations.push(
      'HTTP traffic may be blocked. Create/update network_security_config.xml to allow cleartext for localhost'
    );
  }

  // Test HTTP to 10.0.2.2 (Android emulator)
  if (Platform.OS === 'android') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch('http://10.0.2.2:3000/', {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      diagnosis.httpAvailable = true;
      console.debug('[NetworkSecurity] HTTP 10.0.2.2: OK');
    } catch (error) {
      console.debug('[NetworkSecurity] HTTP 10.0.2.2: FAILED');
      diagnosis.recommendations.push(
        'Cannot reach Android emulator host (10.0.2.2). Check network_security_config.xml'
      );
    }
  }

  // Test HTTPS
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://www.google.com/', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    diagnosis.httpsAvailable = true;
    console.debug('[NetworkSecurity] HTTPS: OK');
  } catch (error) {
    console.debug('[NetworkSecurity] HTTPS: FAILED');
    diagnosis.recommendations.push('HTTPS connections failing. Check certificate pinning or SSL configuration');
  }

  if (!diagnosis.httpAvailable && !diagnosis.httpsAvailable) {
    diagnosis.recommendations.push('No network connectivity detected at all');
  }

  return diagnosis;
}

/**
 * React Native Theme Manager
 * Handles theme detection and application for React Native
 * Uses AsyncStorage for persistence and Appearance API for system preference
 *
 * Usage:
 *   await ThemeManager.initialize() // Call on app startup
 *   await ThemeManager.setTheme('dark') // Switch themes
 *   const theme = await ThemeManager.getTheme() // Get current theme
 */

import { Appearance, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeName = 'light' | 'dark';

interface ThemeManagerState {
  currentTheme: ThemeName;
  listeners: Set<(theme: ThemeName) => void>;
  initialized: boolean;
}

export class ThemeManager {
  private static readonly STORAGE_KEY = 'relay-theme-preference';
  private static readonly DEFAULT_THEME: ThemeName = 'dark';
  private static state: ThemeManagerState = {
    currentTheme: 'dark',
    listeners: new Set(),
    initialized: false,
  };

  /**
   * Initialize theme on app startup
   * Must be called before rendering theme-dependent components
   */
  static async initialize(): Promise<void> {
    if (this.state.initialized) return;

    try {
      const theme = await this.detectTheme();
      this.state.currentTheme = theme;
      this.setupListeners();
      this.state.initialized = true;
      this.notifyListeners();
    } catch (error) {
      console.error('[ThemeManager] Initialization failed:', error);
      this.state.currentTheme = this.DEFAULT_THEME;
    }
  }

  /**
   * Get the current active theme
   */
  static getTheme(): ThemeName {
    return this.state.currentTheme;
  }

  /**
   * Set theme and persist preference
   */
  static async setTheme(theme: ThemeName): Promise<void> {
    if (!this.isValidTheme(theme)) return;

    try {
      await AsyncStorage.setItem(this.STORAGE_KEY, theme);
      this.state.currentTheme = theme;
      this.notifyListeners();
    } catch (error) {
      console.error('[ThemeManager] Failed to set theme:', error);
    }
  }

  /**
   * Subscribe to theme changes
   * Returns unsubscribe function
   */
  static onChange(callback: (theme: ThemeName) => void): () => void {
    this.state.listeners.add(callback);
    return () => this.state.listeners.delete(callback);
  }

  /**
   * Detect the preferred theme based on:
   * 1. Saved user preference in AsyncStorage
   * 2. System preference via Appearance API
   * 3. Default to light theme
   */
  private static async detectTheme(): Promise<ThemeName> {
    // Check for saved preference first
    try {
      const saved = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (saved && this.isValidTheme(saved)) {
        return saved as ThemeName;
      }
    } catch (error) {
      console.warn('[ThemeManager] Failed to read saved preference:', error);
    }

    // Check system preference
    const systemTheme = Appearance.getColorScheme();
    if (systemTheme === 'dark') {
      return 'dark';
    }

    return this.DEFAULT_THEME;
  }

  /**
   * Setup listeners for system appearance changes
   */
  private static setupListeners(): void {
    // Listen for system appearance changes
    const appearanceSubscription = Appearance.addChangeListener(({ colorScheme }) => {
      this.handleSystemAppearanceChange(colorScheme);
    });

    // Store subscription for cleanup if needed
    (this as any)._appearanceSubscription = appearanceSubscription;
  }

  /**
   * Handle system appearance changes
   * Only apply if user hasn't set a preference
   */
  private static async handleSystemAppearanceChange(
    colorScheme: 'light' | 'dark' | null
  ): Promise<void> {
    // Check if user has set a preference
    try {
      const saved = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        // User has a preference, don't override
        return;
      }
    } catch (error) {
      console.warn('[ThemeManager] Failed to check saved preference:', error);
    }

    // No user preference, follow system
    if (colorScheme === 'dark') {
      this.state.currentTheme = 'dark';
    } else if (colorScheme === 'light') {
      this.state.currentTheme = 'light';
    }

    this.notifyListeners();
  }

  /**
   * Notify all listeners of theme change
   */
  private static notifyListeners(): void {
    this.state.listeners.forEach(callback => {
      try {
        callback(this.state.currentTheme);
      } catch (error) {
        console.error('[ThemeManager] Listener error:', error);
      }
    });
  }

  /**
   * Validate theme name
   */
  private static isValidTheme(value: any): value is ThemeName {
    return value === 'light' || value === 'dark';
  }

  /**
   * Toggle between light and dark themes
   */
  static async toggleTheme(): Promise<ThemeName> {
    const newTheme = this.state.currentTheme === 'light' ? 'dark' : 'light';
    await this.setTheme(newTheme);
    return newTheme;
  }

  /**
   * Get theme colors for the current theme
   * This imports from the template color definitions
   * TODO: Fix theme import path or use default colors
   */
  static getColors() {
    // For now, return a default color palette
    return {
      primary: '#3b82f6',
      secondary: '#8b5cf6',
      background: this.state.currentTheme === 'dark' ? '#1f2937' : '#ffffff',
      text: this.state.currentTheme === 'dark' ? '#f3f4f6' : '#1f2937',
    };
  }

  /**
   * Get full theme tokens (colors, spacing, typography)
   * TODO: Fix theme import path or use default tokens
   */
  static getTokens() {
    // Return a basic default token structure
    return {
      colors: this.getColors(),
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
      },
      typography: {
        body: { fontSize: '16px', lineHeight: '1.5' },
        heading: { fontSize: '24px', fontWeight: 'bold', lineHeight: '1.3' },
        small: { fontSize: '12px', lineHeight: '1.4' },
      },
    };
  }

  /**
   * Cleanup resources (for testing or app lifecycle)
   */
  static cleanup(): void {
    if ((this as any)._appearanceSubscription) {
      (this as any)._appearanceSubscription.remove();
    }
    this.state.listeners.clear();
    this.state.initialized = false;
  }
}

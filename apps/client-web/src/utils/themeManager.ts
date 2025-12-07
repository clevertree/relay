/**
 * Web Theme Manager
 * Handles theme detection and application for the web client
 * Uses localStorage for persistence and class-based dark mode
 * 
 * Usage:
 *   ThemeManager.initialize() // Call on app startup
 *   ThemeManager.setTheme('dark') // Switch themes
 *   const theme = ThemeManager.getTheme() // Get current theme
 */

type ThemeName = 'light' | 'dark';

export class ThemeManager {
  private static readonly STORAGE_KEY = 'relay-theme-preference';
  private static readonly DEFAULT_THEME: ThemeName = 'light';
  private static currentTheme: ThemeName = ThemeManager.DEFAULT_THEME;
  private static listeners: Set<(theme: ThemeName) => void> = new Set();

  /**
   * Initialize theme on app startup
   * Detects user preference, system preference, or uses default
   */
  static initialize(): void {
    const theme = this.detectTheme();
    this.applyTheme(theme);
    this.setupMediaQueryListener();
  }

  /**
   * Get the current active theme
   */
  static getTheme(): ThemeName {
    return this.currentTheme;
  }

  /**
   * Set theme and persist preference
   */
  static setTheme(theme: ThemeName): void {
    if (!this.isValidTheme(theme)) return;
    
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.applyTheme(theme);
  }

  /**
   * Subscribe to theme changes
   */
  static onChange(callback: (theme: ThemeName) => void): () => void {
    this.listeners.add(callback);
    // Return unsubscribe function
    return () => this.listeners.delete(callback);
  }

  /**
   * Detect the preferred theme based on:
   * 1. Saved user preference in localStorage
   * 2. System preference via matchMedia
   * 3. Default to light theme
   */
  private static detectTheme(): ThemeName {
    // Check for saved preference first
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved && this.isValidTheme(saved)) {
      return saved as ThemeName;
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return this.DEFAULT_THEME;
  }

  /**
   * Apply theme to the document
   * Uses class-based dark mode (Tailwind convention)
   */
  private static applyTheme(theme: ThemeName): void {
    const html = document.documentElement;

    if (theme === 'dark') {
      html.classList.add('dark');
      html.removeAttribute('data-theme');
    } else {
      html.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
    }

    this.currentTheme = theme;
    
    // Notify listeners
    this.listeners.forEach(callback => callback(theme));
  }

  /**
   * Watch for system preference changes
   * If user hasn't set a preference, respect system changes
   */
  private static setupMediaQueryListener(): void {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Use addEventListener for better browser support
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      // Only apply if no saved preference
      if (!localStorage.getItem(this.STORAGE_KEY)) {
        const theme = e.matches ? 'dark' : 'light';
        this.applyTheme(theme);
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else if ((mediaQuery as any).addListener) {
      // Legacy support
      (mediaQuery as any).addListener(handleChange);
    }
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
  static toggleTheme(): ThemeName {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
    return newTheme;
  }
}

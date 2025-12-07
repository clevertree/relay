/** @type {import('tailwindcss').Config} */
module.exports = {
  // Use 'class' for class-based dark mode (allows manual control)
  // Clients set 'dark' class on root element to enable dark theme
  // See apps/client-web/src/utils/themeManager.ts and
  // apps/client-react-native/src/utils/themeManager.ts for implementation
  darkMode: 'class',
  content: [
    // Template and root files
    './template/**/*.{html,md,js,jsx,tsx,ts}',
    './template/.storybook/**/*.{html,js}',
    './template/site/**/*.js',
    // App files
    './apps/client-web/**/*.{js,ts,jsx,tsx}',
    './apps/client-react-native/**/*.{js,ts,jsx,tsx}',
    // Fallback for spacing classes
    { raw: '<div className="mb-6 mt-6 mb-4 mt-4"></div>' },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        // Named color system (template colors)
        primary: 'var(--color-primary, #2563eb)',
        primaryLight: 'var(--color-primary-light, #3b82f6)',
        primaryDark: 'var(--color-primary-dark, #1d4ed8)',

        bgPrimary: 'var(--color-bg-primary, #ffffff)',
        bgSecondary: 'var(--color-bg-secondary, #f9fafb)',
        bgTertiary: 'var(--color-bg-tertiary, #f3f4f6)',

        textPrimary: 'var(--color-text-primary, #1f2937)',
        textSecondary: 'var(--color-text-secondary, #4b5563)',
        textMuted: 'var(--color-text-muted, #9ca3af)',
        textInverse: 'var(--color-text-inverse, #ffffff)',

        success: 'var(--color-success, #10b981)',
        successDark: 'var(--color-success-dark, #059669)',
        error: 'var(--color-error, #ef4444)',
        errorDark: 'var(--color-error-dark, #dc2626)',
        warning: 'var(--color-warning, #f59e0b)',
        info: 'var(--color-info, #3b82f6)',

        // Legacy light/dark colors (for backward compatibility)
        light: {
          bg: '#ffffff',
          text: '#213547',
          muted: '#646cff',
          border: '#e0e0e0',
        },
        dark: {
          bg: '#1a1a1a',
          text: '#e0e0e0',
          muted: '#a0a0ff',
          border: '#333333',
        },
      },
      spacing: {
        safe: 'max(1rem, env(safe-area-inset-bottom))',
      },
    },
  },
  safelist: [],
  plugins: [],
};


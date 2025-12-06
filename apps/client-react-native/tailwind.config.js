/** @type {import('tailwindcss').Config} */
module.exports = {
  // React Native needs explicit content paths
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './native/**/*.{js,jsx,ts,tsx}',
  ],
  
  theme: {
    extend: {
      colors: {
        // Surface colors
        surface: '#fff',
        'surface-secondary': '#f8f9fa',
        'surface-tertiary': '#f0f0f0',
        
        // Text colors
        'text-primary': '#000',
        'text-secondary': '#666',
        'text-muted': '#999',
        
        // Primary actions
        primary: '#007AFF',
        'primary-dark': '#0051D5',
        
        // Secondary actions
        secondary: '#5856D6',
        
        // Semantic colors
        success: '#34C759',
        warning: '#FF9500',
        error: '#FF3B30',
        info: '#30B0C0',
      },
      spacing: {
        0: '0px',
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      borderRadius: {
        none: '0px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        full: '9999px',
      },
      fontSize: {
        xs: ['11px', '16px'],
        sm: ['12px', '16px'],
        base: ['14px', '20px'],
        lg: ['16px', '22px'],
        xl: ['18px', '24px'],
        '2xl': ['20px', '28px'],
      },
    },
  },
  
  plugins: [],

  // Safelist: limit the classes we pre-generate to avoid bloating bundle
  // React Native doesn't support arbitrary values or complex selectors anyway
  safelist: [
    // Layout utilities
    { pattern: /^(flex|items|justify|gap|p|m|w|h|border)/ },
    // Text utilities
    { pattern: /^(text|font|leading)/ },
    // Sizing
    { pattern: /^(w-|h-|max-w|max-h)/ },
    // Colors
    { pattern: /^(bg-|text-|border-)(primary|secondary|success|warning|error|info|surface|text)/ },
  ],

  // For NativeWind: use 'native' preset
  presets: [
    // Importing is optional; NativeWind will use Tailwind defaults + native transformations
  ],
}

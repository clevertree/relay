/** @type {import('tailwindcss').Config} */
module.exports = {
  // React Native needs explicit content paths
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './native/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    // Responsive breakpoints for tablet/desktop support.
    // NOTE: These are defaults. They can be overridden by a client repo by
    // providing its own tailwind.config.js with different `theme.screens` values.
    // Our RN class map generator will pick up the client config when run there.
    screens: {
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
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
    { pattern: /^(flex|items|justify|content|self|place|gap|space|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|max-w|max-h|min-w|min-h|border)/ },
    // Text utilities
    { pattern: /^(text|font|leading|tracking|underline|decoration)/ },
    // Sizing
    { pattern: /^(w-|h-|max-w|max-h|min-w|min-h)/ },
    // Colors (be liberal so dynamic class strings are covered)
    { pattern: /^(bg-|text-|border-).*/ },
    // Common Tailwind palette colors used by HookRenderer/Markdown (explicit, though covered above)
    { pattern: /^(bg|text|border)-(white|black)$/ },
    { pattern: /^(bg|text|border)-(gray|red|green|blue|yellow|amber|emerald|sky|slate|zinc|neutral|stone)-(100|200|300|400|500|600|700|800|900)$/ },
    // Rounded corners
    { pattern: /^(rounded|rounded-(sm|md|lg|full|t|b|l|r|tl|tr|bl|br))/ },
    // Opacity and overflow
    { pattern: /^(opacity)-(0|5|10|20|25|30|40|50|60|70|75|80|90|95|100)$/ },
    { pattern: /^(overflow|overflow-(hidden|scroll))/ },
    // Positioning
    { pattern: /^(absolute|relative|top|right|bottom|left|inset)/ },
    // Alignment helpers
    { pattern: /^(text-(left|center|right))/ },
    // Forced default list (copied from root safelist) to ensure
    // classes produced by HookRenderer are always compiled for RN.
    'flex', 'flex-col', 'h-full', 'gap-3', 'p-0', 'border-b', 'border-gray-300', 'dark:border-gray-700', 'flex-shrink-0',
    'gap-2', 'p-2', 'flex-1', 'px-2', 'py-2', 'border', 'rounded', 'font-mono', 'text-sm',
    'px-4', 'py-2', 'bg-blue-500', 'hover:bg-blue-600', 'text-white', 'border-none', 'cursor-pointer', 'font-medium',
    'gap-4', 'items-center', 'text-sm', 'dark:border-gray-600', 'bg-white', 'dark:bg-gray-800', 'dark:text-white',
    'ml-auto', 'px-2', 'py-1', 'px-3', 'py-1', 'bg-gray-700', 'hover:bg-gray-800', 'bg-gray-600', 'hover:bg-gray-700',
    'overflow-y-auto'
  ],

  // For NativeWind: use 'native' preset
  presets: [
    // Importing is optional; NativeWind will use Tailwind defaults + native transformations
  ],
}

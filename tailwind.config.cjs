/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  content: [
    './template/**/*.{html,md,js,jsx}',
    './template/.storybook/**/*.{html,js}',
    './template/site/**/*.js',
    { raw: '<div className="mb-6 mt-6 mb-4 mt-4"></div>' }, // Force include spacing classes
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
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
    },
  },
  safelist: [],
  plugins: [],
};

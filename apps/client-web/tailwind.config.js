/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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
  plugins: [],
}

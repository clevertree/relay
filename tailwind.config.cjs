/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './template/**/*.{html,md,js}',
    './template/.storybook/**/*.{html,js}',
    './template/site/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  safelist: [],
  plugins: [],
};

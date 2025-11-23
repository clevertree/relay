/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './template/**/*.html',
    './template/**/*.md',
    './template/site/**/*.js',
    './stories/**/*.css',
    './stories/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  safelist: [
    'movie-card',
    'movie-poster',
    'movie-meta',
    'movie-title',
    'movie-sub',
    'movies-grid'
  ],
  plugins: [],
};

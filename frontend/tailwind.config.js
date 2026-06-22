/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        shtuka: {
          added: '#e6ffec',
          'added-strong': '#abf2bc',
          deleted: '#ffeef0',
          'deleted-strong': '#ff9b9b',
          modified: '#fff8c5',
          'modified-strong': '#fae17d',
        },
      },
      fontFamily: {
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

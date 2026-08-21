import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        teal: '#0B817A',
        page: '#F7F9F8',
        ink: '#13201D',
        error: '#B64C45',
      },
    },
  },
  plugins: [],
};

export default config;

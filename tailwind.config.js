/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf7',
          100: '#d8f3eb',
          500: '#1f8a70',
          700: '#166a57'
        }
      },
      boxShadow: {
        card: '0 16px 40px rgba(14, 36, 31, 0.14)'
      }
    }
  },
  plugins: []
};

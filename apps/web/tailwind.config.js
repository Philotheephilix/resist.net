/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'wld-gray-900': 'var(--wld-gray-900)',
        'wld-gray-700': 'var(--wld-gray-700)',
        'wld-gray-100': 'var(--wld-gray-100)',
        'wld-gray-0': 'var(--wld-gray-0)',
        'wld-success': 'var(--wld-success-600)',
        'wld-error': 'var(--wld-error-600)',
        'wld-warning': 'var(--wld-warning-600)',
        'wld-info': 'var(--wld-info-600)',
      },
      fontFamily: {
        sans: ['TWK Lausanne', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

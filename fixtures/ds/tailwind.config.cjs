// Fixture Tailwind config (CommonJS, like a real project). Generic palette, not from any real app.
module.exports = {
  theme: {
    extend: {
      colors: {
        page: '#f5f6f8', surface: '#fcfcfd', line: '#e2e5ea', ink: '#1f2430', dim: '#6b7280',
        accent: { DEFAULT: '#2f6fed' }, muted: '#e8ebf0', white: '#ffffff', black: '#000000',
      },
      borderRadius: { md: '8px', lg: '12px', xl: '16px', pill: '9999px' },
      spacing: { '0.5': '2px', 1: '4px', '1.5': '6px', 2: '8px', '2.5': '10px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
    },
  },
};

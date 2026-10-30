import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 100: '#D9F3EE', 500: '#0F9D8A', 600: '#0B7A6B', 700: '#086055' },
        accent: { 100: '#DBEAFE', 500: '#2563EB', 600: '#1D4ED8' },
        ink: { 900: '#111827', 700: '#374151', 500: '#6B7280', 300: '#D1D5DB' },
        bg: '#F5F7FA',
        surface: '#FFFFFF',
        success: '#16A34A',
        danger: { DEFAULT: '#DC2626', 500: '#EF4444', 600: '#DC2626' },
        warning: { DEFAULT: '#F59E0B', 500: '#F59E0B', 600: '#D97706' },
      },
      fontFamily: {
        display: ['Poppins', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        display: ['32px', { lineHeight: '40px', fontWeight: '700' }],
        h1: ['28px', { lineHeight: '36px', fontWeight: '700' }],
        h2: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h3: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px' }],
        small: ['14px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        amount: ['24px', { lineHeight: '32px', fontWeight: '700' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
      boxShadow: {
        sm: '0 1px 2px rgba(17,24,39,.06)',
        md: '0 4px 12px rgba(17,24,39,.08)',
        lg: '0 12px 32px rgba(17,24,39,.12)',
      },
      spacing: { 18: '4.5rem', 22: '5.5rem' },
      screens: { xs: '360px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
    },
  },
  plugins: [],
} satisfies Config;

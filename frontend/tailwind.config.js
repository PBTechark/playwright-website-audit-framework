import defaultTheme from 'tailwindcss/defaultTheme';

/** Theme colours are CSS variables (see src/index.css) so light and dark mode share one set of class names. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next Variable"', ...defaultTheme.fontFamily.sans],
        mono: ['"Atkinson Hyperlegible Mono Variable"', ...defaultTheme.fontFamily.mono]
      },
      fontSize: {
        // A 1.2 modular scale around a 16px body.
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
        lg: ['1.1875rem', { lineHeight: '1.75rem' }],
        xl: ['1.4375rem', { lineHeight: '2rem' }],
        '2xl': ['1.875rem', { lineHeight: '2.375rem' }],
        '3xl': ['2.25rem', { lineHeight: '2.75rem' }]
      },
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        sunken: token('sunken'),
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        bar: token('bar'),
        accent: { DEFAULT: token('accent'), strong: token('accent-strong'), soft: token('accent-soft'), ink: token('accent-ink') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        // Severity uses the fixed status palette; it is always shown with an icon and a text label.
        severity: {
          critical: '#d03b3b',
          high: '#ec835a',
          medium: '#fab219',
          low: '#3987e5'
        }
      },
      borderRadius: {
        // Containers 12px, controls 8px, chips 6px: radius follows hierarchy.
        container: '0.75rem',
        control: '0.5rem',
        chip: '0.375rem'
      }
    }
  },
  plugins: []
};

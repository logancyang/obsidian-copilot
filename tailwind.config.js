// tailwind.config.js

import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./src/styles/tailwind.css"],
  darkMode: ["class", '[data-theme="dark"]'],
  plugins: [tailwindcssAnimate],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        border: "var(--background-modifier-border)",
        input: "var(--background-modifier-form-field)",
        ring: "var(--interactive-accent)",
        background: "var(--background-primary)",
        foreground: "var(--text-normal)",
        primary: {
          DEFAULT: "var(--interactive-accent)",
          foreground: "var(--text-on-accent)",
        },
        secondary: {
          DEFAULT: "var(--background-secondary)",
          foreground: "var(--text-normal)",
        },
        destructive: {
          DEFAULT: "var(--background-modifier-error)",
          foreground: "var(--text-error)",
        },
        muted: {
          DEFAULT: "var(--background-secondary-alt)",
          foreground: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--interactive-accent-hover)",
          foreground: "var(--text-on-accent)",
        },
        popover: {
          DEFAULT: "var(--background-primary)",
          foreground: "var(--text-normal)",
        },
        card: {
          DEFAULT: "var(--background-secondary)",
          foreground: "var(--text-normal)",
        },
      },
      borderRadius: {
        lg: "var(--radius-l)", // 12px
        md: "var(--radius-m)", // 8px
        sm: "var(--radius-s)", // 4px
      },
      spacing: {
        1: "var(--size-4-1)", // 4px
        2: "var(--size-4-2)",
        3: "var(--size-4-3)",
        4: "var(--size-4-4)",
        5: "var(--size-4-5)",
        6: "var(--size-4-6)",
      },
      cursor: {
        default: "var(--cursor)",
        auto: "var(--cursor)",
        pointer: "var(--cursor-link)",
      },
    },
  },
};

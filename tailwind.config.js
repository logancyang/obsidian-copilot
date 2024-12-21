// tailwind.config.js

import tailwindcssAnimate from "tailwindcss-animate";
import { colorOpacityPlugin } from "./src/lib/plugins/colorOpacityPlugin";
import colors from "tailwindcss/colors";

/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./src/styles/tailwind.css"],
  darkMode: ["class", '[data-theme="dark"]'],
  plugins: [tailwindcssAnimate, colorOpacityPlugin],
  corePlugins: {
    preflight: false,
  },
  theme: {
    colors: {
      inherit: colors.inherit,
      current: colors.current,
      transparent: colors.transparent,
      black: colors.black,
      white: colors.white,
      // slate: colors.slate,
      // gray: colors.gray,
      // zinc: colors.zinc,
      // neutral: colors.neutral,
      // stone: colors.stone,
      red: colors.red,
      // orange: colors.orange,
      // amber: colors.amber,
      yellow: colors.yellow,
      // lime: colors.lime,
      // green: colors.green,
      // emerald: colors.emerald,
      // teal: colors.teal,
      // cyan: colors.cyan,
      // sky: colors.sky,
      // blue: colors.blue,
      // indigo: colors.indigo,
      // violet: colors.violet,
      // purple: colors.purple,
      // fuchsia: colors.fuchsia,
      // pink: colors.pink,
      // rose: colors.rose,
      input: "var(--ob-bg-primary-alt)",
      ring: "var(--ob-interactive-accent)",
      background: "var(--ob-bg-primary)",
      foreground: "var(--ob-text-normal)",
      primary: {
        DEFAULT: "var(--ob-interactive-accent)",
        foreground: "var(--ob-text-on-accent)",
      },
      secondary: {
        DEFAULT: "var(--ob-bg-secondary)",
        foreground: "var(--ob-text-normal)",
      },
      destructive: {
        DEFAULT: "var(--ob-bg-modifier-error)",
        foreground: "var(--ob-bg-primary)", // todo
      },
      muted: {
        DEFAULT: "var(--ob-bg-primary-alt)",
        foreground: "var(--ob-text-muted)",
      },
      accent: {
        DEFAULT: "var(--ob-interactive-accent)",
        foreground: "var(--ob-text-on-accent)",
      },
      border: {
        DEFAULT: "var(--ob-bg-modifier-border)",
        hover: "var(--ob-bg-modifier-border-hover)",
        focus: "var(--ob-bg-modifier-border-focus)",
      },
      popover: {
        DEFAULT: "var(--ob-bg-primary)", // TODO: primary 或者 primary-alt 都可以
        // DEFAULT: "var(--ob-bg-primary-alt)",
        foreground: "var(--ob-text-normal)",
      },
      card: {
        DEFAULT: "var(--ob-bg-primary)",
        foreground: "var(--ob-text-normal)",
      },
    },
    extend: {
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
        5.5: "calc(var(--size-4-5) + 2px)",
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

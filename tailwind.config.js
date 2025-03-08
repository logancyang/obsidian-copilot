// tailwind.config.js

import tailwindcssAnimate from "tailwindcss-animate";
import { colorOpacityPlugin } from "./src/lib/plugins/colorOpacityPlugin";
import colors from "tailwindcss/colors";
import containerQueries from "@tailwindcss/container-queries";

/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./src/styles/tailwind.css"],
  darkMode: ["class"],
  plugins: [tailwindcssAnimate, colorOpacityPlugin, containerQueries],
  corePlugins: {
    preflight: false,
  },
  // https://github.com/tailwindlabs/tailwindcss/blob/main/stubs/config.full.js
  theme: {
    textColor: {
      inherit: colors.inherit,
      current: colors.current,
      transparent: colors.transparent,
      normal: "var(--text-normal)",
      muted: "var(--text-muted)",
      faint: "var(--text-faint)",
      "on-accent": "var(--text-on-accent)",
      "on-accent-inverted": "var(--text-on-accent-inverted)",
      success: "var(--text-success)",
      warning: "var(--text-warning)",
      error: "var(--text-error)",
      accent: "var(--text-accent)",
      "accent-hover": "var(--text-accent-hover)",
      selection: "var(--text-selection)",
      "highlight-bg": "var(--text-highlight-bg)",
      callout: {
        warning: "rgba(var(--callout-warning),<alpha-value>)",
      },
      "model-capabilities": {
        green: "var(--color-green)",
        blue: "var(--color-blue)",
      },
    },
    backgroundColor: {
      inherit: colors.inherit,
      current: colors.current,
      transparent: colors.transparent,
      primary: "var(--background-primary)",
      "primary-alt": "var(--background-primary-alt)",
      secondary: "var(--background-secondary)",
      "secondary-alt": "var(--background-secondary-alt)",
      success: "rgba(var(--color-green-rgb),0.2)",
      error: "rgba(var(--color-red-rgb),0.2)",
      modifier: {
        hover: "var(--background-modifier-hover)",
        "active-hover": "var(--background-modifier-active-hover)",

        error: "var(--background-modifier-error)",
        "error-rgb": "rgba(var(--background-modifier-error-rgb),<alpha-value>)",
        "error-hover": "var(--background-modifier-error-hover)",
        success: "var(--background-modifier-success)",
        "success-rgb": "rgba(var(--background-modifier-success-rgb),<alpha-value>)",
        message: "var(--background-modifier-message)",
        "form-field": "var(--background-form-field)",
      },
      interactive: {
        normal: "var(--interactive-normal)",
        hover: "var(--interactive-hover)",
        accent: "var(--interactive-accent)",
        "accent-hsl": "hsl(var(--interactive-accent-hsl),<alpha-value>)",
        "accent-hover": "var(--interactive-accent-hover)",
      },
      dropdown: {
        DEFAULT: "var(--dropdown-background)",
        blend: "var(--dropdown-background-blend-mode)",
        hover: "var(--dropdown-background-hover)",
      },
      callout: {
        warning: "rgba(var(--callout-warning),<alpha-value>)",
      },
      overlay: {
        DEFAULT: "#000",
      },
      toggle: {
        thumb: "var(--toggle-thumb-color)",
      },
    },
    borderColor: {
      inherit: colors.inherit,
      current: colors.current,
      transparent: colors.transparent,
      border: "var(--background-modifier-border)",
      "border-hover": "var(--background-modifier-border-hover)",
      "border-focus": "var(--background-modifier-border-focus)",
      "interactive-accent": "var(--interactive-accent)",
    },
    ringColor: {
      ring: "var(--interactive-accent)",
    },
    ringOffsetColor: {
      ring: "var(--interactive-accent)",
    },

    colors: {
      inherit: colors.inherit,
      current: colors.current,
      transparent: colors.transparent,

      // preDefine CSS variables in Obsidian.(https://docs.obsidian.md/Reference/CSS+variables/Foundations/Colors)
      base: {
        "00": "var(--color-base-00)",
        "05": "var(--color-base-05)",
        10: "var(--color-base-10)",
        20: "var(--color-base-20)",
        25: "var(--color-base-25)",
        30: "var(--color-base-30)",
        35: "var(--color-base-35)",
        40: "var(--color-base-40)",
        50: "var(--color-base-50)",
        60: "var(--color-base-60)",
        70: "var(--color-base-70)",
        100: "var(--color-base-100)",
      },
      red: "var(--color-red)",
      "red-rgb": "rgba(var(--color-red-rgb),<alpha-value>)",
      orange: "var(--color-orange)",
      "orange-rgb": "rgba(var(--color-orange-rgb),<alpha-value>)",
      yellow: "var(--color-yellow)",
      "yellow-rgb": "rgba(var(--color-yellow-rgb),<alpha-value>)",
      green: "var(--color-green)",
      "green-rgb": "rgba(var(--color-green-rgb),<alpha-value>)",
      cyan: "var(--color-cyan)",
      "cyan-rgb": "rgba(var(--color-cyan-rgb),<alpha-value>)",
      blue: "var(--color-blue)",
      "blue-rgb": "rgba(var(--color-blue-rgb),<alpha-value>)",
      purple: "var(--color-purple)",
      "purple-rgb": "rgba(var(--color-purple-rgb),<alpha-value>)",
      pink: "var(--color-pink)",
      "pink-rgb": "rgba(var(--color-pink-rgb),<alpha-value>)",
      gray: "var(--color-gray)",
      "mono-rgb": {
        0: "rgba(var(--mono-rgb-0),<alpha-value>)",
        100: "rgba(var(--mono-rgb-100),<alpha-value>)",
      },

      caret: "var(--caret-color)",
      icon: {
        DEFAULT: "var(--icon-color)",
        hover: "var(--icon-color-hover)",
        active: "var(--icon-color-active)",
        focused: "var(--icon-color-focused)",
      },
    },
    borderWidth: {
      DEFAULT: "var(--border-width)",
    },
    zIndex: {
      cover: "var(--layer-cover)", // 5
      sidedock: "var(--layer-sidedock)", // 10
      "status-bar": "var(--layer-status-bar)", // 15
      popover: "var(--layer-popover)", // 30
      slides: "var(--layer-slides)", // 45
      modal: "var(--layer-modal)", // 50
      notice: "var(--layer-notice)", // 60
      menu: "var(--layer-menu)", // 65
      tooltip: "var(--layer-tooltip)", // 70
      "dragged-item": "var(--layer-dragged-item)", // 80
    },
    fontWeight: {
      thin: "var(--font-thin)", // 100
      extralight: "var(--font-extralight)", // 200
      light: "var(--font-light)", // 300
      normal: "var(--font-normal)", // 400
      medium: "var(--font-medium)", // 500
      semibold: "var(--font-semibold)", // 600
      bold: "var(--font-bold)", // 700
      extrabold: "var(--font-extrabold)", // 800
      black: "var(--font-black)", // 900
    },
    extend: {
      borderRadius: {
        "clickable-icon": "var(--clickable-icon-radius)",
        xl: "var(--radius-xl)", // 16px
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
        DEFAULT: "var(--cursor)",
        auto: "var(--cursor)",
        pointer: "var(--cursor-link)",
      },
      fontSize: {
        text: "var(--font-text-size)", // 16px
        smallest: "var(--font-smallest)", // 0.8em
        smaller: "var(--font-smaller)", // 0.875em
        small: "var(--font-small)", // 0.933em
        "ui-smaller": "var(--font-ui-smaller)", // 12px
        "ui-small": "var(--font-ui-small)", // 13px
        "ui-medium": "var(--font-ui-medium)", // 15px
        "ui-larger": "var(--font-ui-larger)", // 20px
      },
      strokeWidth: {
        icon: "var(--icon-stroke)", // 1.75px
        "icon-xs": "var(--icon-xs-stroke-width)", // 2px
        "icon-s": "var(--icon-s-stroke-width)", // 2px
        "icon-m": "var(--icon-m-stroke-width)", // 1.75px
        "icon-l": "var(--icon-l-stroke-width)", // 1.75px
        "icon-xl": "var(--icon-xl-stroke-width)", // 1.25px
      },
      lineHeight: {
        normal: "var(--line-height-normal)", // 1.5
        tight: "var(--line-height-tight)", // 1.3
      },
      size: {
        icon: "var(--icon-size)", // 18px
        "icon-xs": "var(--icon-xs)", // 14px
        "icon-s": "var(--icon-s)", // 16px
        "icon-m": "var(--icon-m)", // 18px
        "icon-l": "var(--icon-l)", // 18px
        "icon-xl": "var(--icon-xl)", // 32px
        checkbox: "var(--checkbox-size)", //
      },
      opacity: {
        icon: "var(--icon-opacity)", // 0.85
        "icon-hover": "var(--icon-opacity-hover)", // 1
        "icon-active": "var(--icon-opacity-active)", // 1
      },
    },
  },
};

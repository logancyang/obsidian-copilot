import plugin from "tailwindcss/plugin";

// Types
interface ColorValue {
  DEFAULT?: string;
  [key: string]: string | ColorValue | undefined;
}

type ColorProperty = "background-color" | "border-color" | "color";

// Color Utilities
const getColorMixValue = (color: string, opacity: number): string => {
  return `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
};

// Class Name Utilities
const getPropertyPrefix = (property: ColorProperty): string => {
  const prefixMap: Record<ColorProperty, string> = {
    "background-color": "bg",
    "border-color": "border",
    color: "text",
  };
  return prefixMap[property];
};

// Utility Generator
const generateUtility =
  (e: any) => (property: ColorProperty, name: string, color: string, opacity: number) => {
    const prefix = getPropertyPrefix(property);
    const className = `${prefix}-${name}/${opacity}`;

    return {
      [`.${e(className)}`]: {
        [property]: getColorMixValue(color, opacity),
      },
    };
  };

// Color Processing
const generateAllUtilities = (e: any) => (color: string, name: string, opacity: number) => {
  const properties: ColorProperty[] = ["background-color", "border-color", "color"];
  const utilities = properties.map((property) =>
    generateUtility(e)(property, name, color, opacity)
  );

  return Object.assign({}, ...utilities);
};

const generateOpacityClasses =
  (e: any, opacityUtilities: Record<string, any>) => (color: string, name: string) => {
    Array.from({ length: 10 }, (_, i) => (i + 1) * 10).forEach((opacity) => {
      Object.assign(opacityUtilities, generateAllUtilities(e)(color, name, opacity));
    });
  };

const processColorObject =
  (e: any, opacityUtilities: Record<string, any>) =>
  (colorValue: string | ColorValue, baseName: string, parentPath: string[] = []) => {
    const currentPath = [...parentPath, baseName];

    if (typeof colorValue === "string") {
      if (colorValue.startsWith("var(--")) {
        if (colorValue.includes("-rgb")) {
          return;
        }
        const colorName = currentPath.join("-");
        generateOpacityClasses(e, opacityUtilities)(colorValue, colorName);
      }
    } else if (typeof colorValue === "object" && colorValue !== null) {
      Object.entries(colorValue).forEach(([key, value]) => {
        const nextBaseName = key === "DEFAULT" ? "" : key;
        const nextPath = nextBaseName ? currentPath : currentPath.slice(0, -1);
        value && processColorObject(e, opacityUtilities)(value, nextBaseName, nextPath);
      });
    }
  };

/**
 * Tailwind plugin for adding color opacity support using color-mix
 * Supports deeply nested color objects and variants
 *
 * Examples:
 * bg-primary/20 -> .bg-primary\/20 { background-color: color-mix(in srgb, var(--interactive-accent) 20%, transparent); }
 * bg-modifier-error/50
 * text-background-modifier-success/30
 */
export const colorOpacityPlugin = plugin(function ({ addUtilities, theme, e }) {
  const opacityUtilities: Record<string, any> = {};

  // 处理所有颜色相关的主题配置
  const processThemeColors = (themeKey: string, prefix?: string) => {
    const colors = theme(themeKey) as Record<string, string | ColorValue>;
    Object.entries(colors).forEach(([colorName, colorValue]) => {
      const baseName = prefix ? `${prefix}-${colorName}` : colorName;
      processColorObject(e, opacityUtilities)(colorValue, baseName);
    });
  };

  // 处理所有颜色配置
  processThemeColors("textColor", "");
  processThemeColors("backgroundColor", "");
  processThemeColors("borderColor", "");
  processThemeColors("colors");

  addUtilities(opacityUtilities);
});

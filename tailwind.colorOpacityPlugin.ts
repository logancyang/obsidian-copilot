import plugin from "tailwindcss/plugin";
import type { CSSRuleObject } from "tailwindcss/types/config";

interface ColorValue {
  DEFAULT?: string;
  [key: string]: string | ColorValue | undefined;
}

type ColorProperty = "background-color" | "border-color" | "color";

const getColorMixValue = (color: string, opacity: number): string => {
  return `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
};

const getPropertyPrefix = (property: ColorProperty): string => {
  const prefixMap: Record<ColorProperty, string> = {
    "background-color": "bg",
    "border-color": "border",
    color: "text",
  };
  return prefixMap[property];
};

const generateUtility =
  (e: (className: string) => string) =>
  (property: ColorProperty, name: string, color: string, opacity: number) => {
    const prefix = getPropertyPrefix(property);
    const className = `${prefix}-${name}/${opacity}`;

    return {
      [`.${e(className)}`]: {
        [property]: getColorMixValue(color, opacity),
      },
    };
  };

const generateAllUtilities =
  (e: (className: string) => string) => (color: string, name: string, opacity: number) => {
    const properties: ColorProperty[] = ["background-color", "border-color", "color"];
    const utilities = properties.map((property) =>
      generateUtility(e)(property, name, color, opacity)
    );

    return Object.assign({}, ...utilities) as CSSRuleObject;
  };

const generateOpacityClasses =
  (e: (className: string) => string, opacityUtilities: CSSRuleObject) =>
  (color: string, name: string) => {
    Array.from({ length: 10 }, (_, i) => (i + 1) * 10).forEach((opacity) => {
      Object.assign(opacityUtilities, generateAllUtilities(e)(color, name, opacity));
    });
  };

const processColorObject =
  (e: (className: string) => string, opacityUtilities: CSSRuleObject) =>
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
        if (value) {
          processColorObject(e, opacityUtilities)(value, nextBaseName, nextPath);
        }
      });
    }
  };

export const colorOpacityPlugin = plugin((api) => {
  const { theme, e } = api;
  const opacityUtilities: CSSRuleObject = {};

  const processThemeColors = (themeKey: string, prefix?: string) => {
    const colors: Record<string, string | ColorValue> = theme(themeKey);
    Object.entries(colors).forEach(([colorName, colorValue]) => {
      const baseName = prefix ? `${prefix}-${colorName}` : colorName;
      processColorObject(e, opacityUtilities)(colorValue, baseName);
    });
  };

  processThemeColors("textColor", "");
  processThemeColors("backgroundColor", "");
  processThemeColors("borderColor", "");
  processThemeColors("colors");

  api.addUtilities(opacityUtilities);
});

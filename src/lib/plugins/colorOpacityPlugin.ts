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
  (colorValue: string | ColorValue, baseName: string) => {
    if (typeof colorValue === "string" && colorValue.startsWith("var(--")) {
      generateOpacityClasses(e, opacityUtilities)(colorValue, baseName);
    } else if (typeof colorValue === "object") {
      Object.entries(colorValue).forEach(([variantKey, variantValue]) => {
        if (typeof variantValue === "string" && variantValue.startsWith("var(--")) {
          const fullColorName = variantKey === "DEFAULT" ? baseName : `${baseName}-${variantKey}`;
          generateOpacityClasses(e, opacityUtilities)(variantValue, fullColorName);
        }
      });
    }
  };

/**
 * Tailwind plugin for adding color opacity support using color-mix
 * Supports nested color objects with variants like foreground
 *
 * eg: bg-primary/20 -> .bg-primary\/20 { background-color: color-mix(in srgb, var(--interactive-accent) 20%, transparent); }
 */
export const colorOpacityPlugin = plugin(function ({ addUtilities, theme, e }) {
  const opacityUtilities: Record<string, any> = {};
  const colors = theme("colors") as Record<string, string | ColorValue>;

  // Process all colors
  Object.entries(colors).forEach(([colorName, colorValue]) => {
    processColorObject(e, opacityUtilities)(colorValue, colorName);
  });

  addUtilities(opacityUtilities);
});

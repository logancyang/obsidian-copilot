type StyleRecord = Record<string, string | number | undefined>;

interface ElementState {
  properties: Set<string>;
  prefix?: string;
}

const elementState = new WeakMap<HTMLElement, ElementState>();

function toKebabCase(property: string): string {
  if (property.startsWith("--")) return property;
  return property
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

const UNITLESS_CSS_PROPERTIES = new Set([
  "z-index",
  "zIndex",
  "opacity",
  "flex",
  "flex-grow",
  "flexGrow",
  "flex-shrink",
  "flexShrink",
  "font-weight",
  "fontWeight",
  "line-height",
  "lineHeight",
  "order",
  "orphans",
  "widows",
  "tab-size",
  "tabSize",
  "column-count",
  "columnCount",
]);

function normalizeStyles(styles: StyleRecord): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined || value === null) continue;
    const cssProperty = toKebabCase(property);
    let stringValue: string;
    if (typeof value === "number" && !property.startsWith("--")) {
      const isUnitless =
        UNITLESS_CSS_PROPERTIES.has(property) || UNITLESS_CSS_PROPERTIES.has(cssProperty);
      stringValue = isUnitless ? String(value) : `${value}px`;
    } else {
      stringValue = String(value);
    }
    normalized.set(cssProperty, stringValue);
  }
  return normalized;
}

function removePrefixedClasses(element: HTMLElement, prefix: string): void {
  if (!prefix) return;
  const prefixPattern = `${prefix}-`;
  const classesToRemove = Array.from(element.classList).filter((className) =>
    className.startsWith(prefixPattern)
  );
  classesToRemove.forEach((className) => {
    element.classList.remove(className);
  });
}

export function updateDynamicStyleClass(
  element: HTMLElement,
  prefix: string,
  styles: StyleRecord
): void {
  if (!element) return;

  const normalized = normalizeStyles(styles);
  const previousState = elementState.get(element);

  if (previousState && previousState.prefix && previousState.prefix !== prefix) {
    removePrefixedClasses(element, previousState.prefix);
  }

  const previousProperties = previousState?.properties ?? new Set<string>();
  const nextProperties = new Set<string>();
  const propsToApply: Record<string, string> = {};

  previousProperties.forEach((property) => {
    if (!normalized.has(property)) {
      propsToApply[property] = "";
    }
  });

  normalized.forEach((value, property) => {
    propsToApply[property] = value;
    nextProperties.add(property);
  });

  if (Object.keys(propsToApply).length > 0) {
    element.setCssProps(propsToApply);
  }

  if (nextProperties.size === 0) {
    elementState.delete(element);
    return;
  }

  elementState.set(element, { properties: nextProperties, prefix });
}

export function clearDynamicStyleClass(element: HTMLElement): void {
  const state = elementState.get(element);
  if (!state) return;

  const cleared: Record<string, string> = {};
  state.properties.forEach((property) => {
    cleared[property] = "";
  });
  if (Object.keys(cleared).length > 0) {
    element.setCssProps(cleared);
  }
  if (state.prefix) {
    removePrefixedClasses(element, state.prefix);
  }
  elementState.delete(element);
}

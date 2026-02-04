/**
 * Dynamic style manager for overlay positioning.
 * Manages inline styles on elements with automatic cleanup.
 */

type StyleRecord = Record<string, string | number | undefined>;

interface ElementState {
  properties: Set<string>;
  prefix?: string;
}

const elementState = new WeakMap<HTMLElement, ElementState>();

/**
 * Converts camelCase property names to kebab-case CSS properties.
 */
function toKebabCase(property: string): string {
  if (property.startsWith("--")) return property;
  return property
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/**
 * CSS properties that should not have 'px' appended when given as numbers.
 * These are unitless properties in CSS.
 */
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

/**
 * Normalizes style values, converting numbers to pixel values for length properties.
 * Unitless CSS properties (z-index, opacity, flex, etc.) are not given 'px' suffix.
 */
function normalizeStyles(styles: StyleRecord): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined || value === null) continue;
    const cssProperty = toKebabCase(property);
    let stringValue: string;
    if (typeof value === "number" && !property.startsWith("--")) {
      // Check both camelCase and kebab-case versions for unitless properties
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

/**
 * Removes classes with a specific prefix from an element.
 */
function removePrefixedClasses(element: HTMLElement, prefix: string): void {
  if (!prefix) return;
  const prefixPattern = `${prefix}-`;
  // P2 Fix: Convert to array first to avoid modifying classList while iterating
  const classesToRemove = Array.from(element.classList).filter((className) =>
    className.startsWith(prefixPattern)
  );
  classesToRemove.forEach((className) => {
    element.classList.remove(className);
  });
}

/**
 * Updates dynamic styles on an element, tracking which properties were set
 * for proper cleanup later.
 *
 * @param element - The element to style
 * @param prefix - A prefix for class-based cleanup
 * @param styles - Style properties to apply
 */
export function updateDynamicStyleClass(
  element: HTMLElement,
  prefix: string,
  styles: StyleRecord
): void {
  if (!element) return;

  const normalized = normalizeStyles(styles);
  const previousState = elementState.get(element);

  // P2 Fix: When prefix changes, clean up the OLD prefix classes, not the new one
  if (previousState && previousState.prefix && previousState.prefix !== prefix) {
    removePrefixedClasses(element, previousState.prefix);
  }

  const previousProperties = previousState?.properties ?? new Set<string>();
  const nextProperties = new Set<string>();

  // Remove properties that are no longer present
  previousProperties.forEach((property) => {
    if (!normalized.has(property)) {
      element.style.removeProperty(property);
    }
  });

  // Apply current styles
  normalized.forEach((value, property) => {
    element.style.setProperty(property, value);
    nextProperties.add(property);
  });

  if (nextProperties.size === 0) {
    elementState.delete(element);
    return;
  }

  elementState.set(element, { properties: nextProperties, prefix });
}

/**
 * Clears all dynamic styles from an element.
 */
export function clearDynamicStyleClass(element: HTMLElement): void {
  const state = elementState.get(element);
  if (!state) return;

  state.properties.forEach((property) => {
    element.style.removeProperty(property);
  });
  if (state.prefix) {
    removePrefixedClasses(element, state.prefix);
  }
  elementState.delete(element);
}

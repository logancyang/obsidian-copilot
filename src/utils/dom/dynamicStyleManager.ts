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
 * Normalizes style values, converting numbers to pixel values.
 */
function normalizeStyles(styles: StyleRecord): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined || value === null) continue;
    const cssProperty = toKebabCase(property);
    const stringValue =
      typeof value === "number" && !property.startsWith("--") ? `${value}px` : String(value);
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
  element.classList.forEach((className) => {
    if (className.startsWith(prefixPattern)) {
      element.classList.remove(className);
    }
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

  if (!previousState || previousState.prefix !== prefix) {
    removePrefixedClasses(element, prefix);
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

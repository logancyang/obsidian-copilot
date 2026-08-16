export type AuditCheck =
  | "contrast"
  | "off-token-color"
  | "overflow"
  | "render-failure"
  | "unsupported-color"
  | "zero-size";

export interface AuditFinding {
  check: AuditCheck;
  detail: string;
  story: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  theme: string;
  width: number;
}

interface Color {
  a: number;
  b: number;
  g: number;
  r: number;
}

const COLOR_TOKEN_NAME =
  /(?:color|background|text|interactive|accent|icon|link|tag|code|canvas|graph|input|divider|border)/i;
const NORMAL_TEXT_CONTRAST_RATIO = 4.5;
const LARGE_TEXT_CONTRAST_RATIO = 3;

function parseComputedColor(value: string): Color | null {
  const colorFunction = value
    .trim()
    .match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/i);
  if (colorFunction) {
    const alphaValue = colorFunction[4] ?? "1";
    const alpha = Number.parseFloat(alphaValue) / (alphaValue.endsWith("%") ? 100 : 1);
    const color = {
      r: Number.parseFloat(colorFunction[1]) * 255,
      g: Number.parseFloat(colorFunction[2]) * 255,
      b: Number.parseFloat(colorFunction[3]) * 255,
      a: alpha,
    };
    return Object.values(color).every(Number.isFinite) && alpha >= 0 ? color : null;
  }

  const match = value.trim().match(/^rgba?\((.*)\)$/i);
  if (!match) {
    return null;
  }
  const parts = match[1]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const channel = (part: string): number => {
    const parsed = Number.parseFloat(part);
    return part.endsWith("%") ? (parsed / 100) * 255 : parsed;
  };
  const alphaPart = parts[3];
  const alpha = alphaPart ? Number.parseFloat(alphaPart) / (alphaPart.endsWith("%") ? 100 : 1) : 1;
  const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  return parts.length >= 3 && Object.values(color).every(Number.isFinite) && alpha >= 0
    ? color
    : null;
}

function parseDeclaredColor(
  value: string,
  styles: CSSStyleDeclaration,
  visited = new Set<string>()
): Color | null {
  const normalized = value.trim();
  const variable = normalized.match(/^var\(\s*(--[^,\s)]+)(?:,\s*(.+))?\)$/);
  if (variable) {
    const [, name, fallback = ""] = variable;
    if (visited.has(name)) {
      return null;
    }
    visited.add(name);
    return parseDeclaredColor(styles.getPropertyValue(name) || fallback, styles, visited);
  }

  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => `${part}${part}`).join("") : hex;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: 1,
    };
  }
  return parseComputedColor(normalized);
}

function colorKey(color: Color): string {
  return `${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a.toFixed(3)}`;
}

function composite(foreground: Color, background: Color): Color {
  const a = foreground.a + background.a * (1 - foreground.a);
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
    a,
  };
}

function luminance(color: Color): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722;
}

function contrastRatio(foreground: Color, background: Color): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function hasRenderedText(element: HTMLElement): boolean {
  const directText = [...element.childNodes].some(
    (node) => node.nodeType === 3 && Boolean(node.textContent?.trim())
  );
  if (directText) {
    return true;
  }
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const control = element as HTMLInputElement | HTMLTextAreaElement;
    return Boolean(control.value.trim() || control.placeholder.trim());
  }
  if (element.tagName === "SELECT") {
    return Boolean((element as HTMLSelectElement).selectedOptions[0]?.textContent?.trim());
  }
  return false;
}

function effectiveOpacity(element: HTMLElement): number {
  let opacity = 1;
  let current: HTMLElement | null = element;
  while (current) {
    const parsed = Number.parseFloat(current.win.getComputedStyle(current).opacity);
    if (Number.isFinite(parsed)) {
      opacity *= parsed;
    }
    current = current.parentElement;
  }
  return opacity;
}

function minimumContrast(styles: CSSStyleDeclaration): number {
  const size = Number.parseFloat(styles.fontSize);
  const weight = Number.parseInt(styles.fontWeight, 10);
  const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
  return isLarge ? LARGE_TEXT_CONTRAST_RATIO : NORMAL_TEXT_CONTRAST_RATIO;
}

function effectiveBackground(element: HTMLElement): Color | null {
  let current: HTMLElement | null = element;
  let result: Color | null = null;
  while (current) {
    const background = parseComputedColor(current.win.getComputedStyle(current).backgroundColor);
    if (background) {
      result = result ? composite(result, background) : background;
      if (result.a >= 0.999) {
        return result;
      }
    }
    current = current.parentElement;
  }
  return result;
}

function elementName(element: HTMLElement): string {
  const tag = element.tagName.toLocaleLowerCase();
  return element.id ? `${tag}#${element.id}` : tag;
}

interface InspectedColor {
  color: Color | null;
  role: string;
  value: string;
}

function inspectedColors(element: HTMLElement, styles: CSSStyleDeclaration): InspectedColor[] {
  const values: Array<[string, string]> = [
    ["background", styles.backgroundColor],
    ...(hasRenderedText(element)
      ? ([["foreground", styles.color]] as Array<[string, string]>)
      : []),
    ["border-top", styles.borderTopColor],
    ["border-right", styles.borderRightColor],
    ["border-bottom", styles.borderBottomColor],
    ["border-left", styles.borderLeftColor],
    ["outline", styles.outlineColor],
    ["fill", styles.fill],
    ["stroke", styles.stroke],
  ];
  const colors = values.map(([role, value]) => ({ color: parseComputedColor(value), role, value }));

  for (const [role, value] of [
    ["box-shadow", styles.boxShadow],
    ["text-shadow", styles.textShadow],
  ] as const) {
    for (const match of value.matchAll(/(?:rgba?\([^)]*\)|color\(srgb[^)]*\))/gi)) {
      colors.push({ color: parseComputedColor(match[0]), role, value: match[0] });
    }
  }
  return colors;
}

function hasVisibleUnsupportedColor(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return Boolean(normalized && normalized !== "none" && normalized !== "transparent");
}

/**
 * Resolves the current document's Obsidian color custom properties into comparable RGBA values.
 *
 * @param doc - Document hosting the rendered story and its active theme variables.
 */
export function resolveObsidianColorTokens(doc: Document): ReadonlySet<string> {
  const colors = new Set<string>();
  const probe = doc.body.createSpan();
  probe.hidden = true;

  for (const source of [doc.documentElement, doc.body]) {
    const styles = source.win.getComputedStyle(source);
    for (let index = 0; index < styles.length; index += 1) {
      const name = styles.item(index);
      if (!name.startsWith("--") || !COLOR_TOKEN_NAME.test(name)) {
        continue;
      }
      probe.style.color = `var(${name})`;
      const color =
        parseComputedColor(probe.win.getComputedStyle(probe).color) ??
        parseDeclaredColor(styles.getPropertyValue(name), styles);
      if (color) {
        colors.add(colorKey(color));
      }
    }
  }

  probe.remove();
  return colors;
}

/**
 * Reports measurable rendering defects for one mounted story case.
 *
 * @param storyElement - The sole mounted case carrying its stable story identity.
 * @param tokenColors - Resolved theme colors used to distinguish token-backed styles from literals.
 * @param additionalRoots - Story-owned portal roots mounted outside the primary story element.
 */
export function inspectStoryCase(
  storyElement: HTMLElement,
  tokenColors: ReadonlySet<string> = resolveObsidianColorTokens(storyElement.doc),
  additionalRoots: HTMLElement[] = []
): AuditFinding[] {
  const story = storyElement.dataset.story ?? "unknown-story";
  const findings: AuditFinding[] = [];
  const rect = storyElement.getBoundingClientRect();

  const roots = [storyElement, ...additionalRoots.filter((root) => root.isConnected)];
  for (const root of roots) {
    if (root.scrollWidth > root.clientWidth) {
      findings.push({
        story,
        check: "overflow",
        detail: `scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}${
          root === storyElement ? "" : ` on ${elementName(root)}`
        }`,
      });
    }
  }
  if (rect.width === 0 || rect.height === 0) {
    findings.push({
      story,
      check: "zero-size",
      detail: `width ${rect.width} x height ${rect.height}`,
    });
  }

  const failure = roots
    .flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>("[data-story-render-error]")])
    .find((element) => element.matches("[data-story-render-error]"));
  if (failure) {
    findings.push({
      story,
      check: "render-failure",
      detail: failure.dataset.storyRenderError || "Unknown render error",
    });
  }

  const reportedColors = new Set<string>();
  const elements = roots.flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>("*")]);
  for (const element of [...new Set(elements)]) {
    const styles = element.win.getComputedStyle(element);
    const foreground = hasRenderedText(element) ? parseComputedColor(styles.color) : null;

    for (const { color, role, value } of inspectedColors(element, styles)) {
      if (!color && hasVisibleUnsupportedColor(value)) {
        const key = `unsupported:${role}:${value}`;
        if (!reportedColors.has(key)) {
          reportedColors.add(key);
          findings.push({
            story,
            check: "unsupported-color",
            detail: `${role} ${value} on ${elementName(element)}`,
          });
        }
        continue;
      }
      if (color?.a === 0) {
        continue;
      }
      if (!color || tokenColors.size === 0 || tokenColors.has(colorKey(color))) {
        continue;
      }
      const key = `${role}:${colorKey(color)}`;
      if (!reportedColors.has(key)) {
        reportedColors.add(key);
        findings.push({
          story,
          check: "off-token-color",
          detail: `${role} ${value} on ${elementName(element)}`,
        });
      }
    }

    const backgroundBehindText = foreground ? effectiveBackground(element) : null;
    if (!foreground || !backgroundBehindText || backgroundBehindText.a < 0.999) {
      continue;
    }
    const visibleForeground = { ...foreground, a: foreground.a * effectiveOpacity(element) };
    const ratio = contrastRatio(
      composite(visibleForeground, backgroundBehindText),
      backgroundBehindText
    );
    const requiredRatio = minimumContrast(styles);
    if (ratio < requiredRatio) {
      findings.push({
        story,
        check: "contrast",
        detail: `${ratio.toFixed(1)}:1, needs ${requiredRatio}:1 on ${elementName(element)}`,
      });
    }
  }

  return findings;
}

/**
 * Names the active read-only Obsidian theme and light/dark mode for audit reports.
 *
 * @param doc - Document whose theme classes and attributes are currently applied.
 * @param configuredTheme - Community theme name read from Obsidian's vault configuration.
 */
export function getGalleryTheme(doc: Document, configuredTheme?: string): string {
  const mode =
    doc.body.classList.contains("theme-dark") ||
    doc.documentElement.classList.contains("theme-dark")
      ? "dark"
      : "light";
  const theme = configuredTheme?.trim() || "obsidian";
  return theme.endsWith(`-${mode}`) ? theme : `${theme}-${mode}`;
}

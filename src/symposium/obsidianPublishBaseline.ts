export const OBSIDIAN_PUBLISH_BASELINE = `
:root {
  color-scheme: light;
  --background-primary: #ffffff;
  --background-secondary: #f6f7f8;
  --text-normal: #242424;
  --text-muted: #666666;
  --text-accent: #5b5fc7;
  --interactive-accent: #5b5fc7;
  --background-modifier-border: #d8d8d8;
  --code-background: #f3f3f3;
  --callout-color: 91, 95, 199;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.65;
}

.publish-renderer {
  width: min(100% - 2rem, 46rem);
  margin: 0 auto;
  padding: 3rem 0 5rem;
}

.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4,
.markdown-rendered h5,
.markdown-rendered h6 {
  margin: 1.8em 0 0.6em;
  line-height: 1.25;
}

.markdown-rendered h1 {
  font-size: 2rem;
}

.markdown-rendered h2 {
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--background-modifier-border);
  font-size: 1.5rem;
}

.markdown-rendered h3 {
  font-size: 1.25rem;
}

.markdown-rendered p,
.markdown-rendered ul,
.markdown-rendered ol,
.markdown-rendered blockquote,
.markdown-rendered pre,
.markdown-rendered table {
  margin: 1em 0;
}

.markdown-rendered a {
  color: var(--text-accent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.15em;
}

.markdown-rendered .internal-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--background-modifier-border);
  text-underline-offset: 0.15em;
}

.markdown-rendered blockquote {
  margin-left: 0;
  padding: 0.1em 1em;
  border-left: 3px solid var(--background-modifier-border);
  color: var(--text-muted);
}

.markdown-rendered code {
  padding: 0.15em 0.35em;
  border-radius: 0.25rem;
  background: var(--code-background);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-rendered pre {
  overflow-x: auto;
  padding: 1rem;
  border-radius: 0.4rem;
  background: var(--code-background);
}

.markdown-rendered pre code {
  padding: 0;
  background: transparent;
}

.markdown-rendered table {
  width: 100%;
  border-collapse: collapse;
}

.markdown-rendered th,
.markdown-rendered td {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--background-modifier-border);
  text-align: left;
  vertical-align: top;
}

.markdown-rendered th {
  background: var(--background-secondary);
}

.markdown-rendered img,
.markdown-rendered svg {
  max-width: 100%;
  height: auto;
}

.markdown-rendered hr {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid var(--background-modifier-border);
}

.markdown-rendered .task-list-item {
  list-style: none;
}

.symposium-task-marker {
  display: inline-block;
  width: 1.4em;
  margin-left: -1.4em;
}

.markdown-rendered .callout {
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  border: 1px solid rgba(var(--callout-color), 0.35);
  border-left-width: 4px;
  border-radius: 0.4rem;
  background: rgba(var(--callout-color), 0.08);
}

.markdown-rendered .callout-title {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-weight: 650;
}

.markdown-rendered .callout-content > :last-child {
  margin-bottom: 0;
}

.markdown-rendered .markdown-embed,
.markdown-rendered .file-embed {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: 0.4rem;
  background: var(--background-secondary);
}

.markdown-rendered .canvas-minimap {
  display: block;
  width: 100%;
  border-radius: 0.4rem;
  background: var(--background-secondary);
}

.markdown-rendered .canvas-minimap path {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 2;
}

.markdown-rendered .canvas-minimap rect {
  fill: var(--background-primary);
  stroke: var(--text-muted);
  stroke-width: 2;
}

.markdown-rendered math[display="block"],
.markdown-rendered .math {
  max-width: 100%;
  overflow-x: auto;
}

.symposium-missing-asset {
  display: inline-block;
  padding: 0.2rem 0.45rem;
  border: 1px dashed var(--background-modifier-border);
  border-radius: 0.25rem;
  color: var(--text-muted);
}

@media (max-width: 40rem) {
  .publish-renderer {
    width: min(100% - 1.25rem, 46rem);
    padding-top: 1.5rem;
  }
}
`.trim();

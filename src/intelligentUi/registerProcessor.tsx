import { nativeUiSources } from "@/intelligentUi/nativeSources";
import { parseIntelligentUi } from "@/intelligentUi/parser";
import { IntelligentUi } from "@/intelligentUi/ui/IntelligentUi";
import { App, MarkdownRenderChild, Plugin } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

class IntelligentUiRenderChild extends MarkdownRenderChild {
  private root: Root | undefined;

  constructor(
    containerEl: HTMLElement,
    private app: App,
    private source: string,
    private sourcePath: string
  ) {
    super(containerEl);
  }

  onload(): void {
    const result = parseIntelligentUi(this.source);
    // Final incomplete bodies must retain withheld tokens instead of silently dropping text. https://github.com/Brevilabs/obsidian-copilot-private/issues/882
    if (result.status === "pending") {
      this.containerEl.createEl("pre").createEl("code", { text: this.source });
      return;
    }
    this.root = createPluginRoot(this.containerEl, this.app);
    this.root.render(
      <IntelligentUi result={result} source={this.source} sourcePath={this.sourcePath} />
    );
  }

  onunload(): void {
    this.root?.unmount();
  }
}

export function registerIntelligentUiProcessor(plugin: Plugin): void {
  plugin.registerMarkdownCodeBlockProcessor("copilot-ui", (source, element, context) => {
    nativeUiSources.set(element, source);
    context.addChild(new IntelligentUiRenderChild(element, plugin.app, source, context.sourcePath));
  });
}

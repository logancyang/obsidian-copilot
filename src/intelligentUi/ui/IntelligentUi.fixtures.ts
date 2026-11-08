import { parseIntelligentUi } from "@/intelligentUi/parser";
import { GOLDEN_EXAMPLES } from "@/intelligentUi/testing/golden";

const SOURCES = {
  Stack: "<stack><text>Capture useful ideas.</text><text>Return when you need them.</text></stack>",
  Row: '<row><card title="Capture"><text>Write the idea.</text></card><card title="Recall"><text>Find it again.</text></card></row>',
  Grid: '<grid columns="3"><card title="Notes"><text>Capture</text></card><card title="Links"><text>Connect</text></card><card title="Answers"><text>Recall</text></card></grid>',
  Card: '<card title="Research" icon="search" description="Sources and quotes"><text>Keep sources beside your ideas.</text></card>',
  Callout:
    '<stack><callout tone="tip"><text>Link each new note to one you already have.</text></callout><callout tone="warning" title="Back up first"><text>Moving folders rewrites every link inside them.</text></callout></stack>',
  Tabs: '<tabs><tab title="macOS"><steps><step title="Open Finder">Find the vault folder.</step><step title="Copy">Duplicate it to your backup drive.</step></steps></tab><tab title="Windows"><text>Open File Explorer and copy the vault folder.</text></tab></tabs>',
  Panel:
    "<panel><heading>Related ideas</heading><text>Look for connections across your notes.</text></panel>",
  Divider: "<stack><text>Before</text><divider/><text>After</text></stack>",
  Heading: "<heading>Build understanding</heading>",
  Text: "<text>Plain text keeps **markup** literal.</text>",
  Badge: "<badge>Ready to review</badge>",
  Icon: '<icon name="lightbulb"/>',
  Steps:
    '<steps><step title="Capture" icon="file-text"><text>Save the idea.</text></step><step title="Connect" icon="link"><text>Link related notes.</text></step><step title="Recall" icon="search"><text>Find what matters.</text></step></steps>',
  Step: '<steps><step title="Start here">Write down one useful idea.</step></steps>',
  Metric: '<metric value="42" label="Notes this week" delta="+3 since last week"/>',
  Markdown:
    "<markdown>Read **the summary**, [[Research]], and [the guide](https://example.com).</markdown>",
  Comparison: GOLDEN_EXAMPLES.comparison,
  GoldenSteps: GOLDEN_EXAMPLES.steps,
  Metrics: GOLDEN_EXAMPLES.metrics,
  GroupedConcepts: GOLDEN_EXAMPLES.groupedConcepts,
  Architecture: GOLDEN_EXAMPLES.architecture,
  Fallback: '<card title="Original idea"><text>Keep every word.</text><unknown/>\n```\n',
};

export const UI_STORIES = Object.fromEntries(
  Object.entries(SOURCES).map(([name, source]) => [
    name,
    { source, result: parseIntelligentUi(source) },
  ])
) as {
  [Name in keyof typeof SOURCES]: { source: string; result: ReturnType<typeof parseIntelligentUi> };
};

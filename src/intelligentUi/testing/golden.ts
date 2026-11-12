export const GOLDEN_EXAMPLES = Object.freeze({
  comparison:
    '<grid columns="2"><card title="Local" icon="hard-drive"><heading>Private</heading><text>Runs on your machine.</text><badge>Offline</badge></card><card title="Cloud" icon="cloud"><text>Available anywhere.</text></card></grid>',
  steps:
    '<steps><step title="Collect"><markdown>Read [[Research]] and [the guide](https://example.com).</markdown></step><step title="Connect"><text>Find shared ideas.</text></step><step title="Write"><text>Explain the result.</text></step></steps>',
  metrics:
    '<row><metric value="42" label="Notes" delta="+3"/><metric value="8" label="Connections"/><divider/><icon name="check"/></row>',
  groupedConcepts:
    '<stack><heading>Knowledge</heading><panel><card title="Capture"><text>Save useful ideas.</text></card><card title="Recall"><text>Return to useful ideas.</text></card></panel></stack>',
  architecture:
    '<stack><heading>Architecture</heading><row><card title="Input"><text>Notes</text></card><icon name="arrow-right"/><card title="Processing"><grid columns="1"><text>Search</text><text>Reason</text></grid></card><icon name="arrow-right"/><card title="Output"><text>Answer</text></card></row></stack>',
});

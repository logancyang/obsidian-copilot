# Connector tools page

The `<service> tools` page in Copilot settings: what agents can do with one connected service, tool by tool.

## Sub-features

- tools-groups: the tools are grouped under `Read only` and `Write`, with no counts; a group with no tools is hidden.
- tools-names: each tool shows the service's title for it, or its name in words without the service's name in front, and the first paragraph of its description as plain text.
- tools-clamp: a description longer than two lines is cut off with `Show more`.
- tools-search: a service with more than 8 tools offers `Search tools`, which matches names and descriptions; with no match it reads `No tools match "<query>"`.
- tools-unreachable: when Copilot cannot get the tools, the page reads `Couldn't reach <service>` and "Copilot couldn't get its tools just now." with `Try again`.

## How to get to it

- The tool count on a connected row of the [Connectors tab](connectors-tab.md), such as `Connected · 14 tools`, for a catalog service or a [custom connector](custom-connectors.md).

## Driving it

- Groups: open a connected service's tools. The page is titled `<service> tools` with "What agents can do with <service>."; read-only tools show under `Read only` and the rest under `Write`.
- Names: on Notion's tools, a tool reads `Search`, not `Notion search`, with a one-line description.
- Show more: find a tool whose description runs past two lines. It ends at two lines with `Show more`; choosing it shows the rest.
- Search: open a service with more than 8 tools and type "comment". Only tools whose name or description mentions comments stay. Type text that matches nothing: `No tools match "<query>"` shows.
- Couldn't reach: with the service's server down, open its tools page or choose `Try again` on its row. The page reads `Couldn't reach <service>`; `Try again` is disabled until the check ends, and the tools show once the service answers.
- Back: choose `Back`. The [Connectors tab](connectors-tab.md) shows again.

## Gotchas

- The page stays open as the service changes: it switches to `Couldn't reach` when a chat fails to reach the service, and back to the tools when it recovers.
- `Read only` holds the tools the service itself marks read-only; any other tool shows under `Write`, so a service that marks nothing lists every tool under `Write`. The same marking decides which tools run without a [permission request](permission-requests.md).

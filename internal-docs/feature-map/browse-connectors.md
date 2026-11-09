# Browse connectors

The `Browse connectors` page in Copilot settings: every service Copilot can connect, with search, categories, and `Connect`.

## Sub-features

- browse-list: each service shows its logo, name, and a line on what it does, with `Connect`, `Connected`, or `Needs login` with `Reconnect`.
- browse-search: `Search connectors, or what you want to do (tasks, meetings…)` matches names, categories, and tasks, and says how many connectors match.
- browse-category: `Category` (`All` or one category) narrows the list while nothing is searched.
- browse-connect: `Connect` starts a login in the browser; the row then shows the same waiting, `Cancel`, and `Copy the login link` as the [Connectors tab](connectors-tab.md).
- browse-no-match: a search with no match shows `No connector for "<query>" yet` and `Request <query>`.
- browse-request: "Don't see your service?" offers `Request a connector` and `add a custom connector`.

## How to get to it

- `Browse connectors` on the [Connectors tab](connectors-tab.md), in its header or its empty state.

## Driving it

- List: open `Browse connectors`. Every service shows with its description; a connected one reads `Connected`.
- Search: type "tasks". Task services such as Todoist and Linear stay, and "<N> connectors match "tasks"" shows. `Category` hides while the search has text.
- Category: clear the search and pick a category. Only that category's services show.
- Connect: choose `Connect` on a service. The browser opens its login page and the row reads "Waiting for you to log in in your browser…". Log in and approve; the row reads `Connected`.
- No match: search for a service Copilot does not list. `No connector for "<query>" yet` shows with `Request <query>`, which opens a prefilled GitHub request.
- Request: choose `Request a connector` under the list. A prefilled GitHub request opens.
- Custom: choose `add a custom connector`. The `Add custom connector` dialog opens ([custom connectors](custom-connectors.md)).
- Back: choose `Back`. The [Connectors tab](connectors-tab.md) shows again.

## Gotchas

- A login that is waiting stays visible below the list when a search or category hides its service, so it can still be cancelled.

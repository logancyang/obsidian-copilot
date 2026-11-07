import type { ConnectorCatalogEntry } from "@/connectors/catalog";

const NEW_ISSUE_URL = "https://github.com/logancyang/obsidian-copilot/issues/new";

function newIssueUrl(title: string, body: string): string {
  return `${NEW_ISSUE_URL}?${new URLSearchParams({ title, body }).toString()}`;
}

export function loginRejectedIssueUrl(service: ConnectorCatalogEntry): string {
  return newIssueUrl(
    `Connector login rejected: ${service.name}`,
    `${service.name} didn't accept Copilot's login.\n\nServer: ${service.serverUrl}`
  );
}

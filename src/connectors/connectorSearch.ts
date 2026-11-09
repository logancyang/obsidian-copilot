import type { ConnectorCatalogEntry, ConnectorCategory } from "@/connectors/catalog";

export function findConnectors(
  catalog: readonly ConnectorCatalogEntry[],
  query: string,
  category: ConnectorCategory | null
): ConnectorCatalogEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found =
    terms.length > 0
      ? catalog.filter((service) => {
          const text = `${service.name} ${service.description} ${service.category}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        })
      : catalog.filter((service) => category === null || service.category === category);
  return found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

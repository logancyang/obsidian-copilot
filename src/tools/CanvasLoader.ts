import { TFile, Vault } from "obsidian";

/* ---------- Core data types ---------- */

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "file" | "text" | "link" | "group";
  label?: string; // groups
  color?: string; // files / links
  url?: string; // links
  file?: string; // files
  text?: string; // text cards
}

export interface RichNode extends CanvasNodeBase {
  /** Inlined markdown or plain‑text content (empty for groups/links). */
  content: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  /** Synthetic labels such as "contains". */
  label?: string;
}

export interface CanvasData {
  nodes: RichNode[];
  edges: CanvasEdge[];
  byId: Record<string, RichNode>;
}

/* ---------- Loader class ---------- */

export class CanvasLoader {
  constructor(private vault: Vault) {}

  /** Load & enrich a `.canvas` file. */
  async load(file: TFile): Promise<CanvasData> {
    const raw = await this.vault.read(file);
    const { nodes = [], edges = [] } = JSON.parse(raw) as {
      nodes: CanvasNodeBase[];
      edges: CanvasEdge[];
    };

    const richNodes: RichNode[] = await Promise.all(
      nodes.map(async (n) => {
        if (n.type === "file" && n.file) {
          const file = this.vault.getAbstractFileByPath(n.file);
          const md = file instanceof TFile ? await this.vault.cachedRead(file) : "";
          return { ...n, content: md };
        }
        if (n.type === "text") return { ...n, content: n.text ?? "" };
        return { ...n, content: "" }; // link / group
      })
    );

    const allEdges = [...edges];
    this.#deriveGroupEdges(richNodes, allEdges);

    const byId = Object.fromEntries(richNodes.map((n) => [n.id, n]));
    return { nodes: richNodes, edges: allEdges, byId };
  }

  /** Build a concise prompt for an LLM. */
  buildPrompt(canvas: CanvasData): string {
    // First, build a map of group contents
    const groupContents = new Map<string, RichNode[]>();
    const groups = canvas.nodes.filter((n) => n.type === "group");

    for (const group of groups) {
      const containedNodes = canvas.nodes.filter((n) => {
        if (n.id === group.id) return false;
        const nodeX = n.x + n.width / 2;
        const nodeY = n.y + n.height / 2;
        return (
          nodeX >= group.x &&
          nodeY >= group.y &&
          nodeX <= group.x + group.width &&
          nodeY <= group.y + group.height
        );
      });
      groupContents.set(group.label || group.id, containedNodes);
    }

    // Build a clear, structured description
    let description = `This canvas contains the following elements:\n\n`;

    // Helper function to format node content
    const formatNodeContent = (node: RichNode): string => {
      switch (node.type) {
        case "file":
          return `- File: ${node.file}\nContent:\n${node.content}\n`;
        case "text":
          return `- Text: "${node.text}"\n`;
        case "link":
          return `- Link: ${node.url}\n`;
        default:
          return "";
      }
    };

    // Describe groups and their contents
    groups.forEach((group) => {
      const groupName = group.label || group.id;
      const contents = groupContents.get(groupName) || [];
      description += `Group "${groupName}" contains:\n`;
      contents.forEach((node) => {
        description += formatNodeContent(node);
      });
      description += "\n";
    });

    // Describe non-grouped elements
    const ungroupedNodes = canvas.nodes.filter((n) => {
      if (n.type === "group") return false;
      return !Array.from(groupContents.values())
        .flat()
        .some((gn) => gn.id === n.id);
    });

    if (ungroupedNodes.length > 0) {
      description += "Elements outside of groups:\n";
      ungroupedNodes.forEach((node) => {
        description += formatNodeContent(node);
      });
    }

    description += "\nWhen describing this canvas, please:\n";
    description += "- Use the actual titles/names of elements instead of their IDs\n";
    description += "- Pay attention to the content and relationships between elements\n";
    description +=
      "- Describe files by their names, links by their URLs, and text nodes by their content\n";

    return description;
  }

  /* ---------- private helpers ---------- */

  /** Add synthetic 'contains' edges for group membership. */
  #deriveGroupEdges(nodes: RichNode[], edges: CanvasEdge[]) {
    const groups = nodes.filter((n) => n.type === "group");
    for (const g of groups) {
      for (const n of nodes) {
        if (n.id === g.id) continue;
        // Check if node's center point is within the group's bounds
        const nodeX = n.x + n.width / 2;
        const nodeY = n.y + n.height / 2;
        const inside =
          nodeX >= g.x && nodeY >= g.y && nodeX <= g.x + g.width && nodeY <= g.y + g.height;

        if (inside) {
          edges.push({
            id: crypto.randomUUID(),
            fromNode: g.id,
            toNode: n.id,
            label: "contains",
          });
        }
      }
    }
  }
}

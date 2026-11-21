import type { CustomAgent } from "@/agents/CustomAgentStore";
import { type App, FuzzySuggestModal } from "obsidian";

export class AgentPickerModal extends FuzzySuggestModal<CustomAgent> {
  constructor(
    app: App,
    private readonly agents: readonly CustomAgent[],
    private readonly onChoose: (agent: CustomAgent) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a teammate to chat with");
    this.emptyStateText = "No teammates yet.";
  }

  getItems(): CustomAgent[] {
    return [...this.agents];
  }

  getItemText(agent: CustomAgent): string {
    return agent.title ? `${agent.name} · ${agent.title}` : agent.name;
  }

  onChooseItem(agent: CustomAgent): void {
    this.onChoose(agent);
  }
}

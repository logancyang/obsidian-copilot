import { getCurrentProject } from "@/aiParams";
import { getSystemPrompt } from "@/settings/model";
import ProjectManager from "../projectManager";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";

export class ProjectChainRunner extends CopilotPlusChainRunner {
  protected async getSystemPrompt(): Promise<string> {
    let finalPrompt = getSystemPrompt();
    const projectConfig = getCurrentProject();
    if (!projectConfig) {
      return finalPrompt;
    }

    // Get context asynchronously
    const context = await ProjectManager.instance.getProjectContext(projectConfig.id);
    finalPrompt = `${finalPrompt}\n\n<project_system_prompt>\n${projectConfig.systemPrompt}\n</project_system_prompt>`;

    // TODO: Move project context out of the system prompt and into the user prompt.
    if (context) {
      finalPrompt = `${finalPrompt}\n\n <project_context>\n${context}\n</project_context>`;
    }

    return finalPrompt;
  }
}

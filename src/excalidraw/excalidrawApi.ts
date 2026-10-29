import type { SceneElement } from "@/excalidraw/excalidrawOutline";
import type {
  ExcalidrawApi,
  ExcalidrawCliReply,
  LabelledConnection,
} from "@/excalidraw/excalidrawTools";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { TFile, type App, type View } from "obsidian";

export const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";
const EXCALIDRAW_VIEW_TYPE = "excalidraw";

interface MutableElement {
  containerId?: string | null;
  boundElements?: Array<{ id: string; type: string }> | null;
}

interface ExcalidrawAutomate {
  getAPI(view?: View): ExcalidrawAutomate;
  isExcalidrawFile(file: TFile): boolean;
  getSceneFromFile(file: TFile): Promise<{ elements: SceneElement[] } | null>;
  createPNGBase64(templatePath?: string, scale?: number): Promise<string>;
  executeCLI(request: Record<string, unknown>): Promise<ExcalidrawCliReply>;
  getViewElements(): SceneElement[];
  copyViewElementsToEAforEditing(elements: SceneElement[]): void;
  connectObjects(
    from: string,
    fromSide: string | null,
    to: string,
    toSide: string | null,
    options: { startArrowHead: null; endArrowHead: string }
  ): string;
  addText(
    x: number,
    y: number,
    text: string,
    options: { textAlign: string; textVerticalAlign: string }
  ): string;
  getElement(id: string): MutableElement;
  addElementsToView(
    reposition: boolean,
    save: boolean,
    newElementsOnTop: boolean
  ): Promise<boolean>;
  style: { strokeStyle: string; strokeColor: string };
  destroy(): void;
}

interface SaveOutcome {
  status: string;
  requestedRevision: number;
  acknowledgedRevision: number | null;
}

type ExcalidrawView = View & { file?: TFile | null; saveWithOutcome(): Promise<SaveOutcome> };

// executeCLI arrived in Excalidraw 2.29, the first release whose create and apply commands bind labels and arrows both ways.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
export function getExcalidrawApi(app: App): ExcalidrawApi | null {
  const { plugins } = app as unknown as {
    plugins?: { getPlugin(id: string): { ea?: ExcalidrawAutomate | null } | null };
  };
  const ea = plugins?.getPlugin(EXCALIDRAW_PLUGIN_ID)?.ea;
  if (!ea || typeof ea.executeCLI !== "function") return null;
  const vaultPath = (path: string) => toVaultRelative(path, getVaultBase(app));
  const drawing = (path: string) => {
    const file = app.vault.getAbstractFileByPath(vaultPath(path));
    return file instanceof TFile && ea.isExcalidrawFile(file) ? file : null;
  };
  const withFreshApi = async <T>(
    view: View | undefined,
    job: (fresh: ExcalidrawAutomate) => Promise<T>
  ) => {
    const fresh = ea.getAPI(view);
    try {
      return await job(fresh);
    } finally {
      fresh.destroy();
    }
  };

  return Object.freeze({
    async sceneElements(path: string) {
      const file = drawing(path);
      return file ? ((await ea.getSceneFromFile(file))?.elements ?? null) : null;
    },
    renderPng: (path: string) =>
      withFreshApi(undefined, async (fresh) =>
        (await fresh.createPNGBase64(vaultPath(path), 1)).replace(/^data:image\/png;base64,/, "")
      ),
    execute: (request: Record<string, unknown>) =>
      ea.executeCLI(
        typeof request.path === "string" ? { ...request, path: vaultPath(request.path) } : request
      ),
    async connectLabelled(path: string, connection: LabelledConnection) {
      const target = vaultPath(path);
      const view = app.workspace
        .getLeavesOfType(EXCALIDRAW_VIEW_TYPE)
        .map((leaf) => leaf.view as ExcalidrawView)
        .find((v) => v.file?.path === target);
      if (!view) throw new Error(`${target} is not open.`);
      return withFreshApi(view, async (fresh) => {
        const scene = fresh.getViewElements();
        const [from, to] = [connection.from, connection.to].map((id) =>
          scene.find((e) => e.id === id && !e.isDeleted)
        );
        if (!from || !to)
          throw new Error(`No element with id ${from ? connection.to : connection.from}.`);
        fresh.copyViewElementsToEAforEditing([from, to]);
        fresh.style.strokeStyle = connection.dashed ? "dashed" : "solid";
        if (connection.color) fresh.style.strokeColor = connection.color;
        const arrowId = fresh.connectObjects(
          from.id,
          connection.fromSide ?? null,
          to.id,
          connection.toSide ?? null,
          {
            startArrowHead: null,
            endArrowHead: "arrow",
          }
        );
        let labelId: string | null = null;
        if (connection.label) {
          labelId = fresh.addText(0, 0, connection.label, {
            textAlign: "center",
            textVerticalAlign: "middle",
          });
          const arrow = fresh.getElement(arrowId);
          fresh.getElement(labelId).containerId = arrowId;
          arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: labelId }];
        }
        // Saving through addElementsToView only schedules an autosave, so the arrow could be missing from the file the
        // agent reads next; the plugin's own apply saves explicitly and waits for the acknowledgement.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
        await fresh.addElementsToView(false, false, true);
        const saved = await view.saveWithOutcome();
        if (
          saved.acknowledgedRevision === null ||
          saved.acknowledgedRevision < saved.requestedRevision
        ) {
          throw new Error(
            `the new arrow is in the open drawing but did not save (${saved.status}).`
          );
        }
        return { arrowId, labelId };
      });
    },
  });
}

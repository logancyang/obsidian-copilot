import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentPickerModal } from "@/agents/ui/AgentPickerModal";
import type { App } from "obsidian";

const COCO = { slug: "coco", name: "Coco", title: "Houseplant carer" } as CustomAgent;
const LEO = { slug: "leo", name: "Leo", title: "" } as CustomAgent;

describe("AgentPickerModal", () => {
  describe("AgentPickerModal", () => {
    describe("getItems()", () => {
      it("offers every agent it was given", () => {
        expect(new AgentPickerModal({} as App, [COCO, LEO], jest.fn()).getItems()).toEqual([
          COCO,
          LEO,
        ]);
      });
    });

    describe("getItemText()", () => {
      it("shows an agent's name with its title, or its name alone when it has no title", () => {
        const modal = new AgentPickerModal({} as App, [COCO, LEO], jest.fn());
        expect([modal.getItemText(COCO), modal.getItemText(LEO)]).toEqual([
          "Coco · Houseplant carer",
          "Leo",
        ]);
      });
    });

    describe("onChooseItem()", () => {
      it("hands the chosen agent to its caller", () => {
        const onChoose = jest.fn();
        new AgentPickerModal({} as App, [COCO], onChoose).onChooseItem(COCO);
        expect(onChoose).toHaveBeenCalledWith(COCO);
      });
    });
  });
});

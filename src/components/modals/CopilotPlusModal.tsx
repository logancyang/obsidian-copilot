import { Modal } from "obsidian";

export class CopilotPlusModal extends Modal {
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const container = contentEl.createDiv("copilot-plus-modal");

    container.createEl("h2", { text: "Copilot Plus (Alpha)" });

    const introP = container.createEl("p");
    introP.appendChild(document.createTextNode("Coming soon! "));
    introP.createEl("strong", { text: "Powerful AI agents" });
    introP.appendChild(
      document.createTextNode(
        " in your vault for more advanced question answering and workflows while "
      )
    );
    introP.createEl("strong", {
      text: "keeping all your data stored locally",
    });
    introP.appendChild(document.createTextNode("."));

    container.createEl("h3", { text: "Stay Updated" });

    const paragraph = container.createEl("p");
    paragraph.appendChild(
      document.createTextNode(
        "Join our waitlist at the website below to be notified when Copilot Plus is available! "
      )
    );

    paragraph.appendChild(document.createElement("br"));
    paragraph.appendChild(document.createElement("br"));

    paragraph.createEl("strong", {
      text: "Alpha access spots are limited. ",
    });
    paragraph.appendChild(document.createTextNode("We'll "));
    paragraph.createEl("strong", {
      text: "prioritize supporters who have donated",
    });
    paragraph.appendChild(
      document.createTextNode(" to the project through either GitHub Sponsors or buymeacoffee. ")
    );
    paragraph.appendChild(document.createTextNode(" so please consider "));
    const donateLink = paragraph.createEl("a", {
      href: "https://www.buymeacoffee.com/logancyang",
      text: "donating now",
    });
    donateLink.setAttribute("target", "_blank");
    donateLink.setAttribute("rel", "noopener noreferrer");
    paragraph.appendChild(document.createTextNode(" if you are interested!"));

    container.createEl("h3", {
      text: "Learn More about Copilot Plus mode and join the waitlist here:",
    });

    const link = container.createEl("a", {
      href: "https://obsidiancopilot.com",
      text: "https://obsidiancopilot.com",
    });
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

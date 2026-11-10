/* eslint-disable @typescript-eslint/no-require-imports -- pasted into Obsidian's console, where require is the only loader */
(() => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(require("os").homedir(), "dnd-probe");
  fs.mkdirSync(dir, { recursive: true });
  const LOG = path.join(dir, "drop-renderer.log");
  const { webUtils } = require("electron");
  if (window.__probeOff) window.__probeOff();

  const zoneOf = (el) => {
    if (!(el instanceof Element)) return "other";
    if (el.closest(".workspace-leaf-content[data-type^=copilot]")) return "copilot-chat";
    if (el.closest(".nav-files-container, .workspace-leaf-content[data-type=file-explorer]"))
      return "navigator";
    if (el.closest(".workspace-leaf-content[data-type=markdown]")) return "editor";
    return "other:" + (el.className || el.tagName).toString().slice(0, 30);
  };
  const snap = (e, phase) => {
    const dt = e.dataTransfer;
    const rec = {
      at: new Date().toISOString(),
      phase,
      type: e.type,
      zone: zoneOf(e.target),
      types: dt ? [...dt.types] : null,
      items: dt ? [...dt.items].map((i) => `${i.kind}:${i.type}`) : null,
      effectAllowed: dt?.effectAllowed,
      dropEffect: dt?.dropEffect,
      defaultPrevented: e.defaultPrevented,
    };
    if (e.type === "drop" && dt) {
      rec.files = [...dt.files].map((f) => {
        let path = null;
        try {
          path = webUtils.getPathForFile(f) || null;
        } catch (err) {
          path = "ERR " + err.message;
        }
        return { name: f.name, type: f.type, size: f.size, path };
      });
      rec.strings = {};
      for (const t of dt.types) if (t !== "Files") rec.strings[t] = dt.getData(t).slice(0, 400);
    }
    return rec;
  };

  const panel = document.body.createDiv();
  panel.id = "dnd-probe-panel";
  Object.assign(panel.style, {
    position: "fixed",
    right: "12px",
    top: "60px",
    width: "420px",
    maxHeight: "60vh",
    overflow: "auto",
    zIndex: 99999,
    background: "rgba(20,20,30,.92)",
    color: "#9fe",
    font: "11px/1.35 monospace",
    padding: "8px",
    borderRadius: "8px",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  });
  panel.setText("DND PROBE ready — drag a PDF onto the navigator, then the chat input.");
  const show = (lines) => {
    panel.setText(lines.join("\n"));
  };

  let lastOver = {};
  let current = [];
  window.__dndProbeLog = [];
  const write = (rec) => {
    window.__dndProbeLog.push(rec);
    try {
      fs.appendFileSync(LOG, JSON.stringify(rec) + "\n");
    } catch (err) {
      rec.logWriteError = String(err);
    }
  };

  const capture = (e) => {
    if (e.type === "dragover") {
      const k = zoneOf(e.target);
      if (lastOver[k] && Date.now() - lastOver[k] < 400) return;
      lastOver[k] = Date.now();
    }
    if (e.type === "dragenter" && current.length === 0) current.push("— new drag —");
    const rec = snap(e, "capture");
    write(rec);
    if (e.type !== "dragleave")
      current.push(`${rec.type.padEnd(9)} ${rec.zone.padEnd(14)} ${JSON.stringify(rec.items)}`);
    if (e.type === "drop") {
      current.push("FILES: " + JSON.stringify(rec.files, null, 1));
      current.push("STRINGS: " + JSON.stringify(rec.strings, null, 1));
    }
    show(current.slice(-40));
  };
  const bubble = (e) => {
    if (e.type !== "drop") return;
    const rec = {
      at: new Date().toISOString(),
      phase: "bubble@window",
      type: e.type,
      zone: zoneOf(e.target),
      defaultPrevented: e.defaultPrevented,
    };
    write(rec);
    current.push(`drop reached window bubble, defaultPrevented=${e.defaultPrevented}`);
    show(current.slice(-40));
    current = [];
  };
  const types = ["dragenter", "dragover", "dragleave", "drop"];
  types.forEach((t) => window.addEventListener(t, capture, true));
  window.addEventListener("drop", bubble, false);
  window.__probeOff = () => {
    types.forEach((t) => window.removeEventListener(t, capture, true));
    window.removeEventListener("drop", bubble, false);
    panel.remove();
  };
  write({ at: new Date().toISOString(), phase: "probe-installed" });
  return "probe installed, logging to " + LOG;
})();

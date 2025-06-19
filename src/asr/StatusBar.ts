import { Plugin } from "obsidian";

export enum RecordingStatus {
  Idle = "idle",
  Recording = "recording",
  Processing = "processing",
}

export class StatusBarRecord {
  plugin: Plugin;
  statusBarItem: HTMLElement | null = null;
  status: RecordingStatus = RecordingStatus.Idle;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.statusBarItem = this.plugin.addStatusBarItem();
    this.updateStatusBarItem();
  }

  updateStatus(status: RecordingStatus) {
    this.status = status;
    this.updateStatusBarItem();
  }

  updateStatusBarItem() {
    if (this.statusBarItem) {
      switch (this.status) {
        case RecordingStatus.Recording:
          this.statusBarItem.textContent = "Recording...";
          this.statusBarItem.style.color = "red";
          break;
        case RecordingStatus.Processing:
          this.statusBarItem.textContent = "Processing audio...";
          this.statusBarItem.style.color = "orange";
          break;
        case RecordingStatus.Idle:
        default:
          this.statusBarItem.textContent = "Whisper Idle";
          this.statusBarItem.style.color = "green";
          break;
      }
    }
  }

  remove() {
    if (this.statusBarItem) {
      this.statusBarItem.remove();
    }
  }
}

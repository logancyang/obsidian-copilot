import Whisper from "../main";
import { ButtonComponent, Modal } from "obsidian";
import { RecordingStatus } from "./StatusBar";

export class Controls extends Modal {
  private plugin: Whisper;
  private startButton: ButtonComponent;
  private pauseButton: ButtonComponent;
  private stopButton: ButtonComponent;
  private timerDisplay: HTMLElement;

  constructor(plugin: Whisper) {
    super(plugin.app);
    this.plugin = plugin;
    this.containerEl.addClass("recording-controls");

    // Add elapsed time display
    this.timerDisplay = this.contentEl.createEl("div", { cls: "timer" });
    this.updateTimerDisplay();

    // Set onUpdate callback for the timer
    this.plugin.timer.setOnUpdate(() => {
      this.updateTimerDisplay();
    });

    // Add button group
    const buttonGroupEl = this.contentEl.createEl("div", {
      cls: "button-group",
    });

    // Add record button
    this.startButton = new ButtonComponent(buttonGroupEl);
    this.startButton
      .setIcon("microphone")
      .setButtonText(" Record")
      .onClick(this.startRecording.bind(this))
      .buttonEl.addClass("button-component");

    // Add pause button
    this.pauseButton = new ButtonComponent(buttonGroupEl);
    this.pauseButton
      .setIcon("pause")
      .setButtonText(" Pause")
      .onClick(this.pauseRecording.bind(this))
      .buttonEl.addClass("button-component");

    // Add stop button
    this.stopButton = new ButtonComponent(buttonGroupEl);
    this.stopButton
      .setIcon("square")
      .setButtonText(" Stop")
      .onClick(this.stopRecording.bind(this))
      .buttonEl.addClass("button-component");
  }

  async startRecording() {
    console.log("start");
    this.plugin.statusBarRecord.updateStatus(RecordingStatus.Recording);
    await this.plugin.recorder.startRecording();
    this.plugin.timer.start();
    this.resetGUI();
  }

  async pauseRecording() {
    console.log("pausing recording...");
    await this.plugin.recorder.pauseRecording();
    this.plugin.timer.pause();
    this.resetGUI();
  }

  async stopRecording() {
    console.log("stopping recording...");
    this.plugin.statusBarRecord.updateStatus(RecordingStatus.Processing);
    const blob = await this.plugin.recorder.stopRecording();
    this.plugin.timer.reset();
    this.resetGUI();

    const extension = this.plugin.recorder.getMimeType()?.split("/")[1];
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    await this.plugin.audioHandler.sendAudioData(blob, fileName);
    this.plugin.statusBarRecord.updateStatus(RecordingStatus.Idle);
    this.close();
  }

  updateTimerDisplay() {
    this.timerDisplay.textContent = this.plugin.timer.getFormattedTime();
  }

  resetGUI() {
    const recorderState = this.plugin.recorder.getRecordingState();

    this.startButton.setDisabled(recorderState === "recording" || recorderState === "paused");
    this.pauseButton.setDisabled(recorderState === "inactive");
    this.stopButton.setDisabled(recorderState === "inactive");

    this.pauseButton.setButtonText(recorderState === "paused" ? " Resume" : " Pause");
  }
}

import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChainManager from "@/LLMProviders/chainManager";
import { CustomModel } from "@/aiParams";
import { parseChatContent, updateChatMemory } from "@/chatUtils";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";
import { CHAT_VIEWTYPE, DEFAULT_OPEN_AREA, EVENT_NAMES } from "@/constants";
import { registerContextMenu } from "@/contextMenu";
import { encryptAllKeys } from "@/encryptionService";
import { checkIsPlusUser } from "@/plusUtils";
import { HybridRetriever } from "@/search/hybridRetriever";
import VectorStoreManager from "@/search/vectorStoreManager";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getModelKeyFromModel,
  getSettings,
  sanitizeSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import SharedState from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import {
  App,
  Editor,
  FuzzySuggestModal,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginManifest,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { IntentAnalyzer } from "./LLMProviders/intentAnalyzer";

import { ChildProcess } from "child_process";
import { TranscriptionEngine } from "./asr/transcribe";
import { StatusBarReadwise } from "./asr/status";
import { createClient, User } from "@supabase/supabase-js";
import {
  TranscriptionSettings,
  DEFAULT_SETTINGS,
  TranscriptionSettingTab,
  SWIFTINK_AUTH_CALLBACK,
  SUPABASE_URL,
  SUPABASE_KEY,
  IS_SWIFTINK,
} from "./asr/settings";
import { FileLink } from "./asr/fileLink";
import { Timer } from "./asr/Timer";
import { Controls } from "./asr/Controls";
import { AudioHandler } from "./asr/AudioHandler";
import { WhisperSettingsTab } from "./asr/WhisperSettingsTab";
import { SettingsManager, WhisperSettings } from "./asr/SettingsManager";
import { NativeAudioRecorder } from "./asr/AudioRecorder";
import { RecordingStatus, StatusBarRecord } from "./asr/StatusBar";

export default class CopilotPlugin extends Plugin {
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  chainManager: ChainManager;
  brevilabsClient: BrevilabsClient;
  userMessageHistory: string[] = [];
  vectorStoreManager: VectorStoreManager;
  fileParserManager: FileParserManager;
  settingsUnsubscriber?: () => void;
  Transcriptionsettings: TranscriptionSettings;
  statusBarReadwise: StatusBarReadwise;
  whisperSettings: WhisperSettings;
  settingsManager: SettingsManager;
  timer: Timer;
  recorder: NativeAudioRecorder;
  audioHandler: AudioHandler;
  controls: Controls | null = null;
  statusBarRecord: StatusBarRecord;

  public static plugin: Plugin;
  public static children: Array<ChildProcess> = [];
  public transcriptionEngine: TranscriptionEngine;
  public user: User | null;

  private pendingCommand: { file?: TFile; parentFile: TFile } | null = null;
  private ongoingTranscriptionTasks: Array<{
    task: Promise<void>;
    abortController: AbortController;
  }> = [];
  public static transcribeFileExtensions: string[] = [
    "mp3",
    "wav",
    "webm",
    "ogg",
    "flac",
    "m4a",
    "aac",
    "amr",
    "opus",
    "aiff",
    "m3gp",
    "mp4",
    "m4v",
    "mov",
    "avi",
    "wmv",
    "flv",
    "mpeg",
    "mpg",
    "mkv",
  ];

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    // Additional initialization if needed
  }

  public supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: true,
    },
  });

  private querySelectionOnAuthentication(authString: string, display: string) {
    if (authString === ".swiftink-manage-account-btn") {
      return document.querySelectorAll(authString).forEach((element) => {
        element.innerHTML = `Manage ${this.user?.email}`;
      });
    } else {
      return document.querySelectorAll(authString).forEach((element) => {
        element.setAttribute("style", display);
      });
    }
  }

  // Modify your executePendingCommand method to store the ongoing task
  private async executePendingCommand(pendingCommand: { file?: TFile; parentFile: TFile }) {
    try {
      // Check if the user is authenticated
      const session = await this.supabase.auth.getSession().then((res) => {
        return res.data;
      });

      if (!session || !session.session) {
        throw new Error("User not authenticated.");
      }

      if (pendingCommand?.file) {
        const abortController = new AbortController();
        const task = this.transcribeAndWrite(
          pendingCommand.parentFile,
          pendingCommand.file,
          abortController
        );
        this.ongoingTranscriptionTasks.push({
          task,
          abortController,
        });
        await task;
      } else {
        const filesToTranscribe = await this.getTranscribeableFiles(pendingCommand.parentFile);
        for (const fileToTranscribe of filesToTranscribe) {
          const abortController = new AbortController();
          const task = this.transcribeAndWrite(
            pendingCommand.parentFile,
            fileToTranscribe,
            abortController
          );
          this.ongoingTranscriptionTasks.push({ task, abortController });
          await task;
        }
      }
    } catch (error) {
      console.error("Error during transcription process:", error);
    }
  }

  public getTranscribeableFiles = async (file: TFile) => {
    // Get all linked files in the markdown file
    const filesLinked = Object.keys(this.app.metadataCache.resolvedLinks[file.path]);

    // Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
    const filesToTranscribe: TFile[] = [];
    for (const linkedFilePath of filesLinked) {
      const linkedFileExtension = linkedFilePath.split(".").pop();
      if (
        linkedFileExtension === undefined ||
        !CopilotPlugin.transcribeFileExtensions.includes(linkedFileExtension.toLowerCase())
      ) {
        if (this.Transcriptionsettings.debug)
          console.log(
            "Skipping " +
              linkedFilePath +
              " because the file extension is not in the list of transcribeable file extensions"
          );
        continue;
      }

      // We now know that the file extension is in the list of transcribeable file extensions
      const linkedFile = this.app.vault.getAbstractFileByPath(linkedFilePath);

      // Validate that we are dealing with a file and add it to the list of verified files to transcribe
      if (linkedFile instanceof TFile) filesToTranscribe.push(linkedFile);
      else {
        if (this.Transcriptionsettings.debug) console.log("Could not find file " + linkedFilePath);
        continue;
      }
    }
    return filesToTranscribe;
  };

  public async transcribeAndWrite(
    parent_file: TFile,
    file: TFile,
    abortController: AbortController | null
  ) {
    try {
      if (this.Transcriptionsettings.debug) console.log("Transcribing " + file.path);

      const transcription = await this.transcriptionEngine.getTranscription(file);

      let fileText = await this.app.vault.read(parent_file);
      const fileLinkString = this.app.metadataCache.fileToLinktext(file, parent_file.path);
      const fileLinkStringTagged = `[[${fileLinkString}]]`;

      const startReplacementIndex =
        fileText.indexOf(fileLinkStringTagged) + fileLinkStringTagged.length;

      if (this.Transcriptionsettings.lineSpacing === "single") {
        fileText = [
          fileText.slice(0, startReplacementIndex),
          `${transcription}`,
          fileText.slice(startReplacementIndex),
        ].join(" ");
      } else {
        fileText = [
          fileText.slice(0, startReplacementIndex),
          `\n${transcription}`,
          fileText.slice(startReplacementIndex),
        ].join("");
      }

      //check if abortion signal is aborted

      if (abortController?.signal?.aborted) {
        new Notice(`Transcription of ${file.name} cancelled!`, 5 * 1000);
        return;
      }

      await this.app.vault.modify(parent_file, fileText);
    } catch (error) {
      // First check if 402 is in the error message, if so alert the user that they need to pay

      if (error?.message?.includes("402")) {
        new Notice(
          "You have exceeded the free tier.\nPlease upgrade to a paid plan at swiftink.io/pricing to continue transcribing files.\nThanks for using Swiftink!",
          10 * 1000
        );
      } else {
        if (this.Transcriptionsettings.debug) console.log(error);
        new Notice(`Error transcribing file: ${error}`, 10 * 1000);
      }
    } finally {
      // Clear the AbortController after completion or cancellation
      abortController = null;
    }
  }
  async onload(): Promise<void> {
    await this.loadSettings();
    this.settingsUnsubscriber = subscribeToSettingsChange(async (prev, next) => {
      if (next.enableEncryption) {
        await this.saveData(await encryptAllKeys(next));
      } else {
        await this.saveData(next);
      }
      registerCommands(this, prev, next);
    });
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Always have one instance of sharedState and chainManager in the plugin
    this.sharedState = new SharedState();

    this.vectorStoreManager = VectorStoreManager.getInstance();

    // Initialize BrevilabsClient
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    checkIsPlusUser();

    this.chainManager = new ChainManager(this.app, this.vectorStoreManager);

    // Initialize FileParserManager early with other core services
    this.fileParserManager = new FileParserManager(this.brevilabsClient, this.app.vault);

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));

    this.initActiveLeafChangeHandler();

    this.addRibbonIcon("message-square", "Open Copilot Chat", (evt: MouseEvent) => {
      this.activateView();
    });

    registerCommands(this, undefined, getSettings());

    IntentAnalyzer.initTools(this.app.vault);

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        const selectedText = editor.getSelection().trim();
        if (selectedText) {
          this.handleContextMenu(menu, editor);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          const file = leaf.view.file;
          if (file) {
            const activeCopilotView = this.app.workspace
              .getLeavesOfType(CHAT_VIEWTYPE)
              .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

            if (activeCopilotView) {
              const event = new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE);
              activeCopilotView.eventTarget.dispatchEvent(event);
            }
          }
        }
      })
    );

    await this.loadSettings();
    CopilotPlugin.plugin = this;
    console.log("Loading Obsidian Transcription");
    if (this.Transcriptionsettings.debug) console.log("Debug mode enabled");

    this.transcriptionEngine = new TranscriptionEngine(
      this.Transcriptionsettings,
      this.app.vault,
      this.statusBarReadwise,
      this.supabase,
      this.app
    );

    // Prompt the user to sign in if the have Swiftink selected and are not signed in
    if (this.Transcriptionsettings.transcriptionEngine == "swiftink") {
      this.user = await this.supabase.auth.getUser().then((res) => {
        return res.data.user || null;
      });
      if (this.user == null) {
        // First try setting the access token and refresh token from the settings
        if (this.Transcriptionsettings.debug)
          console.log("Trying to set access token and refresh token from settings");
        if (
          this.Transcriptionsettings.swiftink_access_token != null &&
          this.Transcriptionsettings.swiftink_refresh_token != null
        ) {
          await this.supabase.auth.setSession({
            access_token: this.Transcriptionsettings.swiftink_access_token,
            refresh_token: this.Transcriptionsettings.swiftink_refresh_token,
          });
          this.user = await this.supabase.auth.getUser().then((res) => {
            return res.data.user || null;
          });
        }

        // If the user is still null, prompt them to sign in

        if (this.user == null) {
          const noticeContent = document.createDocumentFragment();

          // Create the text node
          const textNode = document.createTextNode("Transcription: You are signed out. Please ");

          // Create the hyperlink
          const signInLink = document.createElement("a");
          //signInLink.href = SWIFTINK_AUTH_CALLBACK;
          signInLink.target = "_blank";
          signInLink.textContent = "Sign In";

          // Append the text and link to the document fragment
          noticeContent.appendChild(textNode);
          noticeContent.appendChild(signInLink);

          // Create the notice with the content
          const notice = new Notice(noticeContent, 16 * 1000);
          notice.noticeEl.addEventListener("click", () => {
            window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
          });
        }
      }
    }

    if (!Platform.isMobileApp) {
      this.statusBarReadwise = new StatusBarReadwise(this.addStatusBarItem());
      this.registerInterval(window.setInterval(() => this.statusBarReadwise.display(), 1000));
    }

    // Register the file-menu event
    this.registerEvent(this.app.workspace.on("file-menu", this.onFileMenu.bind(this)));

    this.addCommand({
      id: "obsidian-transcription-add-file",
      name: "Add File to Transcription",
      editorCallback: async () => {
        class FileSelectionModal extends Modal {
          onOpen() {
            const { contentEl } = this;
            contentEl.createEl("h2", { text: "Select files:" });
            const input = contentEl.createEl("input", {
              type: "file",
              attr: { multiple: "" },
            });
            contentEl.createEl("br");
            contentEl.createEl("br");
            const button = contentEl.createEl("button", { text: "Add file link" });
            button.addEventListener("click", () => {
              const fileList = input.files;
              if (fileList) {
                const files = Array.from(fileList);
                let path = "";
                for (const file of files) {
                  //     console.log(file)
                  //@ts-ignore
                  path = this.app.vault.getResourcePath(file).toString();
                  //console.log(path.toString())
                }
                // this.app.vault.copy

                // //@ts-ignore
                // let attachementFolder = this.app.vault.config.attachmentFolderPath;
                //@ts-ignore
                const basePath = this.app.vault.adapter.basePath;
                // console.log(attachementFolder);
                // console.log(basePath);

                const fe = new FileLink(path, basePath);

                files.forEach((file: File) => {
                  fe.embedFile(file);
                });
              }
            });
          }
        }
        new FileSelectionModal(this.app).open();
      },
    });

    this.addCommand({
      id: "obsidian-transcription-stop",
      name: "Stop Transcription",
      editorCallback: async () => {
        try {
          // Check if there is an ongoing transcription task
          if (this.ongoingTranscriptionTasks.length > 0) {
            console.log("Stopping ongoing transcription...");

            // Loop through each ongoing task and signal abort
            for (const { abortController, task } of this.ongoingTranscriptionTasks) {
              abortController.abort();
              await task.catch(() => {}); // Catch any errors during abortion
            }

            // Clear the ongoing transcription tasks after completion or cancellation
            this.ongoingTranscriptionTasks = [];
          } else {
            new Notice("No ongoing transcription to stop", 5 * 1000);
          }
        } catch (error) {
          console.error("Error stopping transcription:", error);
        }
      },
    });

    this.addCommand({
      id: "obsidian-transcription-transcribe-all-in-view",
      name: "Transcribe all files in view",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file === null) return;

        const filesToTranscribe = await this.getTranscribeableFiles(view.file);
        const fileNames = filesToTranscribe.map((file) => file.name).join(", ");
        new Notice(`Files Selected: ${fileNames}`, 5 * 1000);

        if (this.user == null && this.Transcriptionsettings.transcriptionEngine == IS_SWIFTINK) {
          this.pendingCommand = {
            parentFile: view.file,
          };

          window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
        } else {
          for (const fileToTranscribe of filesToTranscribe) {
            const abortController = new AbortController();
            const task = this.transcribeAndWrite(view.file, fileToTranscribe, abortController);
            this.ongoingTranscriptionTasks.push({ task, abortController });
            await task;
          }
        }
      },
    });

    this.addCommand({
      id: "obsidian-transcription-transcribe-specific-file-in-view",
      name: "Transcribe file in view",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        // Get the current filepath
        if (view.file === null) return;

        const filesToTranscribe = await this.getTranscribeableFiles(view.file);

        // Now that we have all the files to transcribe, we can prompt the user to choose which one they want to transcribe

        class FileSelectionModal extends FuzzySuggestModal<TFile> {
          public transcriptionInstance: CopilotPlugin; // Reference to Transcription instance

          constructor(app: App, transcriptionInstance: CopilotPlugin) {
            super(app);
            this.transcriptionInstance = transcriptionInstance;
          }

          getItems(): TFile[] {
            return filesToTranscribe;
          }

          getItemText(file: TFile): string {
            return file.name;
          }

          async onChooseItem(file: TFile) {
            if (view.file === null) return;

            new Notice(`File Selected: ${file.name}`, 5 * 1000);

            if (
              this.transcriptionInstance.user == null &&
              this.transcriptionInstance.Transcriptionsettings.transcriptionEngine == IS_SWIFTINK
            ) {
              this.transcriptionInstance.pendingCommand = {
                file: file,
                parentFile: view.file,
              };

              // Redirect to sign-in
              window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
            } else {
              const abortController = new AbortController();
              const task = this.transcriptionInstance.transcribeAndWrite(
                view.file,
                file,
                abortController
              );
              this.transcriptionInstance.ongoingTranscriptionTasks.push({
                task,
                abortController,
              });
              await task;
            }
          }
        }

        new FileSelectionModal(this.app, this).open();
      },
    });

    // Register a command to transcribe a media file when right-clicking on it
    // this.registerEvent(
    // 	// if (!Transcription.transcribeFileExtensions.includes(view.file.extension.toLowerCase())) return;
    // 	this.app.workspace.on("file-menu", (menu: Menu, file) => {
    // 		if (file instanceof TFolder) return;
    // 		// if (file.parent instanceof TFolder) return;
    // 		if (!(file instanceof TFile)) return;
    // 		console.log(file)
    // 		menu.addItem((item) => {
    // 			item
    // 				.setTitle("Transcribe File 🖊️")
    // 				.setIcon("document")
    // 				.onClick(async () => {
    // 					if (!Transcription.transcribeFileExtensions.includes(file.extension.toLowerCase())) return;
    // 					// transcribeAndWrite(file.parent, file)
    // 					new Notice(file.path);
    // 				});
    // 		});
    // 	})
    // );

    // Kill child processes when the plugin is unloaded
    this.app.workspace.on("quit", () => {
      CopilotPlugin.children.forEach((child) => {
        child.kill();
      });
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new TranscriptionSettingTab(this.app, this));

    this.registerObsidianProtocolHandler("swiftink_auth", async (callback) => {
      const params = new URLSearchParams(callback.hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        new Notice("Transcription: Error authenticating with Swiftink.io");
        return;
      }

      await this.supabase.auth.setSession({
        access_token: access_token,
        refresh_token: refresh_token,
      });
      this.user = await this.supabase.auth.getUser().then((res) => {
        return res.data.user || null;
      });
      new Notice("Successfully authenticated with Swiftink.io");

      // Save to settings
      this.Transcriptionsettings.swiftink_access_token = access_token;
      this.Transcriptionsettings.swiftink_refresh_token = refresh_token;
      await this.saveSettings();

      // Show the settings for user auth/unauth based on whether the user is signed in
      if (this.user == null) {
        this.querySelectionOnAuthentication(".swiftink-unauthed-only", "display: block !important");
        this.querySelectionOnAuthentication(".swiftink-authed-only", "display: none !important");
      } else {
        this.querySelectionOnAuthentication(".swiftink-unauthed-only", "display: none !important");
        this.querySelectionOnAuthentication(".swiftink-authed-only", "display: block !important");
        this.querySelectionOnAuthentication(".swiftink-manage-account-btn", "");
      }

      // Execute the pending command if there is one
      if (this.pendingCommand) {
        await this.executePendingCommand(this.pendingCommand);
        this.pendingCommand = null; // Reset pending command after execution
      }

      return;
    });

    this.registerObsidianProtocolHandler("swiftink_transcript_functions", async (callback) => {
      const id = callback.id;
      console.log(id);

      const functions = [
        "View on Swiftink.io",
        // "Delete from Swiftink.io",
        // "Download .txt",
        // "Download .srt",
        // "Copy text to clipboard",
        // "Copy summary to clipboard",
        // "Copy outline to clipboard",
        // "Copy keywords to clipboard",
      ];

      class SwiftinkTranscriptFunctionsModal extends FuzzySuggestModal<string> {
        getItems(): string[] {
          return functions;
        }

        getItemText(function_name: string): string {
          return function_name;
        }

        onChooseItem(function_name: string) {
          // new Notice(`Running ${function_name} on ${id}`);
          if (function_name == "View on Swiftink.io") {
            window.open("https://swiftink.io/dashboard/transcripts/" + id, "_blank");
          }
        }
      }

      new SwiftinkTranscriptFunctionsModal(this.app).open();
    });

    this.settingsManager = new SettingsManager(this);
    this.whisperSettings = await this.settingsManager.loadSettings();

    this.addRibbonIcon("activity", "Open recording controls", (evt) => {
      this.openRecordingControls();
    });

    this.addSettingTab(new WhisperSettingsTab(this.app, this));

    this.timer = new Timer();
    this.audioHandler = new AudioHandler(this);
    this.recorder = new NativeAudioRecorder();

    this.statusBarRecord = new StatusBarRecord(this);
    this.addCommand({
      id: "start-stop-recording",
      name: "Start/stop recording",
      callback: async () => {
        if (this.statusBarRecord.status !== RecordingStatus.Recording) {
          this.statusBarRecord.updateStatus(RecordingStatus.Recording);
          await this.recorder.startRecording();
        } else {
          this.statusBarRecord.updateStatus(RecordingStatus.Processing);
          const audioBlob = await this.recorder.stopRecording();
          const extension = this.recorder.getMimeType()?.split("/")[1];
          const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
          // Use audioBlob to send or save the recorded audio as needed
          await this.audioHandler.sendAudioData(audioBlob, fileName);
          this.statusBarRecord.updateStatus(RecordingStatus.Idle);
        }
      },
      hotkeys: [
        {
          modifiers: ["Alt"],
          key: "Q",
        },
      ],
    });

    this.addCommand({
      id: "upload-audio-file",
      name: "Upload audio file",
      callback: () => {
        // Create an input element for file selection
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "audio/*"; // Accept only audio files

        // Handle file selection
        fileInput.onchange = async (event) => {
          const files = (event.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            const file = files[0];
            const fileName = file.name;
            const audioBlob = file.slice(0, file.size, file.type);
            // Use audioBlob to send or save the uploaded audio as needed
            await this.audioHandler.sendAudioData(audioBlob, fileName);
          }
        };

        // Programmatically open the file dialog
        fileInput.click();
      },
    });

    this.addCommand({
      id: "open-recording-controls",
      name: "打开录音控制面板",
      callback: () => {
        this.openRecordingControls();
      },
    });
    this.registerEditorMenu();
  }
  onFileMenu(menu: Menu, file: TFile) {
    const parentFile = this.app.workspace.getActiveFile();

    // Check if the parent file is not null and the file is of a type you want to handle
    if (parentFile instanceof TFile && file instanceof TFile) {
      // Get the file extension
      const fileExtension = file.extension?.toLowerCase();

      // Check if the file extension is in the allowed list
      if (fileExtension && CopilotPlugin.transcribeFileExtensions.includes(fileExtension)) {
        // Add a new item to the right-click menu
        menu.addItem((item) => {
          item
            .setTitle("Transcribe")
            .setIcon("headphones")
            .onClick(async () => {
              if (
                this.user == null &&
                this.Transcriptionsettings.transcriptionEngine == IS_SWIFTINK
              ) {
                this.pendingCommand = {
                  file: file,
                  parentFile: parentFile,
                };
                // Redirect to sign-in
                window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
              }
              // Handle the click event
              const abortController = new AbortController();
              const task = this.transcribeAndWrite(parentFile, file, abortController);
              this.ongoingTranscriptionTasks.push({
                task,
                abortController,
              });
              await task;
            });
        });
      }
    }
  }

  async onunload() {
    // Clean up VectorStoreManager
    if (this.vectorStoreManager) {
      this.vectorStoreManager.onunload();
    }
    this.settingsUnsubscriber?.();

    console.log("Copilot plugin unloaded");

    if (this.Transcriptionsettings.debug) console.log("Unloading Obsidian Transcription");
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView && chatView.sharedState.chatHistory.length > 0) {
        await chatView.saveChat();
      }
    }
  }

  async processText(
    editor: Editor,
    eventType: string,
    eventSubtype?: string,
    checkSelectedText = true
  ) {
    const selectedText = await editor.getSelection();

    const isChatWindowActive = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      await this.activateView();
    }

    // Without the timeout, the view is not yet active
    setTimeout(() => {
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (activeCopilotView && (!checkSelectedText || selectedText)) {
        const event = new CustomEvent(eventType, { detail: { selectedText, eventSubtype } });
        activeCopilotView.eventTarget.dispatchEvent(event);
      }
    }, 0);
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    this.processText(editor, eventType, eventSubtype);
  }

  emitChatIsVisible() {
    const activeCopilotView = this.app.workspace
      .getLeavesOfType(CHAT_VIEWTYPE)
      .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

    if (activeCopilotView) {
      const event = new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE);
      activeCopilotView.eventTarget.dispatchEvent(event);
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        if (leaf.getViewState().type === CHAT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        // Default to the entire active file if no selection
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.cachedRead(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    this.processText(editor, eventType, customPrompt, false);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length > 0) {
      this.deactivateView();
    } else {
      this.activateView();
    }
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length === 0) {
      if (getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW) {
        await this.app.workspace.getRightLeaf(false).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      } else {
        await this.app.workspace.getLeaf(true).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      }
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
    this.emitChatIsVisible();
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    const savedSettings = await this.loadData();
    const sanitizedSettings = sanitizeSettings(savedSettings);
    setSettings(sanitizedSettings);
    this.Transcriptionsettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.Transcriptionsettings);
  }

  registerEditorMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        menu.addItem((item) => {
          item
            .setTitle("语音输入文字")
            .setIcon("microphone")
            .onClick(() => {
              this.openRecordingControls();
            });
        });
      })
    );
  }

  openRecordingControls() {
    if (!this.controls) {
      this.controls = new Controls(this);
    }
    this.controls.open();
  }
  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)

    // Add or update existing models in the map
    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        // If it's a built-in model, preserve the built-in status
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
        });
      } else {
        modelMap.set(key, model);
      }
    });

    return Array.from(modelMap.values());
  }

  handleContextMenu = (menu: Menu, editor: Editor): void => {
    registerContextMenu(menu, editor, this);
  };

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(this.app, chatFiles, this.loadChatHistory.bind(this)).open();
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(getSettings().defaultSaveFolder);
    if (!(folder instanceof TFolder)) {
      return [];
    }
    const files = await this.app.vault.getMarkdownFiles();
    return files.filter((file) => file.path.startsWith(folder.path));
  }

  async loadChatHistory(file: TFile) {
    const content = await this.app.vault.read(file);
    const messages = parseChatContent(content);
    this.sharedState.clearChatHistory();
    messages.forEach((message) => this.sharedState.addMessage(message));

    // Update the chain's memory with the loaded messages
    await updateChatMemory(messages, this.chainManager.memoryManager);

    // Check if the Copilot view is already active
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      // Only activate the view if it's not already open
      this.activateView();
    } else {
      // If the view is already open, just update its content
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    }
  }

  async customSearchDB(query: string, salientTerms: string[], textWeight: number): Promise<any[]> {
    const hybridRetriever = new HybridRetriever({
      minSimilarityScore: 0.3,
      maxK: 20,
      salientTerms: salientTerms,
      textWeight: textWeight,
    });

    const results = await hybridRetriever.getOramaChunks(query, salientTerms);
    return results.map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
    }));
  }
}

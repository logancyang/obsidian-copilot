// Inspired by
// https://github.com/renehernandez/obsidian-readwise/blob/eee5676524962ebfa7eaf1084e018dafe3c2f394/src/status.ts
export class StatusBar {
  private messages: StatusBarMessage[] = [];
  private currentMessage: StatusBarMessage | undefined;
  private statusBarEl: HTMLElement;

  constructor(statusBarEl: HTMLElement) {
    this.statusBarEl = statusBarEl;
  }

  // Return true if there is a message in the queue that is forced
  hasForcedMessage() {
    return this.messages.some((message) => message.force);
  }

  setText(message: StatusBarMessage) {
    this.statusBarEl.setText(message.message);
  }

  clearText() {
    this.statusBarEl.setText("");
  }

  displayMessage(message: string, timeout: number, force = false, kek_mode = false) {
    // Don't show the same message twice
    if (this.messages[0] && this.messages[0].message === message) return;

    this.messages.push(
      new StatusBarMessage(`Transcribe: ${message.slice(0, 100)}`, timeout, force, kek_mode)
    );
    this.display();
  }

  display() {
    // First check if there are any forced messages, if so, clear the queue and queue the last forced message
    if (this.hasForcedMessage()) {
      const lastForced = this.messages.filter((message) => message.force).pop();
      if (lastForced) this.messages = [lastForced];

      if (this.currentMessage !== lastForced) {
        this.currentMessage = lastForced;
        if (!this.currentMessage) return;
        this.currentMessage.timeShown = Date.now();
        this.setText(this.currentMessage);
      } else if (
        this.currentMessage == lastForced &&
        this.currentMessage &&
        this.currentMessage.messageTimedOut()
      ) {
        this.clearText();
      }
    }

    // Otherwise check if we need to do anything to the queue
    else {
      // If the current message has timed out, display the next message if there is one
      if (this.currentMessage && this.currentMessage.messageTimedOut()) {
        if (this.messages.length > 0) {
          const currentMessage = this.messages.shift();
          this.currentMessage = currentMessage;
          if (this.currentMessage) {
            this.setText(this.currentMessage);
            this.currentMessage.timeShown = Date.now();
          } else {
            this.currentMessage = undefined;
            this.clearText();
          }
        } else {
          this.currentMessage = undefined;
          this.clearText();
        }
      }
      // If there is no current message, display the next message if there is one
      else if (!this.currentMessage && this.messages.length > 0) {
        const currentMessage = this.messages.shift();
        this.currentMessage = currentMessage;
        if (!this.currentMessage) return;
        this.setText(this.currentMessage);
        this.currentMessage.timeShown = Date.now();
      } else if (!this.currentMessage) {
        this.clearText();
      }
    }
  }
}

class StatusBarMessage {
  message: string;
  timeout: number;
  force: boolean;
  timeShown: number;
  kek_mode: boolean;

  messageAge = function () {
    if (!this.timeShown) return 0;
    return Date.now() - this.timeShown;
  };

  messageTimedOut = function () {
    return this.messageAge() >= this.timeout;
  };

  constructor(message: string, timeout: number, force = false, kek_mode = false) {
    this.message = message;
    this.timeout = timeout;
    this.force = force;
    this.kek_mode = kek_mode;
  }
}

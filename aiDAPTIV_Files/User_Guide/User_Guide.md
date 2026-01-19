# Phison aiDAPTIV Obsidian User Guide

## Overview

Welcome to the Phison aiDAPTIV Obsidian User Guide! This comprehensive guide will walk you through the installation, setup, and usage of Phison's customized Obsidian plugin.

Phison aiDAPTIV Obsidian is an AI-powered knowledge assistant that leverages the innovative **aiDAPTIV+ kvcache** technology to provide lightning-fast responses to your note-related questions. By building a knowledge cache of your notes, it enables near-instantaneous answers and significantly enhances your note-taking and knowledge management experience.

This guide covers:

- Installation and setup procedures
- How to use the plugin with demo examples
- Troubleshooting common issues

Let's get started!

---

## Chapter 1: Installation and Setup

### 1.1 Install Obsidian

First, you need to install Obsidian on your Windows machine.

**Download Link:** [https://obsidian.md/download](https://obsidian.md/download)

**Steps:**

1. Visit the download link above
2. Select the **Windows** version
3. Download the installer
4. Run the installer and follow the installation wizard
5. Launch Obsidian after installation completes

### 1.2 Create or Open an Obsidian Vault

If you don't have an existing vault, create a new one:

**Steps:**

1. Launch Obsidian
2. Click **Create new vault**
3. Enter a vault name (e.g., `MyNotes`)
4. Choose a location to store your vault
5. Click **Create**

If you already have a vault, simply open it through Obsidian.

### 1.3 Download Phison aiDAPTIV+ Installation Package

Download the `aiDAPTIV_Files.zip` package which contains:

- **Installer** - Automated installation script
- **Example** - Demo note files for testing
- **User_Guide** - This documentation
- **Demo_Video** - Video tutorials

### 1.4 Install Phison aiDAPTIV Plugin (Automated)

We provide an automated installer that handles everything for you!

**Steps:**

1. **Extract** the downloaded `aiDAPTIV_Files.zip` to any location
2. **Open** the extracted `aiDAPTIV_Files` folder
3. **Double-click** `Install_Plugin.bat` to run the installer
4. **Enter** your Obsidian vault path when prompted
   - Example: `D:\Documents\Obsidian Vault`
5. **Wait** for the installation to complete

The installer will automatically:

- ✅ Create necessary plugin folders
- ✅ Extract and install the plugin files
- ✅ Copy the demo example note to your vault

### 1.5 Enable the Plugin in Obsidian

**Steps:**

1. **Restart** Obsidian (close and reopen)
2. Go to **Settings** (click the gear icon in the bottom-left corner)
3. Navigate to **Community plugins** in the left sidebar
4. If prompted, click **Turn on community plugins**
5. Find **aiDAPTIV-Integration-Obsidian** in the list
6. Toggle the switch to **enable** the plugin
7. You should see the Copilot icon appear in the left sidebar

**Congratulations!** You have successfully installed the Phison aiDAPTIV plugin.

---

## Chapter 2: How to Use?

### 2.1 Prepare Demo Example Files

If you used the automated installer, the demo example file (`Example_Note.md`) has already been copied to your vault!

You can verify by checking if the file appears in your Obsidian file explorer.

### 2.2 Build KV Cache

If this is the first time using the plugin with this note, please build the kvcache first.

**Steps:**

**a. Open the Demo Note**

1. In Obsidian, click on the demo note file to open it
2. The note should now be displayed in the editor

**b. Navigate to the Chat Panel**

1. Click on the **Copilot** icon in the left sidebar to open the chat panel
2. You should see the chat interface appear

**c. Build KV Cache**

1. In the chat panel, locate the **Relevant Notes** section
2. Click the **Build KV Cache** button on the top of the chatroom
3. Wait for the build process to complete

**Important Warning** ⚠️

- **You MUST wait until the build process is completely finished**
- **Do NOT close the panel** until the build is complete
- Interrupting the build process may result in an incomplete cache and degraded performance

**Build Time:** The build time varies depending on your note size. For the demo file, it typically takes 30 seconds.

### 2.3 Ask Questions About Your Notes

Once the kvcache build is complete, you're ready to experience the power of Phison aiDAPTIV+

**Steps:**

**a. Use the Chat Window**

1. **Open the Chat Panel**

   - Click on the **Copilot** icon in the left sidebar
   - The chat interface will appear

2. **Add Note Context**

   - Select the demo note from the dropdown list
   - The note will be added as context for your question

3. **Ask Your Question**

   - Type your question in the input box
   - For example:

   ```
   What are KV cache strategies?
   ```

   ```
   Explain how Dynamic Cache works
   ```

   ```
   What is the difference between BPE and WordPiece tokenization?
   ```

**b. Submit and Wait for Response**

1. Press **Enter** or click the **Send** button
2. Wait for the AI to process your question
3. The response will appear in the chat window

---

## Conclusion

Thank you for using Phison aiDAPTIV Obsidian! We hope this guide helps you get started quickly and make the most of the aiDAPTIV+ technology. The combination of AI assistance and optimized kvcache technology is designed to dramatically accelerate your knowledge management workflow.

**Key Takeaways:**

- ✅ Install Obsidian on your Windows machine
- ✅ Run `Install_Plugin.bat` to automatically install the plugin
- ✅ Enable the plugin in Obsidian settings
- ✅ Build the KV cache before asking questions
- ✅ Use `[[note]]` syntax for context-aware queries
- ✅ Experience lightning-fast AI responses

Happy note-taking! 🚀

# 🔍 Copilot for Obsidian
![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/logancyang/obsidian-copilot?style=for-the-badge&sort=semver) ![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22copilot%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=for-the-badge)


Copilot for Obsidian is a **free** and **open-source** ChatGPT interface right inside Obsidian. It has a minimalistic design and is straightforward to use.

- 💬 ChatGPT UI in Obsidian.
- 🛠️ Prompt AI with your writing using Copilot commands to get quick results.
- 🚀 Turbocharge your Second Brain with AI.
- 🧠 Talk to your past notes for insights.

My goal is to make this AI assistant **local-first** and **privacy-focused**. More features are under construction. Stay tuned!

<img src="./images/ui.png" alt="UI">

## 🛠️ Features
- Chat with ChatGPT right inside Obsidian in the Copilot Chat window.
- No repetitive login. Use your own API key (stored locally).
- No monthly fee. Pay only for what you use.
- Model selection of GPT-3.5 and GPT-4.
- No need to buy ChatGPT Plus to use GPT-4 **if you have API access**.
- No usage cap for GPT-4 like ChatGPT Plus.
- One-click copying any message as markdown.
- One-click saving the entire conversation as a note.
- One-click using the active note as context, and start a discussion around it.
- Easy commands to **simplify, emojify, summarize, translate, change tone, fix grammar, rewrite into a tweet/thread, count tokens** and more.
- Set your own parameters like LLM temperature, max tokens, conversation context based on your need (**pls be mindful of the API cost**).
- **NEW in v2.1.0**: **Unlimited context** when chatting with your long note, no more "context length exceeded" errors!!
- **NEW in v2.2.0**: **User custom prompt support added**! Now you can *add, apply, delete* your custom prompts, persisted in your local Obsidian environment!

## 🎬 Video Demos

#### 🎉 NEW in v2.2.0: User Custom Prompts!

<a href="https://www.youtube.com/watch?v=" target="_blank"><img src="./images/thumbnail2.png" /></a>

#### 🎉 NEW in v2.1.0: Unlimited Context Support for Active Note!

<a href="https://www.youtube.com/watch?v=2va-Bu7cMKw" target="_blank"><img src="./images/thumbnail1.png" /></a>

#### 🤗 New to Copilot? Quick Guide for Beginners:

<a href="https://www.youtube.com/watch?v=jRCDAg2sck8" target="_blank"><img src="./images/thumbnail.png" /></a>

- Chat with ChatGPT, copy messages to note, save entire conversation as a note
- QA around your past note
- Fix grammar and spelling, Summarize, Simplify, Emojify, Remove URLs
- Generate glossary, table of contents
- Translate to a language of your choosing
- Change tone: professional, casual, straightforward, confident, friendly
- Make longer/shorter
- Rewrite into a tweet/thread

#### 🔧 Copilot Settings

The settings page lets you set your own temperature, max tokens, conversation context based on your need.

You can also use your own system prompt, choose between different embedding providers such as OpenAI and Huggingface Inference API (free! New in v2.1.0).

<img src="./images/settings.png" alt="Settings" width="500">

## ⚙️ Installation

Copilot for Obsidian is now available in **Obsidian Community Plugin**!

- Open Community Plugins settings page, click on the Browse button.
- Search for "Copilot" in the search bar and find the plugin with this exact name.
- Click on the Install button.
- Once the installation is complete, enable the Copilot plugin by toggling on its switch in the Community Plugins settings page.

Now you can see the chat icon in your leftside ribbon, clicking on it will open the chat panel on the right! Don't forget to check out the Copilot commands available in the commands palette!

#### ⛓️ Manual Installation
- Go to the latest release
- Download `main.js`, `manifest.json`, `styles.css` and put them under `.obsidian/plugins/obsidian-copilot/` in your vault
- Open your Obsidian settings > Community plugins, and turn on `Copilot`.

## 🔔 Note
- The chat history is not saved by default. Please use "**Save as Note**" to save it. The note will have a title `Chat-Year_Month_Day-Hour_Minute_Second`, you can change its name as needed.
- "**New Chat**" clears all previous chat history. Again, please use "**Save as Note**" if you would like to save the chat.
- "**Use Active Note as Context**" creates a local vector index for the active note so that you can chat with super long note! To start the QA, please switch from "Conversation" to "QA: Active Note" in the Chain Selection dropdown.
- You can set a very long context in the setting "**Conversation turns in context**" if needed.

#### 📣 Again, please always be mindful of the API cost if you use GPT-4 with a long context!

## 🤔 FAQ (please read before submitting an issue)

<details>
  <summary>Unresponsive QA when using Huggingface as the Embedding Provider</summary>

  - Huggingface Inference API is free to use. It can give errors such as 503 or 504 frequently at times because their server has issues. If it's an issue for you, please consider using OpenAI as the embedding provider. Just keep in mind that it can cost more, especially with very long notes as context.
</details>
<details>
  <summary>"model_not_found"</summary>

  - A common misunderstanding I see is that some think they have access to GPT-4 API when they get ChatGPT Plus subscription. That is not true. *You need to get access to GPT-4 API to use the GPT-4 model in this plugin*. Please check if you can successfully use your model in the OpenAI playground first https://platform.openai.com/playground?mode=chat&model=gpt-4. If not, you can apply for GPT-4 API access here https://openai.com/waitlist/gpt-4-api. Once you have access to the API, you can use GPT-4 with this plugin without the ChatGPT Plus subsciption!
  - Reference issue: https://github.com/logancyang/obsidian-copilot/issues/3#issuecomment-1544583676
</details>
<details>
  <summary>"insufficient_quota"</summary>

  - It might be because you haven't set up payment for your OpenAI account, or you exceeded your max monthly limit. OpenAI has a cap on how much you can use their API, usually $120 for individual users.
  - Reference issue: https://github.com/logancyang/obsidian-copilot/issues/11
</details>
<details>
  <summary>"context_length_exceeded"</summary>

  - GPT-3.5 has a 4096 context token limit, GPT-4 has 8K (there is a 32K one available to the public soon per OpenAI). So if you set a big token limit in your Copilot setting, you can get this error. Note that the prompts behind the scenes for Copilot commands can also take up tokens, so please limit your message length to avoid this error. (For QA with Unlimited Context, use the "QA: Active Note" chain in the dropdown! Requires Copilot v2.1.0.)
  - Reference issue: https://github.com/logancyang/obsidian-copilot/issues/1#issuecomment-1542934569
</details>

When opening an issue, please include relevant console logs. You can go to Copilot's settings and turn on "Debug mode" at the bottom for more console messages!

## 📝 Planned features (based on feedback)
- More standard prompts that can be used with commands
- User custom prompts
- Online prompt library access
- Unlimited context for a collection of notes
- Integration with more LLMs, including open-source and local ones

## 🙏 Say Thank You
If you are enjoying Copilot, please support my work by buying me a coffee here: https://www.buymeacoffee.com/logancyang


<a href="https://www.buymeacoffee.com/logancyang" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 150px !important;" ></a>

Please also help spread the word by sharing about the Copilot for Obsidian Plugin on Twitter, Reddit, or any other social media platform you use.

You can find me on Twitter [@logancyang](https://twitter.com/logancyang).

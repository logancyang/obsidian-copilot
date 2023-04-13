# Obsidian Copilot
- ChatGPT integration in Obsidian.
- Turbocharge your Second Brain with AI.
- Talk to your past notes for insights.

Take your note-taking game to the next level with the Obsidian Copilot Plugin!

## Features
- Chat with ChatGPT right in Obsidian in the Copilot Chat window.
- No repetitive login. Use your own API key.
- No monthly fee. Pay only for what you use.
- Model selection of GPT-3.5 and GPT-4.
- No need to buy ChatGPT Plus to use GPT-4 if you have API access.
- No usage cap for GPT-4 like ChatGPT Plus.
- One-click copying any message as markdown.
- One-click saving the entire conversation as a note right inside Obsidian
- One-click using the active note as context, and start a discussion around it (currently only supports shorter notes)
- Set your own parameters like LLM temperature, max tokens, conversation context based on your need (**pls be mindful of the API cost**).

## Demo
Chat with ChatGPT, copy a message to note, or save entire conversation as a note:
![Demo0](./images/demo0.gif)

QA around your past note:
![Demo1](./images/demo1.gif)

The settings page
<img src="./images/settings-page.png" alt="Settings" width="500">

## Planned features (based on feedback)
- More standard prompts that can be used with commands
- User customized prompts
- Online prompt library access
- Add support for having unlimited context, i.e. QA against very long notes, a collection of notes or the entire vault
- Integration with ChatGPT plugins when I get access

## Note
- The chat history is not saved by default. Please use "**Save as Note**" to save it. The note will have a title `Chat-Year_Month_Day-Hour_Minute_Second`, you can change its name as needed.
- "**New Chat**" clears all previous chat history. Again, please use "**Save as Note**" if you would like to save the chat.
- "**Use Active Note as Context**" does not support super long notes yet since the OpenAI API has a limited context length (currently about 4K, 8K, or 32K tokens depending on the model you use). In the future I'm considering supporting very long notes / a folder of notes / the entire vault as context if there is enough demand.
- You can set a very long context in the setting "**Conversation turns in context**" if needed.

### Again, please always be mindful of the API cost if you use GPT-4 with a long context!

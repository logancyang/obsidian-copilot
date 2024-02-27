# Local Copilot Setup Guide

## LM Studio

[LM Studio](https://lmstudio.ai/) has the best UI for running local models, it has support for Apple Silicon, Windows, and Linux (in beta). After you download the correct version of LM Studio to your machine, the first thing is to download a model. Find something small to start with, such as Mistral 7B, and work your way up if you have a beefy machine.

A rule of thumb to determine how large a model you can run:
- If you are on an Apple Silicon Mac, look at your RAM
- If you are on a Windows PC with a GPU, look at your VRAM.

After you set your model and preset, you are free to test it out in LM Studio's Chat tab, making sure everything is working. Now you can find the Local Server tab, make sure you have `CORS` enabled, turn on hardware acceleration based on the type of device you have, and click Start Server. This will enable Copilot for Obsidian to access it.

Notice that LM Studio doesn't require the user to do anything in the terminal whatsoever. It is the most user-friendly way to run local models on the market now!

Here's an example for Apple Metal macs. I can run 7B models blazingly fast on my tiny Macbook Air M1 2020 with 16GB RAM!

<img src="./images/lm-studio.png" alt="LM Studio">

Pick LM STUDIO (LOCAL) in the model dropdown, and start chatting!

<img src="./images/lm-studio-model-pick.png" alt="LM Studio Model">

## Ollama

[Ollama](https://ollama.ai/) currently supports Mac and Linux, they mentioned that Windows is coming soon.

Go to their website, download, install Ollama and its command line tool on your machine.

You can download your model by running either `ollama run <model_name>` or `ollama pull <model_name>` in your terminal. The default model is Llama 2 7B. But here let me use Mistral 7B as an example again.

The `ollama run mistral` command downloads and starts a chat with Mistral 7B right inside the terminal. But that is not what we want. We want a local server for our plugin.

#### Important note about setting context window

AFAIK `ollama serve` doesn't have a consolidated way to configure context window for all the models at a single place. The current best way is to run `ollama run <modelname>` and then `/set parameter num_ctx 32768` (this is the max for Mistral, set it based on your model requirement), and don't forget to `/save` for each model individually.

Remember that you MUST set this parameter for Ollama models, or they will silently fail and you will think your long prompt successfully reached the model!

Look for this parameter `llama_new_context_with_model: n_ctx` in your server log, it is your true context window setting:

<img src="./images/ollama-context-window.png" alt="Ollama context window">

#### Start Ollama server for Obsidian

Now, **start the local server with `OLLAMA_ORIGINS=app://obsidian.md* ollama serve`, this will allow the Obsidian app to access the local server without CORS issues**.

Again, `OLLAMA_ORIGINS=app://obsidian.md*` is required!

<img src="./images/ollama-serve.png" alt="Ollama">

Inside Copilot settings, enter `mistral` under Ollama model

<img src="./images/ollama-setting.png" alt="Ollama">

Pick OLLAMA (LOCAL) in the model dropdown and start chatting!

#### Ollama for Windows (Preview)

Ollama has released a Windows preview version! Just download it to your Windows machine, open your PowerShell, and 

```
ollama pull <model>
# Remember to close the Ollama app first to free up the port
$env:OLLAMA_ORIGINS="app://obsidian.md*"; ollama serve
```

#### Now, go crazy with local models using your custom prompts!

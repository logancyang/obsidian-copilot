## How to setup LocalAI on Apple Silicon

https://localai.io/basics/build/#build-on-mac
First, make sure in your terminal, `arch` shows `arm64` and not `i386`. The latter is Rosetta. If you are running Rosetta, find your terminal app and right click, find Get Info window and uncheck "Open using Rosetta".

```bash
# install build dependencies
# make sure arch shows arm64, you are not running terminal in Rosetta
# and your brew is installed for Apple Silicon, not x86! (I tripped here)
brew install cmake
brew install go

# clone the repo
git clone https://github.com/go-skynet/LocalAI.git

cd LocalAI

# build the binary
make build

# Start localai with model gallery
GALLERIES='[{"name":"model-gallery", "url":"github:go-skynet/model-gallery/index.yaml"}, {"url": "github:go-skynet/model-gallery/huggingface.yaml","name":"huggingface"}]' ./local-ai --models-path ./models/ --debug

# Check if model is available in the model gallery
curl http://localhost:8080/models/available | jq '.[] | select(.name | contains("llama2"))'

# Download a llama-2 variant (note: ggml for Apple Silicon, GPTQ for CUDA)
# Here I chose the openassistant 13b orca ggml q4 variant
curl http://localhost:8080/models/apply -H "Content-Type: application/json" -d '{
    "id": "huggingface@thebloke__openassistant-llama2-13b-orca-8k-3319-ggml__openassistant-llama2-13b-orca-8k-3319.ggmlv3.q4_k_s.bin",
    "name": "llama-2-13b-q4ks"
	}'
# {"uuid":"<uuid>","status":"http://localhost:8080/models/jobs/<uuid>"}

# Check status, fill in the uuid from above
curl http://localhost:8080/models/jobs/<uuid>

# Test
curl http://localhost:8080/v1/chat/completions -H "Content-Type: application/json" -d '{
     "model": "llama-2-13b-q4ks",
     "messages": [{"role": "user", "content": "How are you?"}],
     "temperature": 0.9
   }'
```

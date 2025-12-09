# VLM (Vision Language Model) Image Comparison

AI-powered semantic image comparison using Vision Language Models via Ollama.

## Quick Start

### 1. Install & Start Ollama

```bash
# Install (macOS)
brew install ollama

# Start Ollama
ollama serve
```

### 2. Download a Model

```bash
# Recommended for accuracy
ollama pull llava:7b

# Or for speed (smaller, less accurate)
ollama pull moondream
```

### 3. Configure Backend

Add to `.env`:
```bash
OLLAMA_BASE_URL=http://localhost:11434
```

### 4. Use VLM in Project

Set project's image comparison to `vlm` with config:
```json
{
  "model": "llava:7b",
  "temperature": 0.1
}
```

Optional custom prompt:
```json
{
  "model": "llava:7b",
  "prompt": "Focus on button colors and text changes",
  "temperature": 0.1
}
```

## Recommended Models

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| `llava:7b` | 4.7GB | ⚡⚡ | ⭐⭐⭐ | **Recommended** - best balance |
| `llava:13b` | 8GB | ⚡ | ⭐⭐⭐⭐ | Best accuracy |
| `moondream` | 1.7GB | ⚡⚡⚡ | ⭐⭐ | Fast, may hallucinate |
| `minicpm-v` | 5.5GB | ⚡⚡ | ⭐⭐⭐ | Good alternative |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | `moondream` | Ollama vision model name |
| `prompt` | string | `""` | Custom context prepended to system prompt |
| `temperature` | number | `0.1` | Lower = more consistent results |

## How It Works

1. VLM analyzes both images semantically
2. Returns `YES` (pass) or `NO` (fail) based on meaningful differences
3. Ignores technical differences (anti-aliasing, sub-pixel, minor spacing)
4. Provides description of differences found

## API Endpoints

```bash
# List available models
GET /ollama/models

# Compare two images (for testing)
POST /ollama/compare?model=llava:7b&prompt=<prompt>&temperature=0.1
```

**Example:**
```bash
curl -X POST "http://localhost:3000/ollama/compare?model=llava:7b&prompt=Are%20these%20images%20the%20same&temperature=0.1" \
  -F "images=@baseline.png" \
  -F "images=@comparison.png"
```

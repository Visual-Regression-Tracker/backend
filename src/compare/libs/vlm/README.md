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

Optional custom prompt (replaces default system prompt):
```json
{
  "model": "llava:7b",
  "prompt": "Focus on button colors and text changes",
  "temperature": 0.1
}
```

**Note:** The `prompt` field replaces the entire system prompt. If omitted, a default system prompt is used that focuses on semantic differences while ignoring rendering artifacts.

## Recommended Models

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| `llava:7b` | 4.7GB | ⚡⚡ | ⭐⭐⭐ | **Recommended** - best balance (minimal) |
| `gemma3:latest` | ~ | ⚡⚡ | ⭐⭐⭐ | Minimal model option |
| `llava:13b` | 8GB | ⚡ | ⭐⭐⭐⭐ | Best accuracy |
| `moondream` | 1.7GB | ⚡⚡⚡ | ⭐⭐ | Fast, may hallucinate |
| `minicpm-v` | 5.5GB | ⚡⚡ | ⭐⭐⭐ | Good alternative |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | `llava:7b` | Ollama vision model name |
| `prompt` | string | System prompt (see below) | Custom prompt for image comparison |
| `temperature` | number | `0.1` | Lower = more consistent results (0.0-1.0) |

## How It Works

1. VLM analyzes both images semantically
2. Returns JSON with `{"identical": true/false, "description": "..."}` 
3. `identical: true` = images match (pass), `identical: false` = differences found (fail)
4. Ignores technical differences (anti-aliasing, shadows, 1-2px shifts)
5. Provides description of differences found

### Default System Prompt

The default prompt instructs the model to:
- **CHECK** for: data changes, missing/added elements, state changes, structural differences
- **IGNORE**: rendering artifacts, anti-aliasing, shadows, minor pixel shifts

## API Endpoints

```bash
# List available models
GET /ollama/models

# Compare two images (for testing)
POST /ollama/compare?model=llava:7b&prompt=<prompt>&temperature=0.1
```

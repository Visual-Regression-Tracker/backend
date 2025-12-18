# VLM (Vision Language Model) Image Comparison

Hybrid image comparison combining pixelmatch for objective difference detection and Vision Language Models (via Ollama) for human-noticeability analysis.

## Architecture Flow

```text
VLM Comparison Request
         │
         ▼
Run Pixelmatch Comparison
         │
         ├─→ No Differences Found → Return OK Status
         │
         └─→ Differences Found
                  │
                  ▼
            Save Diff Image
                  │
                  ▼
    Run VLM with 3 Images:
    (Baseline, Comparison, Diff)
                  │
                  ├─→ Not Noticeable → Override: Return OK Status
                  │
                  └─→ Noticeable → Return Unresolved with VLM Description
```

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
ollama pull gemma3:12b

# Note: Smaller models do not show proper results - use gemma3:12b only
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
  "model": "gemma3:12b",
  "temperature": 0.1
}
```

Optional custom prompt (replaces default system prompt):
```json
{
  "model": "gemma3:12b",
  "prompt": "Focus on button colors and text changes",
  "temperature": 0.1
}
```

**Note:** The `prompt` field replaces the entire system prompt. If omitted, a default system prompt is used that analyzes the diff image to determine if highlighted differences are noticeable to humans.

## Recommended Models

| Model | Size |
|-------|------|
| `gemma3:12b` | ~12GB - **Recommended** |

**Note:** Models smaller than the default (`gemma3:12b`) have been tested and do not show proper results. They fail to follow structured output formats reliably and may produce incorrect or inconsistent responses. For production use, only use `gemma3:12b` or `llava:13b`.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | `gemma3:12b` | Ollama vision model name |
| `prompt` | string | System prompt (see below) | Custom prompt for image comparison |
| `temperature` | number | `0.1` | Lower = more consistent results (0.0-1.0) |

## API Endpoints

```bash
# List available models
GET /ollama/models

# Compare two images (for testing)
POST /ollama/compare?model=gemma3:12b&prompt=<prompt>&temperature=0.1
```

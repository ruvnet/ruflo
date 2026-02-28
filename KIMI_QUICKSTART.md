# Kimi-First Quick Start

This fork of Anthill uses **Moonshot (Kimi)** as the default LLM provider.

## 1. Get Moonshot API Key

1. Go to [Moonshot AI](https://platform.moonshot.cn/)
2. Create an account
3. Generate an API key from the dashboard

## 2. Configure

```bash
# Copy the example config
cp .env.example .env

# Edit .env and add your Moonshot API key
MOONSHOT_API_KEY=your_key_here
```

## 3. Run

```bash
# Initialize with Kimi defaults
npx anthill@latest init --config config/kimi-default.json

# Or use environment variables
export MOONSHOT_API_KEY=your_key_here
npx anthill@latest init
```

## Available Kimi Models

| Model | Context | Best For |
|-------|---------|----------|
| `kimi-k2-5` | 256k | Default - balanced performance |
| `kimi-k2` | 256k | Fast responses |
| `kimi-k2-thinking` | 256k | Complex reasoning tasks |

## Switching to Other Providers

While Kimi is default, you can still use others:

```bash
# Use Claude for specific task
anthill run --provider anthropic --model claude-3-5-sonnet

# Use GPT-4
anthill run --provider openai --model gpt-4o
```

## Why Kimi?

- **256k context length** - Handles large codebases
- **Competitive pricing** - $0.002/$0.008 per 1k tokens
- **Strong reasoning** - K2 Thinking model for complex tasks
- **Fast** - Low latency for interactive use

## Need Help?

- [Moonshot Documentation](https://platform.moonshot.cn/docs)
- [Anthill Discord](https://discord.com/invite/dfxmpwkG2D)

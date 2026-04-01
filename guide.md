# Guide: Start The Assistant

This guide shows exactly how to run your local assistant with Ollama and coding-agent mode.

## 1. Open two terminals

- Terminal A: run Ollama server
- Terminal B: run the assistant

## 2. Terminal A (Ollama)

Start Ollama:

```bash
ollama serve
```

If you do not have a model yet:

```bash
ollama pull llama3.2
```

## 3. Terminal B (Assistant)

Go to your project:

```bash
cd /Users/albz/Code/ClaudIA
```

Start the assistant:

```bash
node mvp-assistant/assistant-cli.mjs
```

## 4. Enable LLM + coding agent inside the CLI

At the `assistant>` prompt:

```text
/llm on
/model llama3.2
/agent on
```

Check status:

```text
/llm status
/agent status
```

## 5. Run your first coding task

Example:

```text
/code find where BashTool is registered and return the file path
```

## 6. Useful commands

- `/help` show all commands
- `/ask <prompt>` ask Ollama directly (no tool loop)
- `/code <task>` run tool-based coding task
- `/note add <text>` save a note
- `/todo add <text>` add a todo
- `/exit` close the assistant

## Troubleshooting

- Ollama unreachable:
Ensure `ollama serve` is running.
Check `/llm status`.
Pull model again: `ollama pull llama3.2`.
- Wrong Ollama URL:
Set it in CLI: `/ollama-url http://127.0.0.1:11434`.
- Different model:
Set it in CLI: `/model qwen2.5-coder:7b`.

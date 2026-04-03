# Guide: Run Lupin Locally

This guide covers the runnable local scaffold that exists in this repo today: `restore-core/`.

## 1. Open two terminals

- Terminal A: run Ollama
- Terminal B: run Lupin

## 2. Terminal A

Start Ollama:

```bash
ollama serve
```

Pull a model if needed:

```bash
ollama pull llama3.2
```

## 3. Terminal B

From the repository root:

```bash
cd /Users/albz/Code/ClaudIA
node restore-core/src/index.mjs
```

Or use the local package entrypoint:

```bash
cd /Users/albz/Code/ClaudIA/restore-core
npm run start
```

## 4. Useful commands inside Lupin

- `/health`
- `/init`
- `/context`
- `/files [regex]`
- `/read <path>`
- `/grep <pattern> [--path <path>]`
- `/bash <command>`
- `/mode code`
- `/mode chat`
- `/mode auto`
- `/ask <prompt>`
- `/mg help`

## 5. First tasks to try

```text
/init
/context
/code inspect this repository and list key entry files
```

## 6. Environment defaults

- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=llama3.2`
- `AGENT_MODE=code`
- `AGENT_DENY_DANGEROUS_BASH=1`

## Troubleshooting

- If Ollama is unreachable, make sure `ollama serve` is running and pull a model again.
- If you want a different model, set `OLLAMA_MODEL` before launch.
- If you want to target another project, run `node restore-core/src/index.mjs --project-root /absolute/path/to/project`.

---
title: Create tmux aliases for session management
threadId: T-019b7150-8e68-746c-b012-925bde9b5d82
created: 2025-12-30T22:11:03.402Z
agentMode: smart
---

# Create tmux aliases for session management

## User

can we make a zshrc alias for tmux new -s <name> tht is tx n <name> 
same for attach make it tx a <name>



## Assistant

I'll add these as functions to your `.zshrc` since they need to accept arguments.

**Tool Use:** `Bash`

```json
{
  "cmd": "cat ~/.zshrc 2>/dev/null | tail -20"
}
```

## User

**Tool Result:** `toolu_vrtx_01T6xk92sfyWAkv5ByFADZTM`

```
{
  "output": "}\nPROMPT_COMMAND=prompt_command\n# Auto-activate global uv environment if not already in a venv\nif [[ -z \"$VIRTUAL_ENV\" && -f ~/.venv/bin/activate ]]; then\n    source ~/.venv/bin/activate\nfi\n\n# fnm\nFNM_PATH=\"/Users/hamel/Library/Application Support/fnm\"\nif [ -d \"$FNM_PATH\" ]; then\n  export PATH=\"/Users/hamel/Library/Application Support/fnm:$PATH\"\n  eval \"`fnm env`\"\nfi\n\nexport KIT_API_KEY=\"[REDACTED:api-key]\"\n\n# ElevenLabs API\nexport ELEVENLABS_API_KEY=[REDACTED:api-key]\n",
  "exitCode": 0
}
```

## Assistant

**Tool Use:** `Bash`

```json
{
  "cmd": "cat >> ~/.zshrc << 'EOF'\n\n# tmux shortcuts\ntx() {\n  case \"$1\" in\n    n) tmux new -s \"$2\" ;;\n    a) tmux attach -t \"$2\" ;;\n    *) echo \"Usage: tx n <name> | tx a <name>\" ;;\n  esac\n}\nEOF"
}
```

## User

**Tool Result:** `toolu_vrtx_018kxAiggM4ReEjS2eUAoJUu`

```
{
  "output": "",
  "exitCode": 0
}
```

## Assistant

Done. Added a `tx` function to `~/.zshrc`. Run `source ~/.zshrc` or open a new terminal, then use:
- `tx n myproject` — creates new session
- `tx a myproject` — attaches to existing session

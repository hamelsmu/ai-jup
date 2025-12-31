# ai-jup code review (principal engineer perspective)

Date: 2025-12-31  
Repo: `ai-jup` (JupyterLab extension + Jupyter Server extension)

## Scope

- TypeScript frontend (`src/`): prompt cells, context gathering, SSE client, UI affordances.
- Python backend (`ai_jup/`): Tornado handlers, Anthropic streaming, tool execution via kernel.
- Tests/tooling/CI: `tests/`, `ui-tests/`, `justfile`, GitHub Actions.

## What I ran

- `just test` phase 1: ✅ TypeScript Jest tests + Python unit/mocked tests passed.
- `just test` phase 2: ❌ failed locally with `PermissionError: [Errno 1] Operation not permitted` when binding an ephemeral port (looks like a sandbox/network restriction rather than product behavior).

## Executive summary

The product concept and current implementation are compelling: prompt cells + variable/function references + streaming + tool loop. The overall architecture is heading in the right direction (frontend collects context, backend owns LLM + tool loop, tool execution runs in-kernel).

## ✅ Addressed issues

The following P0 issues from the original review have been addressed:

- **P0.1 Tool argument handling** - Already fixed. Code uses `_validate_tool_args()` with `TOOL_NAME_RE` to reject malicious arg names, and JSON encoding → string literal → `json.loads()` in kernel (never interpolating args into code).
- **P0.2 Backend streaming blocking Tornado** - Fixed by switching to `AsyncAnthropic` with `async with client.messages.stream()` and `async for event in stream`.
- **P0.3 Frontend context gathering / windowing** - Refactored to use `notebook.model.cells.get(i)` instead of `notebook.widgets[i]` for context gathering. (Note: Oracle analysis found the original concern was overstated - JupyterLab 4 windowing doesn't shrink `notebook.widgets`.)
- **P1.5 Excessive console.log** - Removed debug logs from `stylePromptCells`.

## P1 (high impact) improvements

### P1.1 Request/response contract and input validation should be explicit and consistent

Where:
- `ai_jup/handlers.py:24` (PromptHandler input parsing)
- `ai_jup/handlers.py:584` (ToolExecuteHandler input parsing)
- `src/promptModel.ts:103` (frontend error handling expects JSON on non-2xx)

Issues:
- `PromptHandler` validates `data` is a dict and returns `400` for invalid JSON body; `ToolExecuteHandler` does not (it assumes `data.get` exists).
- `PromptHandler` sets SSE headers early (`ai_jup/handlers.py:46`) then sometimes replies with JSON errors. That's awkward for clients and proxies.

Suggested direction:
- Validate before setting SSE headers:
  - If input invalid: return `400 application/json`
  - If auth/key missing: return `401/403/500 application/json`
  - Only once you are ready to stream: set `text/event-stream` and stream structured `{"error": ...}` events on failures.
- Consider a small internal "request schema" validator:
  - `prompt: str`, `context: dict`, `kernel_id: Optional[str]`, `max_steps: int in [0..N]`, etc.

### P1.2 Tool execution result parsing is brittle when tools print to stdout

Where:
- `ai_jup/handlers.py:400` and `ai_jup/handlers.py:797` style: output buffer joined then `json.loads(result_text)`

Problem:
- Kernel execution collects *all* stdout/execute_result content. If user tool prints anything before the final JSON payload, JSON parsing fails and you fall back to "text". That can:
  - hide structured "success" payloads
  - produce confusing results for the tool loop

Suggested fix:
- Emit a sentinel line for the machine payload (e.g. `print("AI_JUP_RESULT:" + json.dumps(...))`) and parse only the last sentinel line.
- Or use `user_expressions`/`execute_reply` metadata for structured return when possible.

### P1.3 Prompt processing destroys markdown formatting (function removal collapses whitespace)

Where:
- `src/promptParser.ts:74` (`removeFunctionReferences` does `.replace(/\\s+/g, ' ')`)

Problem:
- Prompt cells are markdown. Collapsing all whitespace into single spaces removes intentional newlines/lists/code blocks and changes meaning.

Suggested fix:
- Remove only the `&\`name\`` substrings and then do **minimal** whitespace cleanup:
  - collapse repeated spaces on the same line, not newlines
  - fix "space before punctuation" (`"Use , please"` → `"Use, please"`)
  - avoid touching content inside fenced code blocks if you intend to support markdown-with-code.

### P1.4 Unused/partial DI tokens and factories

Where:
- `src/tokens.ts` defines `IPromptModelFactory`, but no plugin provides it.
- `src/kernelConnector.ts` exports `KernelConnectorFactory`, but the plugin constructs `KernelConnector` directly (`src/index.ts:70`).

Why it matters:
- Either commit to DI (good for testability/extensibility) or keep it simple. Half-adopted DI tends to accumulate dead code and confusion.

Suggested fix:
- Either:
  - add a `promptModelFactoryPlugin` that provides `IPromptModelFactory` and have `PromptCellManager` depend on it, or
  - remove the unused token/factory to reduce surface area.

## P2 (medium) improvements / design cleanups

### P2.1 Tool loop semantics: clarify `max_steps` meaning and edge cases

Where:
- `ai_jup/handlers.py:42` (`max_steps = int(...)`)
- `ai_jup/handlers.py:145` (`steps >= max_steps`)

Questions:
- Is `max_steps` "number of tool-iterations" or "number of tool calls"? Right now it's loop iterations, but each iteration can run multiple tools (`execute ALL tool use blocks`).
- Decide and document: users will tune this.

Suggested fix:
- Rename internally to `max_iterations` or implement `max_tool_calls` separately.
- Add guards (min/max, default) and reflect the same in frontend settings.

### P2.2 Limit context size to prevent token blowups

Where:
- `src/promptCell.ts:257` (`preceding_code: precedingCode.join(...)`)
- `ai_jup/handlers.py:466+` (system prompt includes full preceding code)

Suggested fix:
- Add a context budget strategy:
  - last N code cells
  - max total chars for `preceding_code`
  - max variables/functions count
  - max total image bytes / max image count
  - (optional) summarization step (but that's a much larger feature)

### P2.3 Convert-to-cells parsing should use a markdown parser, not regex

Where:
- `src/promptCell.ts:629` (`codeBlockRegex = /```(\\w*).../g`)

Issues:
- Regex parsing will fail on nested fences, indented fences, triple backticks inside code, or language ids like `python-repl`.
- It discards formatting and doesn't preserve non-code markdown blocks well.

Suggested fix:
- Use `marked` (already in deps) lexer/tokenizer to split into code vs paragraph/list tokens, then reconstruct cells.
- Consider preserving original markdown including lists, headings, and spacing.

### P2.4 Keybinding selector likely incorrect / brittle

Where:
- `src/index.ts:149` selector `.jp-Notebook.jp-mod-commandMode:not(.jp-mod-readWrite) :focus`

Why it matters:
- Keybinding selectors are notoriously fragile across JupyterLab versions/themes.
- The `:not(.jp-mod-readWrite)` looks suspicious (many notebooks are "readWrite" by default).

Suggested fix:
- Validate selector with JupyterLab's keybinding debug tools.
- Consider scoping to notebook element without `:focus` or using `.jp-Notebook:focus-within`.

### P2.5 Multi-tenant safety (kernel_id authorization)

Where:
- `ai_jup/handlers.py:67` and `ai_jup/handlers.py:623`

Risk:
- If this extension is used in any multi-user Jupyter environment, accepting arbitrary `kernel_id` without verifying ownership/session could allow cross-kernel access.

Suggested fix:
- Ensure the requested kernel belongs to the current user/session (JupyterHub APIs or server-side session mapping).
- At minimum: require a matching session id from the frontend and verify it server-side.

## Testing & CI recommendations

### CI currently skips live kernel tests

Where:
- `.github/workflows/ci.yml` runs only mocked/unit tests.

Given the tight coupling between:
- frontend ↔ backend endpoints
- backend ↔ kernel execution
- streaming SSE correctness

…you want live tests in CI, even if they're a minimal subset.

Suggested approach:
- Start a Jupyter server on an ephemeral port in CI (similar to `just test` phase 2) and run:
  - `tests/test_live_kernel.py`
  - `tests/test_tool_execute_handler.py`
  - `tests/test_tool_loop.py` (if it requires a server)
- Keep external LLM tests skipped unless secrets are configured.

### Parser tests are inconsistent across TS and Python

Where:
- TS uses `$\`var\`` and `&\`func\`` (`src/promptParser.ts`)
- Python parser tests (`tests/test_parser.py`) mostly validate `$var`/`&func` without backticks.

Suggested fix:
- Decide on a single syntax and enforce it in both test suites.
- If you want to support both syntaxes, implement it explicitly in the TS parser and document precedence/escaping.

### E2E tests disable windowing mode

Where:
- `playwright.config.ts` sets notebook `windowingMode: 'none'`

Given the P0.3 concerns, add at least one E2E run that uses default windowing to catch regressions in virtualization behavior.

## Product/UX considerations (strategic)

### Provide a clear "execution state" UX and abort affordance

Where:
- Backend supports streaming and can be aborted via fetch AbortController (`src/promptModel.ts:22`), but the UI doesn't obviously expose a Stop/Cancel control.

Suggested:
- A toolbar button on output cell ("Stop") while streaming.
- Show state (`executing/streaming/error`) in the UI (you already have signals).

### Make "what context was sent" inspectable

Users will ask: "Why did it ignore variable X?" or "Why did it hallucinate previous code?"

Suggested:
- Add a debug panel/command to show:
  - `preceding_code` (truncated)
  - variables/functions resolved
  - image count/spec count
  - final prompt (after substitutions)

## Open questions (worth aligning on)

1) Do you intend to support both `$var` and `$\`var\`` syntaxes, or only the backtick form?
2) Is this intended for single-user local notebooks only, or should we harden for multi-user JupyterHub?
3) Should tool execution support kwargs-only, or also positional args? (This impacts tool schema + validation.)
4) What is the intended max context size and max image/spec count? (This impacts cost/perf and UX.)

# AI Agent Instructions for ai-jup

## Overview

ai-jup is a JupyterLab extension that adds AI-powered prompt cells with `` $`variable` `` and `` &`function` `` syntax. It has:
- **TypeScript frontend** (`src/`) - JupyterLab extension code
- **Python backend** (`ai_jup/`) - Tornado handlers for Anthropic API + kernel execution

## Commands

### Installation
```bash
just install        # Install extension in development mode (editable + labextension develop)
just install-prod   # Install for production (no source link)
just uninstall      # Uninstall extension
```

### Build
```bash
just build          # Development build (TypeScript + extension)
just build-prod     # Production build
just check-types    # TypeScript type checking only
```

### Testing

**IMPORTANT**: Always run tests with a live Jupyter server. Do NOT skip live kernel tests.

```bash
# Run all tests (auto-starts test server on a free port):
just test

# Or for manual server control:
just server                 # Start on port 8888 for development
tb__jupyter-server start    # Start server via tool
tb__jupyter-debug check-all # Full debug check
```

The `just test` command:
1. Runs mock/unit tests in parallel (fast, no server needed)
2. Automatically starts a Jupyter server on a **dynamic free port** (avoids conflicts with port 8888)
3. Runs live kernel tests against that server
4. Cleans up the test server when done

**Test organization:**
1. **Phase 1 (parallel, fast)**: Mock/unit tests that don't need a kernel
   - `test_handlers.py` - Handler unit tests
   - `test_parser.py` - Prompt parser tests  
   - `test_api_integration.py` - API tests with mocked Anthropic client
   - `test_kernel_integration.py` - Kernel introspection tests

2. **Phase 2 (sequential, requires server)**: Live kernel tests
   - `test_live_kernel.py` - Real kernel execution
   - `test_tool_execute_handler.py` - Tool execution with live kernel
   - `test_solveit_flow.py` - End-to-end with real LLM (requires ANTHROPIC_API_KEY)
   - `test_tool_loop.py` - Tool loop integration

### Jupyter Tools Available

Use these tools for testing and debugging:
- `tb__jupyter-server` - Start/stop/status of Jupyter server
- `tb__jupyter-build` - Build the extension
- `tb__jupyter-debug` - Comprehensive debugging
- `tb__jupyter-extension-status` - Check extension installation
- `tb__jupyter-kernel-inspect` - Inspect kernel namespace
- `tb__jupyter-logs` - View server logs
- `tb__jupyter-api-test` - Test backend API endpoints

## Code Style

- TypeScript: Follow existing patterns in `src/`
- Python: Use `ruff` for formatting (`just fmt`)
- No comments unless code is complex
- Dispose resources properly (futures, signals, controllers)

## Key Patterns

### Resource Cleanup (TypeScript)
- Use `panel.disposed.connect()` for notebook cleanup
- Use `future.dispose()` after kernel execute requests
- Disconnect Signal connections on disposal
- Use AbortController for fetch requests tied to component lifecycle

### Error Handling (Python)
- Catch `StreamClosedError` when client disconnects during SSE
- Validate inputs before kernel execution
- Use `TOOL_NAME_RE` regex for tool name validation

## Testing Philosophy

1. **Mock tests first** - Fast, deterministic, catch validation bugs
2. **Live kernel tests second** - Catch real integration issues
3. **Never skip live tests** just because they need a server - use `tb__jupyter-server start`
4. **Don't over-mock** - Mocking can hide real bugs, especially in kernel/LLM interactions

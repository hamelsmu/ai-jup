---
title: What skills can you see
threadId: T-019b7169-b8cf-75d8-8cde-4a1d833729fa
created: 2025-12-30T22:38:32.656Z
agentMode: smart
---

# What skills can you see

## User

what skills can you see

## Assistant

I can see 4 available skills:

1. **frontend-design** - Create production-grade frontend interfaces with high design quality
2. **dev-browser** - Browser automation (navigate websites, fill forms, take screenshots, scrape data, test web apps)
3. **building-skills** - Create new Agent Skills with proper structure
4. **migrating-to-skills** - Migrate deprecated custom commands to Skills format

## User

what tools do you have

## Assistant

I have access to these tools:

**File & Code:**
- `Read`, `create_file`, `edit_file`, `undo_edit`, `glob`, `Grep`, `finder`

**Search & Web:**
- `web_search`, `read_web_page`, `librarian`, `look_at`

**Execution:**
- `Bash`, `Task` (sub-agents)

**Planning & Analysis:**
- `oracle`, `todo_read`, `todo_write`, `mermaid` (diagrams)

**Threads:**
- `find_thread`, `read_thread`

**Browser Automation (Playwright MCP):**
- `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_fill_form`, `browser_tabs`, and more

**Other:**
- `skill` (load specialized skills), `read_mcp_resource`

## User

I'm looking for a jupyter debugging tool do you have this?

## Assistant

No, I don't have a dedicated Jupyter debugging tool. However, I can:

1. **Read/analyze notebooks** using `Read` (they're JSON files)
2. **Run notebook cells** via `Bash` with `jupyter execute` or `nbconvert`
3. **Use browser automation** to interact with JupyterLab in a browser

I notice you're working in an `ai-jup` project - is this a Jupyter extension you're building? I could help you develop debugging features for it.

## User

!ls

## Assistant

**Tool Use:** `Bash`

```json
{
  "cmd": "ls"
}
```

## User

**Tool Result:** `toolu_vrtx_019XodZzcr3Jq6xF79Axk2es`

```
{
  "output": "ai_jup\ninstall.json\njupyter_ai_jup\njupyter-config\nlib\nLICENSE\nnode_modules\npackage.json\npyproject.toml\nREADME.md\nsrc\nstyle\ntest_notebook.ipynb\ntests\ntsconfig.json\ntsconfig.tsbuildinfo\nyarn.lock\n",
  "exitCode": 0
}
```

## Assistant

```
ai_jup/
install.json
jupyter_ai_jup/
jupyter-config/
lib/
LICENSE
node_modules/
package.json
pyproject.toml
README.md
src/
style/
test_notebook.ipynb
tests/
tsconfig.json
tsconfig.tsbuildinfo
yarn.lock
```

This looks like a JupyterLab extension with both Python (`ai_jup/`, `pyproject.toml`) and TypeScript (`src/`, `package.json`) components.

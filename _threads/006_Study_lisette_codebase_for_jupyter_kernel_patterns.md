---
title: Study lisette codebase for jupyter kernel patterns
threadId: T-019b717d-7202-7533-9afc-c5ff6405fce7
created: 2025-12-30T23:00:05.251Z
agentMode: smart
---

# Study lisette codebase for jupyter kernel patterns

## User

use the librarian to study the code in https://github.com/AnswerDotAI/lisette carefully and how that may inform the tool use &`function` functionality we propose to add via this jupyter kernel.  Determine if you learn any patterns that would be useful in incorporating into the jupyter extension.  

## Assistant

**Tool Use:** `librarian`

```json
{
  "query": "Analyze the lisette repository at https://github.com/AnswerDotAI/lisette. I want to understand:\n1. How it implements tool/function calling for LLMs\n2. How functions are registered, discovered, or defined\n3. How tool results are handled and passed back to the LLM\n4. Any patterns for introspecting Python functions to create tool schemas\n5. How it integrates with Jupyter or notebook environments if at all\n6. The overall architecture for tool execution",
  "context": "I'm building a Jupyter extension (ai-jup) that needs to add tool use and function calling capabilities. I want to learn patterns from lisette that could inform how we expose kernel variables/functions as tools to an LLM."
}
```

## User

**Tool Result:** `toolu_vrtx_016TfSKW6y8cFJLWKnXTZW6R`

```
Now I have a comprehensive understanding of lisette's tool calling architecture. Let me create a detailed analysis:

## Lisette Tool Calling Architecture Analysis

Lisette is an elegant wrapper around LiteLLM that automates tool/function calling for LLMs while maintaining full control. Here's a comprehensive breakdown of its patterns that could inform your ai-jup extension:

### 1. **Function Introspection & Schema Generation**

Lisette uses [`toolslm`](https://github.com/AnswerDotAI/toolslm) library for intelligent function schema generation:

```python
# From lisette/core.py - line 215-217
def lite_mk_func(f):
    if isinstance(f, dict): return f
    return {'type':'function', 'function':get_schema(f, pname='parameters')}
```

**Key Pattern**: Functions become tools through simple introspection via `get_schema()`. The system extracts:
- Function name
- Docstring (becomes description)
- Type hints on parameters (becomes parameter schema)
- Parameter comment annotations (become field descriptions)

**Example from their docs**:
```python
def add_numbers(
    a: int,  # First number to add
    b: int   # Second number to add  
) -> int:
    "Add two numbers together"
    return a + b
```

This automatically generates:
```json
{
  "type": "function",
  "function": {
    "name": "add_numbers",
    "description": "Add two numbers together\n\nReturns:\n- type: integer",
    "parameters": {
      "type": "object",
      "properties": {
        "a": {"type": "integer", "description": "First number to add"},
        "b": {"type": "integer", "description": "Second number to add", "default": 0}
      },
      "required": ["a"]
    }
  }
}
```

### 2. **Tool Registration & Namespace Management**

The [Chat](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L286-L308) class handles tool registration elegantly:

```python
class Chat:
    def __init__(
        self,
        model: str,
        sp='',                    # System prompt
        temp=0,
        search=False,
        tools: list=None,         # Pass functions directly
        hist: list=None,
        ns: Optional[dict]=None,  # Custom namespace for tool calling
        cache=False,
        cache_idxs: list=[-1],
        ttl=None,
        api_base=None,
        api_key=None,
    ):
        self.model = model
        hist, tools = mk_msgs(hist, cache, cache_idxs, ttl), listify(tools)
        
        # Auto-create namespace from tools if not provided
        if ns is None and tools: 
            ns = mk_ns(tools)  # From toolslm
        elif ns is None: 
            ns = globals()
        
        # Convert functions to LiteLLM tool schemas
        self.tool_schemas = [lite_mk_func(t) for t in tools] if tools else None
        store_attr()
```

**Key Pattern**: 
- Tools passed as plain functions or list of functions
- `mk_ns()` from toolslm automatically creates namespace (maps function names to callables)
- Each tool converted to OpenAI-compatible schema format
- Namespace stored for later execution

### 3. **Tool Execution & Result Handling**

The [_lite_call_func](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L225-L232) function handles execution:

```python
def _lite_call_func(tc, tool_schemas, ns, raise_on_err=True):
    # Extract function name from tool call
    fn, valid = tc.function.name, {nested_idx(o,'function','name') for o in tool_schemas or []}
    
    if fn not in valid: 
        res = f"Tool not defined in tool_schemas: {fn}"
    else:
        try: 
            # Parse arguments and call function from namespace
            res = call_func(fn, json.loads(tc.function.arguments), ns=ns)
        except json.JSONDecodeError: 
            res = f"Failed to parse function arguments: {tc.function.arguments}"
        else: 
            # Allow tools to return ToolResponse wrapper for rich content
            res = res.content if isinstance(res, ToolResponse) else str(res)
    
    return {"tool_call_id": tc.id, "role": "tool", "name": fn, "content": res}
```

**Key Pattern**:
- Validates tool calls against registered schemas
- Uses `call_func()` from toolslm for safe execution
- Supports `ToolResponse` dataclass for non-stringified results (e.g., for structured content)
- Returns standardized tool result dict compatible with LiteLLM

### 4. **Tool Loop Architecture** 

The [_call](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L327-L368) method implements automatic tool looping:

```python
@patch
def _call(self:Chat, msg=None, prefill=None, temp=None, think=None, search=None, 
          stream=False, max_steps=2, step=1, final_prompt=None, tool_choice=None, **kwargs):
    """Internal method that always yields responses"""
    
    if step > max_steps: 
        return  # Stop at max_steps
    
    # Get LLM response
    res = completion(
        model=self.model, 
        messages=self._prep_msg(msg, prefill), 
        stream=stream, 
        tools=self.tool_schemas,  # Pass tool schemas
        tool_choice=tool_choice,
        **kwargs
    )
    
    if stream:
        res = yield from stream_with_complete(res, postproc=cite_footnotes)
    
    m = contents(res)
    self.hist.append(m)  # Add assistant message to history
    yield res
    
    # If LLM called tools, execute them
    if tcs := _filter_srvtools(m.tool_calls):
        # Execute all tool calls
        tool_results = [_lite_call_func(tc, self.tool_schemas, self.ns) for tc in tcs]
        
        # Add results to history
        self.hist += tool_results
        for r in tool_results: 
            yield r
        
        # Check if approaching max steps
        if step >= max_steps - 1: 
            prompt, tool_choice, search = final_prompt, 'none', False
        else: 
            prompt = None
        
        # Recursive call for next step
        try: 
            yield from self._call(
                prompt, prefill, temp, think, search, stream, max_steps, 
                step+1, final_prompt, tool_choice, **kwargs
            )
        except ContextWindowExceededError:
            # Handle context overflow gracefully
            for t in tool_results:
                if len(t['content']) > 1000: 
                    t['content'] = _cwe_msg + _trunc_str(t['content'], mx=1000)
            yield from self._call(None, prefill, temp, think, search, stream, 
                                 max_steps, max_steps, final_prompt, 'none', **kwargs)
```

**Key Pattern**:
- Recursive generator-based architecture
- Maintains state in `self.hist` throughout tool loop
- Configurable `max_steps` to limit tool calls
- Automatic context window overflow handling
- Generator yields both responses and tool results for visibility

### 5. **Tool Response Wrapping**

The [ToolResponse](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L220-L222) dataclass allows rich responses:

```python
@dataclass
class ToolResponse:
    content: list[str, str]
```

**Pattern**: Tools can return `ToolResponse` to return structured content (like image blocks, multiple text blocks, etc.) without stringification.

### 6. **History Management**

The [mk_msgs](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L187-L202) function standardizes message formatting:

```python
def mk_msgs(
    msgs,                   # List of messages
    cache=False,            # Enable Anthropic caching
    cache_idxs=[-1],        # Cache breakpoint indices
    ttl=None,               # Cache TTL
):
    """Create a list of LiteLLM compatible messages."""
    if not msgs: return []
    if not isinstance(msgs, list): msgs = [msgs]
    
    res, role = [], 'user'
    msgs = L(msgs).map(lambda m: fmt2hist(m) if detls_tag in m else [m]).concat()
    
    for m in msgs:
        res.append(msg:=remove_cache_ckpts(mk_msg(m, role=role)))
        # Auto-toggle role: user->assistant->user based on message type
        role = 'assistant' if msg['role'] in ('user','function', 'tool') else 'user'
    
    if cache: 
        _apply_cache_idxs(res, cache_idxs, ttl)
    return res
```

**Key Pattern**: Automatic role alternation ensures valid message sequences.

### 7. **Async Support**

Lisette includes [AsyncChat](https://github.com/AnswerDotAI/lisette/blob/main/lisette/core.py#L441-L482) for concurrent operations:

```python
class AsyncChat(Chat):
    async def _call(self, msg=None, prefill=None, temp=None, think=None, 
                    search=None, stream=False, max_steps=2, step=1, 
                    final_prompt=None, tool_choice=None, **kwargs):
        # ... (similar to _call but with async/await)
        
        res = await acompletion(
            model=self.model, 
            messages=self._prep_msg(msg, prefill), 
            stream=stream,
            tools=self.tool_schemas, 
            **kwargs
        )
        
        if tcs := _filter_srvtools(m.tool_calls):
            tool_results = []
            for tc in tcs:
                result = await _alite_call_func(tc, self.tool_schemas, self.ns)
                tool_results.append(result)
                yield result
```

---

## Recommended Patterns for ai-jup

Based on lisette's architecture, here's what to consider for your Jupyter extension:

### 1. **Kernel Variable as Tools**
- Use introspection (similar to `toolslm`) to auto-detect functions in kernel namespace
- Expose dataframe operations, plot functions, etc. as tools
- Allow LLM to call them via standardized schema

### 2. **Execution Safety**
- Isolate tool execution in try/catch like `_lite_call_func`
- Validate tool names against registered schema before execution
- Return structured results with tool_call_id tracking

### 3. **History Integration**
- Maintain execution history alongside chat history
- Support reversible operations (undo/rollback)
- Track which tools modified what variables

### 4. **Streaming Results**
- Yield intermediate tool results as they execute
- Show progress in notebook UI
- Support long-running operations gracefully

### 5. **Rich Content Returns**
- Return plots, dataframes, etc. as structured content (like `ToolResponse`)
- Integrate with Jupyter's display system
- Don't force string conversion for visual outputs

### 6. **Context Management**
- Use `mk_ns()` pattern to maintain function registry
- Support custom namespaces for different execution contexts
- Allow dynamic tool registration/deregistration
```

## Assistant

This is excellent. Here are the key patterns from lisette that could inform ai-jup's tool/function functionality:

### Key Patterns to Adopt

#### 1. **Auto-Schema Generation from Type Hints**
Lisette uses `toolslm.get_schema()` to convert Python functions into OpenAI-compatible tool schemas automatically. Parameter comments become field descriptions:
```python
def add(a: int,  # First number
        b: int   # Second number
) -> int: ...
```

#### 2. **Namespace Management**
- `mk_ns(tools)` creates a name→callable mapping from a list of functions
- For ai-jup: introspect kernel namespace to discover callable functions and expose them as tools

#### 3. **Safe Execution Pattern**
```python
try: 
    res = call_func(fn, json.loads(tc.function.arguments), ns=ns)
except: 
    res = "error message"
return {"tool_call_id": tc.id, "role": "tool", "name": fn, "content": res}
```

#### 4. **ToolResponse Wrapper**
Return structured content (images, dataframes) without stringification—critical for Jupyter's rich display system

#### 5. **Tool Loop with Max Steps**
Recursive execution with `max_steps` limit prevents runaway tool calling

### Recommendations for ai-jup

| Lisette Pattern | ai-jup Application |
|-----------------|---------------------|
| `get_schema(f)` | Introspect kernel functions → auto-generate tool schemas |
| `mk_ns(tools)` | Build registry from kernel's `user_ns` |
| `ToolResponse` | Return IPython display objects (plots, HTML) as rich content |
| Tool loop | Let LLM iterate: call tool → see result → call another |
| History tracking | Store tool calls/results in cell metadata |

Want me to look at the current ai-jup code to see how we could integrate these patterns?

## User

Yes, but don't just integrate for the sake of it.  Just consider it and write your thoughts into improvements.md 

## Assistant

**Tool Use:** `finder`

```json
{
  "query": "Find how ai-jup currently handles tool execution, function calling, or LLM integration. Look for any existing tool schemas, function introspection, or kernel namespace access patterns."
}
```

**Tool Use:** `Read`

```json
{
  "path": "/Users/hamel/git/ai-jup"
}
```

## User

**Tool Result:** `toolu_vrtx_01MqYxhqfoi5ksdzwXVycrr7`

```
ai-jup handles LLM integration and tool execution through a combination of a Jupyter server extension (Python) and a frontend connector (TypeScript).

### Key Components:
- **LLM Integration**: Uses the **Anthropic SDK** via `PromptHandler` to stream responses. It builds a system prompt containing notebook context (preceding code, variables, and functions).
- **Tool Schema Generation**: `_build_tools` in the backend and `getFunction` in the frontend use Python's `inspect` module to introspect function signatures, docstrings, and type hints to create Anthropic tool definitions.
- **Kernel Introspection**: `KernelConnector` executes silent Python code to extract `globals()` from the kernel namespace, filtering out private members and built-ins.
- **Tool Execution**: `ToolExecuteHandler` receives tool calls from the LLM, constructs a Python function call string, and executes it in the active kernel via the Jupyter `kernel_manager`.

### Relevant Files:
- [ai_jup/handlers.py#L18-L141](file:///Users/hamel/git/ai-jup/ai_jup/handlers.py#L18-L141) - Anthropic streaming and tool schema building.
- [ai_jup/handlers.py#L144-L235](file:///Users/hamel/git/ai-jup/ai_jup/handlers.py#L144-L235) - Backend tool execution in the Jupyter kernel.
- [src/kernelConnector.ts#L135-L188](file:///Users/hamel/git/ai-jup/src/kernelConnector.ts#L135-L188) - Frontend function introspection logic.
- [src/kernelConnector.ts#L193-L272](file:///Users/hamel/git/ai-jup/src/kernelConnector.ts#L193-L272) - Namespace access patterns for variables and functions.
- [tests/test_kernel_integration.py#L42-L91](file:///Users/hamel/git/ai-jup/tests/test_kernel_integration.py#L42-L91) - Tests for function introspection and schema mapping.
```

**Tool Result:** `toolu_vrtx_01DC1kh4xjVGXknWSPyCqRxK`

```
{
  "absolutePath": "/Users/hamel/git/ai-jup",
  "content": ".amp/\n.git/\n.yarn/\nai_jup/\njupyter_ai_jup/\njupyter-config/\nlib/\nnode_modules/\nsrc/\nstyle/\ntests/\n.jupyter-server-8888.log\n.jupyter-server-8888.pid\n.yarnrc.yml\ninstall.json\nLICENSE\npackage.json\npyproject.toml\nREADME.md\ntest_notebook.ipynb\ntest-plan.md\ntsconfig.json\ntsconfig.tsbuildinfo\nyarn.lock",
  "isDirectory": true,
  "directoryEntries": [
    ".amp/",
    ".git/",
    ".yarn/",
    "ai_jup/",
    "jupyter_ai_jup/",
    "jupyter-config/",
    "lib/",
    "node_modules/",
    "src/",
    "style/",
    "tests/",
    ".jupyter-server-8888.log",
    ".jupyter-server-8888.pid",
    ".yarnrc.yml",
    "install.json",
    "LICENSE",
    "package.json",
    "pyproject.toml",
    "README.md",
    "test_notebook.ipynb",
    "test-plan.md",
    "tsconfig.json",
    "tsconfig.tsbuildinfo",
    "yarn.lock"
  ]
}
```

## Assistant

**Tool Use:** `Read`

```json
{
  "path": "/Users/hamel/git/ai-jup/ai_jup/handlers.py"
}
```

**Tool Use:** `Read`

```json
{
  "path": "/Users/hamel/git/ai-jup/src/kernelConnector.ts"
}
```

## User

**Tool Result:** `toolu_vrtx_01J5o5T34CDZHMB6Z7oYt1NC`

```
{
  "absolutePath": "/Users/hamel/git/ai-jup/ai_jup/handlers.py",
  "content": "1: \"\"\"Server handlers for AI prompt processing.\"\"\"\n2: import json\n3: import os\n4: from typing import Any\n5: \n6: from jupyter_server.base.handlers import APIHandler\n7: from jupyter_server.utils import url_path_join\n8: import tornado\n9: from tornado.web import authenticated\n10: \n11: try:\n12:     import anthropic\n13:     HAS_ANTHROPIC = True\n14: except ImportError:\n15:     HAS_ANTHROPIC = False\n16: \n17: \n18: class PromptHandler(APIHandler):\n19:     \"\"\"Handler for AI prompt requests with streaming support.\"\"\"\n20: \n21:     @authenticated\n22:     async def post(self):\n23:         \"\"\"Process a prompt and stream the response.\"\"\"\n24:         try:\n25:             data = self.get_json_body()\n26:             prompt = data.get(\"prompt\", \"\")\n27:             context = data.get(\"context\", {})\n28:             variables = context.get(\"variables\", {})\n29:             functions = context.get(\"functions\", {})\n30:             preceding_code = context.get(\"preceding_code\", \"\")\n31:             model = data.get(\"model\", \"claude-sonnet-4-20250514\")\n32: \n33:             system_prompt = self._build_system_prompt(preceding_code, variables, functions)\n34:             \n35:             self.set_header(\"Content-Type\", \"text/event-stream\")\n36:             self.set_header(\"Cache-Control\", \"no-cache\")\n37:             self.set_header(\"Connection\", \"keep-alive\")\n38: \n39:             if not HAS_ANTHROPIC:\n40:                 self.set_status(500)\n41:                 self.finish({\"error\": \"anthropic package not installed\"})\n42:                 return\n43: \n44:             api_key = os.environ.get(\"ANTHROPIC_API_KEY\")\n45:             if not api_key:\n46:                 self.set_status(500)\n47:                 self.finish({\"error\": \"ANTHROPIC_API_KEY environment variable not set\"})\n48:                 return\n49: \n50:             client = anthropic.Anthropic(api_key=api_key)\n51:             \n52:             tools = self._build_tools(functions)\n53:             \n54:             messages = [{\"role\": \"user\", \"content\": prompt}]\n55:             \n56:             with client.messages.stream(\n57:                 model=model,\n58:                 max_tokens=4096,\n59:                 system=system_prompt,\n60:                 messages=messages,\n61:                 tools=tools if tools else anthropic.NOT_GIVEN,\n62:             ) as stream:\n63:                 for event in stream:\n64:                     if hasattr(event, 'type'):\n65:                         if event.type == 'content_block_delta':\n66:                             # Handle both text and tool input deltas\n67:                             if hasattr(event.delta, 'text'):\n68:                                 await self._write_sse({\"text\": event.delta.text})\n69:                             if hasattr(event.delta, 'partial_json'):\n70:                                 await self._write_sse({\"tool_input\": event.delta.partial_json})\n71:                         elif event.type == 'message_stop':\n72:                             await self._write_sse({\"done\": True})\n73:                         elif event.type == 'content_block_start':\n74:                             if hasattr(event.content_block, 'type'):\n75:                                 if event.content_block.type == 'tool_use':\n76:                                     await self._write_sse({\n77:                                         \"tool_call\": {\n78:                                             \"name\": event.content_block.name,\n79:                                             \"id\": event.content_block.id\n80:                                         }\n81:                                     })\n82: \n83:             self.finish()\n84: \n85:         except Exception as e:\n86:             self.log.error(f\"Error processing prompt: {e}\")\n87:             try:\n88:                 await self._write_sse({\"error\": str(e)})\n89:             except Exception:\n90:                 pass\n91:             self.finish()\n92: \n93:     async def _write_sse(self, data: dict):\n94:         \"\"\"Write a server-sent event.\"\"\"\n95:         self.write(f\"data: {json.dumps(data)}\\n\\n\")\n96:         await self.flush()\n97: \n98:     def _build_system_prompt(self, preceding_code: str, variables: dict, functions: dict) -> str:\n99:         \"\"\"Build the system prompt with context.\"\"\"\n100:         parts = [\n101:             \"You are an AI assistant embedded in a Jupyter notebook.\",\n102:             \"Help the user with their data science and programming tasks.\",\n103:             \"When generating code, write Python that can be executed in the notebook.\",\n104:             \"Be concise and practical.\",\n105:         ]\n106:         \n107:         if preceding_code:\n108:             parts.append(f\"\\n## Preceding Code Context\\n```python\\n{preceding_code}\\n```\")\n109:         \n110:         if variables:\n111:             var_desc = \"\\n## Available Variables\\n\"\n112:             for name, info in variables.items():\n113:                 var_desc += f\"- `{name}`: {info.get('type', 'unknown')} = {info.get('repr', 'N/A')}\\n\"\n114:             parts.append(var_desc)\n115:         \n116:         if functions:\n117:             func_desc = \"\\n## Available Functions (you can call these as tools)\\n\"\n118:             for name, info in functions.items():\n119:                 sig = info.get('signature', '()')\n120:                 doc = info.get('docstring', 'No documentation')\n121:                 func_desc += f\"- `{name}{sig}`: {doc}\\n\"\n122:             parts.append(func_desc)\n123:         \n124:         return \"\\n\".join(parts)\n125: \n126:     def _build_tools(self, functions: dict) -> list:\n127:         \"\"\"Build Anthropic tool definitions from function info.\"\"\"\n128:         tools = []\n129:         for name, info in functions.items():\n130:             params = info.get('parameters', {})\n131:             tool = {\n132:                 \"name\": name,\n133:                 \"description\": info.get('docstring', f\"Call the {name} function\"),\n134:                 \"input_schema\": {\n135:                     \"type\": \"object\",\n136:                     \"properties\": params,\n137:                     \"required\": list(params.keys())\n138:                 }\n139:             }\n140:             tools.append(tool)\n141:         return tools\n142: \n143: \n144: class ToolExecuteHandler(APIHandler):\n145:     \"\"\"Handler for executing tool calls in the kernel.\"\"\"\n146: \n147:     @authenticated\n148:     async def post(self):\n149:         \"\"\"Execute a tool call and return the result.\"\"\"\n150:         data = self.get_json_body()\n151:         tool_name = data.get(\"name\")\n152:         tool_input = data.get(\"input\", {})\n153:         kernel_id = data.get(\"kernel_id\")\n154:         \n155:         if not kernel_id:\n156:             self.finish(json.dumps({\n157:                 \"error\": \"kernel_id is required\",\n158:                 \"status\": \"error\"\n159:             }))\n160:             return\n161:         \n162:         # Get kernel manager from settings\n163:         kernel_manager = self.settings.get(\"kernel_manager\")\n164:         if not kernel_manager:\n165:             self.finish(json.dumps({\n166:                 \"error\": \"Kernel manager not available\",\n167:                 \"status\": \"error\"\n168:             }))\n169:             return\n170:         \n171:         try:\n172:             # Get the kernel\n173:             kernel = kernel_manager.get_kernel(kernel_id)\n174:             if not kernel:\n175:                 self.finish(json.dumps({\n176:                     \"error\": f\"Kernel {kernel_id} not found\",\n177:                     \"status\": \"error\"\n178:                 }))\n179:                 return\n180:             \n181:             # Build the function call code\n182:             args_str = \", \".join(\n183:                 f\"{k}={json.dumps(v)}\" for k, v in tool_input.items()\n184:             )\n185:             \n186:             code = f\"\"\"\n187: import json as _json_mod\n188: try:\n189:     _result = {tool_name}({args_str})\n190:     _repr = repr(_result)[:500]\n191:     print(_json_mod.dumps({{\"result\": _repr, \"status\": \"success\"}}))\n192: except Exception as _e:\n193:     print(_json_mod.dumps({{\"error\": str(_e), \"status\": \"error\"}}))\n194: \"\"\"\n195:             \n196:             # Execute code and capture output\n197:             output = []\n198:             \n199:             def output_hook(msg):\n200:                 msg_type = msg.get(\"msg_type\", \"\")\n201:                 content = msg.get(\"content\", {})\n202:                 if msg_type == \"stream\" and content.get(\"name\") == \"stdout\":\n203:                     output.append(content.get(\"text\", \"\"))\n204:                 elif msg_type == \"execute_result\":\n205:                     data = content.get(\"data\", {})\n206:                     if \"text/plain\" in data:\n207:                         output.append(data[\"text/plain\"])\n208:             \n209:             # Execute in kernel\n210:             await kernel.execute(code, output_hook=output_hook)\n211:             \n212:             # Parse the output\n213:             result_text = \"\".join(output).strip()\n214:             if result_text:\n215:                 try:\n216:                     result = json.loads(result_text)\n217:                     self.finish(json.dumps(result))\n218:                 except json.JSONDecodeError:\n219:                     self.finish(json.dumps({\n220:                         \"result\": result_text,\n221:                         \"status\": \"success\"\n222:                     }))\n223:             else:\n224:                 self.finish(json.dumps({\n225:                     \"result\": \"No output\",\n226:                     \"status\": \"success\"\n227:                 }))\n228:                 \n229:         except Exception as e:\n230:             self.log.error(f\"Error executing tool {tool_name}: {e}\")\n231:             self.finish(json.dumps({\n232:                 \"error\": str(e),\n233:                 \"status\": \"error\"\n234:             }))\n235: \n236: \n237: class ModelsHandler(APIHandler):\n238:     \"\"\"Handler for listing available models.\"\"\"\n239: \n240:     @authenticated\n241:     def get(self):\n242:         models = [\n243:             {\"id\": \"claude-sonnet-4-20250514\", \"name\": \"Claude Sonnet 4\"},\n244:             {\"id\": \"claude-3-5-sonnet-20241022\", \"name\": \"Claude 3.5 Sonnet\"},\n245:             {\"id\": \"claude-3-haiku-20240307\", \"name\": \"Claude 3 Haiku\"},\n246:         ]\n247:         self.finish(json.dumps({\"models\": models}))\n248: \n249: \n250: def setup_handlers(web_app):\n251:     \"\"\"Setup API handlers.\"\"\"\n252:     host_pattern = \".*$\"\n253:     base_url = web_app.settings[\"base_url\"]\n254:     \n255:     handlers = [\n256:         (url_path_join(base_url, \"ai-jup\", \"prompt\"), PromptHandler),\n257:         (url_path_join(base_url, \"ai-jup\", \"tool-execute\"), ToolExecuteHandler),\n258:         (url_path_join(base_url, \"ai-jup\", \"models\"), ModelsHandler),\n259:     ]\n260:     web_app.add_handlers(host_pattern, handlers)"
}
```

**Tool Result:** `toolu_vrtx_01UrbPWW4h8w21szjwxTenBu`

```
{
  "absolutePath": "/Users/hamel/git/ai-jup/src/kernelConnector.ts",
  "content": "1: /**\n2:  * Kernel connector for variable and function introspection.\n3:  */\n4: \n5: import { ISessionContext } from '@jupyterlab/apputils';\n6: import { KernelMessage } from '@jupyterlab/services';\n7: \n8: export interface VariableInfo {\n9:   name: string;\n10:   type: string;\n11:   repr: string;\n12:   value?: unknown;\n13: }\n14: \n15: export interface FunctionInfo {\n16:   name: string;\n17:   signature: string;\n18:   docstring: string;\n19:   parameters: Record<string, ParameterInfo>;\n20: }\n21: \n22: export interface ParameterInfo {\n23:   type: string;\n24:   description: string;\n25:   default?: string;\n26: }\n27: \n28: /**\n29:  * Connects to a Jupyter kernel to introspect variables and functions.\n30:  */\n31: export class KernelConnector {\n32:   private _session: ISessionContext;\n33: \n34:   constructor(session: ISessionContext) {\n35:     this._session = session;\n36:   }\n37: \n38:   /**\n39:    * Check if the kernel is available.\n40:    */\n41:   get kernelAvailable(): boolean {\n42:     return !!this._session.session?.kernel;\n43:   }\n44: \n45:   /**\n46:    * Execute code silently and capture output.\n47:    */\n48:   async execute(\n49:     code: string,\n50:     onOutput?: (msg: KernelMessage.IIOPubMessage) => void\n51:   ): Promise<KernelMessage.IExecuteReplyMsg | null> {\n52:     const kernel = this._session.session?.kernel;\n53:     if (!kernel) {\n54:       return null;\n55:     }\n56: \n57:     const content: KernelMessage.IExecuteRequestMsg['content'] = {\n58:       code,\n59:       stop_on_error: false,\n60:       store_history: false,\n61:       silent: true\n62:     };\n63: \n64:     const future = kernel.requestExecute(content);\n65: \n66:     if (onOutput) {\n67:       future.onIOPub = onOutput;\n68:     }\n69: \n70:     return (await future.done) as KernelMessage.IExecuteReplyMsg;\n71:   }\n72: \n73:   /**\n74:    * Execute code and return stdout output.\n75:    */\n76:   async executeAndCapture(code: string): Promise<string> {\n77:     let output = '';\n78: \n79:     await this.execute(code, (msg: KernelMessage.IIOPubMessage) => {\n80:       const msgType = msg.header.msg_type;\n81:       const content = msg.content as Record<string, unknown>;\n82: \n83:       if (msgType === 'stream' && content.name === 'stdout') {\n84:         output += content.text as string;\n85:       } else if (msgType === 'execute_result') {\n86:         const data = content.data as Record<string, string>;\n87:         if (data && data['text/plain']) {\n88:           output += data['text/plain'];\n89:         }\n90:       }\n91:     });\n92: \n93:     return output.trim();\n94:   }\n95: \n96:   /**\n97:    * Get the value of a variable by name.\n98:    */\n99:   async getVariable(name: string): Promise<VariableInfo | null> {\n100:     const code = `\n101: import json as _json_mod\n102: try:\n103:     _var = ${name}\n104:     _result = {\n105:         \"name\": \"${name}\",\n106:         \"type\": type(_var).__name__,\n107:         \"repr\": repr(_var)[:500]\n108:     }\n109:     print(_json_mod.dumps(_result))\n110:     del _var, _result\n111: except Exception as _e:\n112:     print(_json_mod.dumps({\"error\": str(_e)}))\n113: `;\n114: \n115:     try {\n116:       const output = await this.executeAndCapture(code);\n117:       if (!output) {\n118:         return null;\n119:       }\n120:       const result = JSON.parse(output);\n121:       if (result.error) {\n122:         console.warn(`Error getting variable ${name}:`, result.error);\n123:         return null;\n124:       }\n125:       return result as VariableInfo;\n126:     } catch (e) {\n127:       console.error(`Failed to get variable ${name}:`, e);\n128:       return null;\n129:     }\n130:   }\n131: \n132:   /**\n133:    * Get information about a function.\n134:    */\n135:   async getFunction(name: string): Promise<FunctionInfo | null> {\n136:     const code = `\n137: import json as _json_mod\n138: import inspect as _inspect_mod\n139: try:\n140:     _func = ${name}\n141:     if not callable(_func):\n142:         print(_json_mod.dumps({\"error\": \"Not callable\"}))\n143:     else:\n144:         _sig = str(_inspect_mod.signature(_func))\n145:         _doc = _inspect_mod.getdoc(_func) or \"No documentation\"\n146:         _params = {}\n147:         try:\n148:             for _pname, _param in _inspect_mod.signature(_func).parameters.items():\n149:                 _pinfo = {\"type\": \"string\", \"description\": _pname}\n150:                 if _param.annotation != _inspect_mod.Parameter.empty:\n151:                     _ann = _param.annotation\n152:                     if hasattr(_ann, '__name__'):\n153:                         _pinfo[\"type\"] = _ann.__name__\n154:                     elif hasattr(_ann, '__origin__'):\n155:                         _pinfo[\"type\"] = str(_ann)\n156:                 if _param.default != _inspect_mod.Parameter.empty:\n157:                     _pinfo[\"default\"] = repr(_param.default)\n158:                 _params[_pname] = _pinfo\n159:         except Exception:\n160:             pass\n161:         _result = {\n162:             \"name\": \"${name}\",\n163:             \"signature\": _sig,\n164:             \"docstring\": _doc[:500],\n165:             \"parameters\": _params\n166:         }\n167:         print(_json_mod.dumps(_result))\n168:         del _func, _sig, _doc, _params, _result\n169: except Exception as _e:\n170:     print(_json_mod.dumps({\"error\": str(_e)}))\n171: `;\n172: \n173:     try {\n174:       const output = await this.executeAndCapture(code);\n175:       if (!output) {\n176:         return null;\n177:       }\n178:       const result = JSON.parse(output);\n179:       if (result.error) {\n180:         console.warn(`Error getting function ${name}:`, result.error);\n181:         return null;\n182:       }\n183:       return result as FunctionInfo;\n184:     } catch (e) {\n185:       console.error(`Failed to get function ${name}:`, e);\n186:       return null;\n187:     }\n188:   }\n189: \n190:   /**\n191:    * Get all available variables in the kernel namespace.\n192:    */\n193:   async getAllVariables(): Promise<VariableInfo[]> {\n194:     const code = `\n195: import json as _json_mod\n196: try:\n197:     _skip = {'In', 'Out', 'get_ipython', 'exit', 'quit', '_', '__', '___'}\n198:     _skip.update(k for k in dir(__builtins__) if not k.startswith('_'))\n199:     _vars = []\n200:     for _name, _val in list(globals().items()):\n201:         if _name.startswith('_') or _name in _skip:\n202:             continue\n203:         if callable(_val) and not isinstance(_val, type):\n204:             continue\n205:         try:\n206:             _vars.append({\n207:                 \"name\": _name,\n208:                 \"type\": type(_val).__name__,\n209:                 \"repr\": repr(_val)[:200]\n210:             })\n211:         except Exception:\n212:             pass\n213:     print(_json_mod.dumps(_vars))\n214:     del _skip, _vars, _name, _val\n215: except Exception as _e:\n216:     print(_json_mod.dumps({\"error\": str(_e)}))\n217: `;\n218: \n219:     try {\n220:       const output = await this.executeAndCapture(code);\n221:       if (!output) {\n222:         return [];\n223:       }\n224:       const result = JSON.parse(output);\n225:       if (result.error) {\n226:         console.warn('Error getting variables:', result.error);\n227:         return [];\n228:       }\n229:       return result as VariableInfo[];\n230:     } catch (e) {\n231:       console.error('Failed to get variables:', e);\n232:       return [];\n233:     }\n234:   }\n235: \n236:   /**\n237:    * Get all callable functions in the kernel namespace.\n238:    */\n239:   async getAllFunctions(): Promise<string[]> {\n240:     const code = `\n241: import json as _json_mod\n242: try:\n243:     _skip = {'get_ipython', 'exit', 'quit'}\n244:     _skip.update(k for k in dir(__builtins__) if not k.startswith('_'))\n245:     _funcs = []\n246:     for _name, _val in list(globals().items()):\n247:         if _name.startswith('_') or _name in _skip:\n248:             continue\n249:         if callable(_val) and not isinstance(_val, type):\n250:             _funcs.append(_name)\n251:     print(_json_mod.dumps(_funcs))\n252:     del _skip, _funcs, _name, _val\n253: except Exception as _e:\n254:     print(_json_mod.dumps({\"error\": str(_e)}))\n255: `;\n256: \n257:     try {\n258:       const output = await this.executeAndCapture(code);\n259:       if (!output) {\n260:         return [];\n261:       }\n262:       const result = JSON.parse(output);\n263:       if (result.error) {\n264:         console.warn('Error getting functions:', result.error);\n265:         return [];\n266:       }\n267:       return result as string[];\n268:     } catch (e) {\n269:       console.error('Failed to get functions:', e);\n270:       return [];\n271:     }\n272:   }\n273: \n274:   /**\n275:    * Execute a function in the kernel and return the result.\n276:    * Result is truncated to 500 chars to keep context manageable.\n277:    */\n278:   async callFunction(name: string, args: Record<string, unknown>): Promise<string> {\n279:     const argsStr = Object.entries(args)\n280:       .map(([k, v]) => `${k}=${JSON.stringify(v)}`)\n281:       .join(', ');\n282: \n283:     const code = `\n284: import json as _json_mod\n285: try:\n286:     _result = ${name}(${argsStr})\n287:     _repr = repr(_result)[:500]\n288:     print(_json_mod.dumps({\"result\": _repr}))\n289: except Exception as _e:\n290:     print(_json_mod.dumps({\"error\": str(_e)}))\n291: `;\n292: \n293:     try {\n294:       const output = await this.executeAndCapture(code);\n295:       if (!output) {\n296:         return 'No output';\n297:       }\n298:       const result = JSON.parse(output);\n299:       if (result.error) {\n300:         return `Error: ${result.error}`;\n301:       }\n302:       return result.result;\n303:     } catch (e) {\n304:       return `Failed to call function: ${e}`;\n305:     }\n306:   }\n307: }"
}
```

## Assistant

Now I have a good understanding of both codebases. Let me write thoughtful considerations into improvements.md.

**Tool Use:** `create_file`

```json
{
  "path": "/Users/hamel/git/ai-jup/improvements.md",
  "content": "# Tool/Function Improvements: Lessons from Lisette\n\nAfter studying [lisette](https://github.com/AnswerDotAI/lisette), here are considerations for improving ai-jup's tool use functionality.\n\n## Current State of ai-jup\n\nai-jup already has solid foundations:\n- Function introspection via `inspect` module in `kernelConnector.ts`\n- Schema generation from type hints in `_build_tools()`\n- Tool execution via `ToolExecuteHandler` with kernel execution\n- SSE streaming for LLM responses\n\n## What Lisette Does Differently\n\n### 1. Parameter Descriptions from Comments\n\nLisette (via `toolslm`) extracts parameter descriptions from inline comments:\n\n```python\ndef add(\n    a: int,  # First number to add\n    b: int   # Second number to add\n) -> int: ...\n```\n\n**Current ai-jup behavior**: Uses parameter name as description (`\"description\": _pname`).\n\n**Consideration**: This is a nice ergonomic, but may not be worth the parsing complexity. Most well-documented functions have docstrings with parameter descriptions (numpy-style, Google-style). Consider parsing docstrings instead of comments—more robust and already standard practice.\n\n**Verdict**: Low priority. Docstring parsing is more valuable than comment parsing.\n\n### 2. Namespace Registry Pattern\n\nLisette's `mk_ns(tools)` creates a clean name→callable mapping upfront, validated against the schema.\n\n**Current ai-jup behavior**: Executes tool calls directly against `globals()` with string interpolation:\n```python\ncode = f\"_result = {tool_name}({args_str})\"\n```\n\n**Consideration**: The current approach is simpler and works, but has risks:\n- No validation that `tool_name` exists in registered functions\n- Potential for injection if `tool_name` isn't sanitized (though it comes from LLM)\n\n**Verdict**: Add validation in `ToolExecuteHandler` that `tool_name` is in the registered functions list before execution. Don't need a separate namespace—just check the list.\n\n### 3. ToolResponse Wrapper for Rich Content\n\nLisette's `ToolResponse` dataclass allows tools to return structured content without stringification.\n\n**Current ai-jup behavior**: All results truncated to 500 chars via `repr(_result)[:500]`.\n\n**This is the most impactful gap.** In Jupyter, functions often return:\n- DataFrames (should show as HTML tables)\n- Matplotlib figures (should show as images)\n- Rich objects with `_repr_html_()` methods\n\n**Consideration**: Instead of always using `repr()`, check for IPython display methods:\n```python\nif hasattr(_result, '_repr_html_'):\n    return {\"type\": \"html\", \"content\": _result._repr_html_()}\nelif hasattr(_result, '_repr_png_'):\n    return {\"type\": \"image\", \"content\": base64.b64encode(_result._repr_png_())}\nelse:\n    return {\"type\": \"text\", \"content\": repr(_result)[:500]}\n```\n\n**Verdict**: High priority. This would make tool results much more useful for data science workflows.\n\n### 4. Tool Loop with Max Steps\n\nLisette implements automatic tool looping—the LLM can call multiple tools in sequence until done, with a `max_steps` limit.\n\n**Current ai-jup behavior**: Single request-response. Frontend would need to handle tool loops.\n\n**Consideration**: The current architecture sends one prompt and streams one response. For tool loops, we'd need:\n1. LLM returns tool call\n2. Execute tool, get result\n3. Send result back to LLM\n4. LLM responds (possibly with another tool call)\n5. Repeat until `max_steps` or no tool call\n\n**Verdict**: Medium priority. Worth implementing, but the current single-shot approach works for simple cases. Could add `max_steps` parameter to `/ai-jup/prompt` and implement server-side looping.\n\n### 5. Async Tool Execution\n\nLisette's `AsyncChat` supports concurrent tool execution.\n\n**Current ai-jup behavior**: Sequential execution in kernel.\n\n**Consideration**: Jupyter kernels are single-threaded—you can't truly parallelize execution within one kernel. Multiple tool calls must be sequential regardless.\n\n**Verdict**: Not applicable. Jupyter kernel architecture doesn't support this.\n\n### 6. Context Window Overflow Handling\n\nLisette gracefully handles context overflow by truncating tool results and retrying.\n\n**Current ai-jup behavior**: No overflow handling.\n\n**Consideration**: For large DataFrames or long outputs, we could hit context limits. The current 500-char truncation helps, but if many tools are called, it could accumulate.\n\n**Verdict**: Low priority for now. The aggressive truncation mitigates this. Revisit if tool loops are implemented.\n\n## Recommended Changes (Priority Order)\n\n### High Priority\n\n1. **Rich result handling**: Return structured content for DataFrames, plots, etc. instead of `repr()`.\n\n2. **Tool name validation**: Check `tool_name` against registered functions before execution.\n\n### Medium Priority\n\n3. **Tool loop support**: Add server-side tool loop with `max_steps` parameter.\n\n4. **Better docstring parsing**: Extract parameter descriptions from numpy/Google-style docstrings.\n\n### Low Priority / Not Needed\n\n5. **Inline comment parsing**: Nice but not standard Python practice.\n6. **Async parallel tools**: Not applicable to Jupyter's architecture.\n7. **Separate namespace registry**: Current direct execution is fine with validation added.\n\n## Implementation Notes\n\n### Rich Result Handling\n\nThe execution code in `ToolExecuteHandler` could become:\n\n```python\ncode = f\"\"\"\nimport json as _json_mod\nimport base64 as _b64\ntry:\n    _result = {tool_name}({args_str})\n    \n    # Check for rich display methods\n    if hasattr(_result, '_repr_html_'):\n        _content = {{\"type\": \"html\", \"content\": _result._repr_html_()[:10000]}}\n    elif hasattr(_result, 'savefig'):  # matplotlib figure\n        import io as _io\n        _buf = _io.BytesIO()\n        _result.savefig(_buf, format='png')\n        _content = {{\"type\": \"image\", \"content\": _b64.b64encode(_buf.getvalue()).decode()}}\n    else:\n        _content = {{\"type\": \"text\", \"content\": repr(_result)[:500]}}\n    \n    print(_json_mod.dumps({{\"result\": _content, \"status\": \"success\"}}))\nexcept Exception as _e:\n    print(_json_mod.dumps({{\"error\": str(_e), \"status\": \"error\"}}))\n\"\"\"\n```\n\nThe frontend would then need to render HTML/images appropriately.\n\n### Tool Loop Architecture\n\nFor server-side tool loops, the flow would be:\n\n```\nFrontend: POST /ai-jup/prompt {prompt, context, max_steps: 5}\n    ↓\nServer: LLM call → streams text/tool_call events\n    ↓\nIf tool_call and steps < max_steps:\n    Execute tool in kernel\n    Stream tool_result event\n    Append to messages, call LLM again\n    ↓\nRepeat until no tool_call or max_steps reached\n```\n\nThis keeps the frontend simple—it just consumes the SSE stream.\n"
}
```

## User

**Tool Result:** `toolu_vrtx_01NXdVjMMYJKgpt6AdvqFvwT`

```
Successfully created file /Users/hamel/git/ai-jup/improvements.md
```

## Assistant

Created [improvements.md](/Users/hamel/git/ai-jup/improvements.md) with my analysis.

**Key takeaways:**
- **High priority**: Rich result handling (DataFrames/plots as HTML/images) and tool name validation
- **Medium priority**: Server-side tool loops with `max_steps`
- **Not applicable**: Async parallel tools (Jupyter kernels are single-threaded)
- **Overkill**: Separate namespace registry—current approach with validation is fine

The biggest gap is that ai-jup stringifies all tool results via `repr()[:500]`, losing rich Jupyter displays. Lisette's `ToolResponse` pattern suggests we should preserve structured content types.

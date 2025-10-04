# Asynkron.LiveView -  CLI AI Companion

![Live View](live.png)

A live view system for markdown files that automatically detects changes and streams a focused, per-file markdown view alongside a live directory browser.

---

## Why This Matters

When working with CLI-based AI agents such as **Codex CLI** or **CoPilot CLI**, you often get streams of progress, design discussions, reasoning, and plans logged as markdown into a folder (for example `/logs`).  

**Asynkron.LiveView** connects to that folder and instantly visualizes the evolving state of the agent’s thoughts. This gives you a **real-time debugging and mental model helper**:  

- See the agent’s reasoning unfold as structured markdown  
- Follow design decisions as they develop  
- Inspect progress logs in chronological order  
- Visualize system diagrams and flows directly with **Mermaid.js**  
- Keep context without digging through scattered files  

Instead of reading static logs or scrolling endlessly in a terminal, you get a **clear, dynamic, and live view** of what your AI agent is doing.

## How to

- Open a browser to: `http://localhost:8080/?path={path-to-your-markdown-logs}`.
- Example: `http://localhost:8080/?path=~/git/asynkron/Asynkron.DurableFunctions/Logs`

### Inside your own project repository

Create a folder for your markdown logs, e.g. `/logs`.<br/>
You can decide if you want to keep the logs as part of your git history, a form of architectural records.<br/>
Or simply .gitignore the contents.<br/>

Update your `agents.md` (or similar file depending on agent) to something similar to this:

```
## CLI
- when working using in the CLI, I want you to place markdown files into a /logs directory. we have a special viewer that display any new content there. we can show mermaid diagrams, code diffs, code snippets, architectural plans etc.

Example log file: `log{unixtimestamp}.md` - always use the current unix timestamp to ensure unique filenames.

 Boring activities:
 ### 2025-09-27 17:20 CEST — MultiHost Soak Test Initiated
 * ✅ Goal: repeat Category=MultiHost suite for 5 consecutive passes.
 * ✅ Loop cadence: sequential runs, capturing per-iteration duration & status.
 * ✅ Environment: local Testcontainers PostgreSQL (auto-provisioned per run).
 * ⚠️ Something broke a bit.
 * ❌ Something terrible happened
 
 Infographics / Examples
 // Mermaid diagrams - use often, class, sequence and flow charts. make sure to escpae { ( node and other reserved chars in mermaid syntax
 // Relevant Code blocks
 // Test result table + summary
 // Log snippets.
 
 Success stories, we completed some larger work
 ### 2025-09-27 17:20 CEST — VICTORY!
 * ⭐️ We did it! All tests passed!
 * ⭐️ Everything is awesome!
 * 🎉 5/5 passes of Category=MultiHost suite.

---

### Always add log files when:

1. building the project
- report build success or failure
- include any relevant build errors
2. running tests
   - report test success or failure
   - include test summary and any relevant test failures 
3. making any code changes
   - include code diffs or snippets of the changes made, whichever makes most sense
4. completing any significant task
   - include a summary of what was accomplished
   - highlight any important details or next steps 
5. every 15 minutes if nothing else has happened
   - provide a brief status update
   - mention any ongoing tasks or upcoming milestones
6. whenever you make a plan or change a plan
   - outline the new plan or changes made
   - explain the reasoning behind the changes
   - confirm with user that the plan aligns with their goals
7. whenever you think the user would benefit from an update
   - use your judgment to determine when an update is warranted
- consider the user's perspective and what information would be most helpful
```

---

## Features

- 📄 **Single-file Focus**: Render one markdown file at a time while keeping the familiar per-file controls for downloading, raw view, and deletion.
- 📁 **Directory Browser**: A live sidebar lists every markdown file under the chosen root. Click a file to switch the main view instantly.
- 🔄 **Real-time Updates**: The browser stays connected over WebSocket to reflect new files, deletions, or edits without a manual refresh.
- 🧭 **Deep Linking**: Use query parameters like `?path=~/logs&file=session.md` to open a specific directory and file directly.
- 🎨 **Rich Rendering**: Markdown is rendered with syntax highlighting and Mermaid diagram support out of the box.

---

## Installation & Quick Start

### 📦 **pip install** (Easiest)

Install directly from source using pip:

```bash
pip install git+https://github.com/asynkron/Asynkron.LiveView.git
```

Then run the viewer:

```bash
liveview --path /path/to/markdown --port 8080
```

Or simply:

```bash
liveview
```

This will start the server at `http://localhost:8080` watching the `markdown` directory by default.

### ⚡ One-Command Setup with run.sh

```bash
./run.sh
```

That's it! The script will automatically:
- ✅ Detect your Python installation
- ✅ Set up a virtual environment 
- ✅ Install all dependencies
- ✅ Create the markdown directory
- ✅ Start the server at `http://localhost:8080`

### 🔧 **Manual Setup**

If you prefer manual setup or development:

1. **Install Python Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Build the Frontend Bundle** (only required after pulling new changes or editing the UI):
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   The compiled assets are written to `templates/static/dist` and automatically served by the
   Python application.

3. **Run the Server**:
   ```bash
   python start.py
   ```

## ✅ Health Checks

Before shipping changes or packaging a release, you can run the automated health check script to
confirm the backend still imports cleanly and that the full pytest suite passes:

```bash
python scripts/ensure_app_works.py
```

Pass `--skip-tests` if you only want the lightweight syntax compilation step:

```bash
python scripts/ensure_app_works.py --skip-tests
```

These checks mirror what CI runs locally, helping catch regressions early.

   Or directly:
   ```bash
   python server.py --path /path/to/markdown --port 8080
   ```

4. **Open Your Browser**:
   Navigate to `http://localhost:8080/?path=/path/to/markdown`

4. **Add Markdown Files**:
   Drop `.md` files into the watched directory and the viewer will list them automatically. Append `&file=your-file.md` to the URL to open a specific file.

### 🛠️ **Script Options**

The server honours a couple of environment variables when started via `run.sh`:

```bash
# Choose a different port
PORT=3000 ./run.sh

# Watch a different directory
MARKDOWN_DIR=~/git/asynkron/DemoIf/docs ./run.sh
```

## Usage

### Linking to directories and files
- `path` (required): Absolute or `~`-prefixed directory to watch.
- `file` (optional): Markdown file relative to the chosen directory.
- Example: `http://localhost:8080/?path=~/git/asynkron/DemoIf/docs&file=overview.md`

### Directory updates
- The client keeps a persistent WebSocket connection to `/ws`.
- Any new, modified, or removed markdown files trigger directory refreshes.
- When the open file changes on disk it is reloaded automatically.

## API Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /` | Render the HTML application. Supports `path` and `file` query parameters. |
| `GET /api/files` | Return the markdown file list for the requested directory. |
| `GET /api/file` | Fetch a single file's content. Expects `path` and `file`. |
| `GET /api/file/raw` | Download a file as plain text. |
| `DELETE /api/file` | Delete a markdown file. |
| `GET /ws` | WebSocket endpoint that streams directory updates. |

## Development

### Running Tests

```bash
pytest
```

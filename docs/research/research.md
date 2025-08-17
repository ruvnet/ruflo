The Claude Code multi-agent collaboration system is a game changer. I built things in a fraction of the time it used to take—tasks that once required hours of manual orchestration now happen in parallel, across coordinated agent workflows, with almost no overhead.

What makes it so powerful isn’t just the automation—it’s the structure. Agents aren’t freelancing; they follow SPARC. Every task is tracked, assigned, and documented. Discoveries go into a shared memory bank. Failures are logged, not buried. Progress is visible. Integration is planned.

Using BatchTool for orchestration, I get real concurrency: one agent researching tech stacks, another writing pseudocode, a third implementing code—all in sync. The boomerang pattern lets me launch, collect, and integrate work from multiple specialists, recursively refining results until done.

This is what modern development should feel like: modular, recursive, and fast. Claude Code isn’t just a new tool—it’s an entirely new development rhythm.

Great. I’ll develop a full implementation plan, directory structure, and test strategy for integrating multi-terminal orchestration into the Claude-SPARC CLI system. This will cover integration design, VS Code terminal control, argument parsing, test coverage (mocked and behavioral), and compatibility guidance.
 
 # Multi-Terminal Execution in Claude-SPARC CLI
 Here’s a lightweight extension to your `claude-sparc.sh` that lets you kick off multiple VS Code integrated terminals and run a distinct command in each. You can invoke it anywhere in your CLI flow—just drop in the helper and add the new `--multi-term` option.

```bash
# ────────────────────────────────────────────────────────────────────────────
# Multi-Terminal Orchestration Helper
# ────────────────────────────────────────────────────────────────────────────

# run_multi_term "cmd1;cmd2;cmd3"
run_multi_term() {
  IFS=';' read -r -a cmds <<< "$1"
  for cmd in "${cmds[@]}"; do
    # open a new integrated terminal
    code --command workbench.action.terminal.new
    # send the command (with Enter) into that terminal
    code --command workbench.action.terminal.sendSequence "{\"text\":\"${cmd}\\u000D\"}"
    # small pause so VS Code can spin up each terminal
    sleep 0.3
  done
}

# ────────────────────────────────────────────────────────────────────────────
# In your CLI’s option parsing block, add:
# ────────────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--multi-term)
      shift
      run_multi_term "$1"
      exit 0
      ;;
    # …other flags…
  esac
  shift
done
```

### Usage

```bash
# this will open three terminals in VS Code,
# running each command in its own pane:
./claude-sparc.sh --multi-term "npm run dev;pytest;docker-compose up"
```

**What’s happening under the hood**

1. `code --command workbench.action.terminal.new`
   creates a fresh integrated terminal.
2. `code --command workbench.action.terminal.sendSequence`
   sends your text (plus the newline `\u000D`) into that pane.
3. A brief `sleep` gives VS Code time to wire up each session before the next.

Drop this into your management CLI and you’ll have fully orchestrated, parallel terminals at your fingertips.


# Full Implementation Plan for Multi-Terminal Execution in Claude-SPARC CLI

## 1. Implementation Plan: Multi-Terminal Execution Feature

### Integration Approach (`--multi-term` Flag vs. SPARC Phase Option)

We will introduce a new **command-line flag** `--multi-term` to enable multi-terminal execution. This flag can optionally accept a configuration file path (e.g. `--multi-term path/to/config.json`); if no file is given, it defaults to a project-level config (like `.multi-term.json`). Using a CLI flag keeps the feature invocation explicit and flexible. Internally, the multi-terminal logic will be invoked during the appropriate SPARC phase (likely during *Refinement* or *Completion* – see SPARC integration notes below) when the development automation is ready to launch the application or parallel tasks. This means that if `--multi-term` is set, after code generation and setup, the script will trigger the multi-terminal routine. Integrating as a flag (rather than a new SPARC phase) avoids altering the core SPARC sequence; it simply hooks into an existing phase to launch the terminals at the right time.

In the CLI argument parser of `claude-sparc.sh`, we will add handling for this new flag. For example, using a Bash `getopts` or `case` parsing approach:

```bash
# Within claude-sparc.sh argument parsing:
MULTI_TERM=false
MULTI_TERM_CONFIG=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --multi-term) 
       MULTI_TERM=true 
       # If next argument is a file (e.g., ends with .json), treat it as config path
       if [[ -n "$2" && "$2" != "-"* ]]; then 
         MULTI_TERM_CONFIG="$2"; shift 
       fi 
       ;; 
    # ... other options ...
  esac
  shift
done
```

In the above snippet, if the user provides `--multi-term` followed by a path, we capture that as `MULTI_TERM_CONFIG`. Otherwise, we'll look for a default `.multi-term.json` in the project directory later. This approach ensures backward compatibility (the flag is optional) and clarity for users enabling multi-terminal mode.

### Design for Launching Multiple VS Code Terminals via CLI

When multi-terminal mode is active, `claude-sparc.sh` will use the VS Code environment to spawn multiple integrated terminals and run specified commands in each. The design consists of a helper script (proposed as `utils/vscode-terminals.sh`) which encapsulates the logic for opening VS Code and controlling its terminals. The main script will call a function like `launch_vscode_terminals` from this helper at the appropriate time.

**Core steps to launch multiple integrated terminals:**

1. **Open or Reuse VS Code:** Use the VS Code CLI to open the project workspace. For example: `code -r "$PROJECT_PATH"` (reuse an existing window or open a new one with the project folder). We may include a short delay (a few seconds) after this to ensure VS Code is up and running, since subsequent commands might need an active window. If the project is already open in VS Code, `-r` attaches to it; otherwise `code .` will open a new window.

2. **Open the Terminal Panel:** Ensure the integrated terminal panel is visible. We can trigger VS Code’s **Terminal: Focus** command to bring up the panel. This can be done by executing the VS Code command `workbench.action.terminal.focus` or `workbench.action.terminal.toggleTerminal` via the CLI or a URI. For instance, using a VS Code **deep link**: `vscode://workbench.action.terminal.focus` can open the terminal UI in the active VS Code window. On macOS, we would call `open "vscode://workbench.action.terminal.focus"`; on Linux, `xdg-open "vscode://workbench.action.terminal.focus"` achieves the same. This ensures at least one terminal is initialized (VS Code will create a default shell if none exists when focused).

3. **Spawn Additional Terminals:** For each extra terminal needed (beyond the first), trigger the **“Create New Integrated Terminal”** command. VS Code supports multiple terminals, which can be created by invoking the command `workbench.action.terminal.new`. We will call this command for each additional terminal required, again via the CLI or URI scheme (e.g., `vscode://workbench.action.terminal.new`). Each invocation opens a new terminal tab within VS Code’s integrated terminal panel.

4. **Send Commands to Terminals:** After each terminal is opened, the specified command for that terminal will be sent to it as if the user typed it and pressed Enter. VS Code allows programmatically sending text to a terminal using the `workbench.action.terminal.sendSequence` command. We will use this to send the desired shell command followed by a newline (Enter key). The newline is encoded as a control sequence (`\u000D`, carriage return) as required by VS Code’s `sendSequence` command to simulate the Enter key. For example, to run `npm start` in the terminal, we send `"text": "npm start\u000D"` as the argument to `sendSequence`.

The helper script will manage sequencing: open VS Code, then for each command from the config, ensure a terminal exists (opening new ones as needed) and dispatch the command to the correct terminal in order. The commands will execute concurrently in separate terminals, allowing multi-process orchestration.

**Command Encoding & Sequencing Logic:** We must carefully encode special characters and spaces when sending commands. The VS Code `sendSequence` expects a JSON payload with Unicode escape for special keys. In Bash, we can construct this JSON string and URL-encode it for use with the `vscode://` URI. For instance:

```bash
CMD="npm run start-api"
# JSON with \u000D for Enter:
JSON_PAYLOAD="{\"text\":\"${CMD}\\u000D\"}"
# URL-encode the JSON for use in vscode:// URI:
ENCODED=$(python -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$JSON_PAYLOAD")
xdg-open "vscode://workbench.action.terminal.sendSequence?${ENCODED}"
```

In the above snippet, we form a JSON argument for `sendSequence` and encode it for a URI call. This ensures characters like spaces or quotes are properly escaped. We rely on `\u000D` (carriage return) as the newline to actually execute the command in the terminal. We will apply this for each terminal’s command in sequence. The first terminal (if one was automatically created by focusing the panel) will get the first command, then each new terminal gets the subsequent commands.

### Error Handling and Edge Cases

**Missing VS Code CLI:** If the `code` CLI is not available in PATH (meaning VS Code is not installed or the shell command isn’t set up), the script will detect this and output a clear error message. For example:

```bash
if ! command -v code >/dev/null 2>&1; then
    echo "Error: VS Code CLI ('code') not found. Cannot launch integrated terminals."
    exit 1
fi
```

As a fallback, we might attempt to launch external terminals if possible (for instance, using `gnome-terminal` or `xterm` on Linux, or AppleScript to open Terminal app on macOS) with the commands, but this is optional. By default, lacking `code` will be a fatal error for `--multi-term` unless a fallback strategy is configured. This behavior will be documented so users know to install VS Code CLI support.

**Improper Shell or Environment:** The script will assume a standard shell environment in the VS Code terminals (bash/zsh on UNIX, or PowerShell/CMD on Windows). If a user’s default integrated shell is exotic or has a non-standard startup that prevents our commands from running, we will document that as a limitation. We will also ensure to strip any carriage returns or special characters from commands when constructing the JSON to avoid shell interpretation issues. All command strings will be executed exactly as provided in the config (no shell expansion or interpolation by our script beyond what the user intends).

We will also handle the case where the project’s VS Code window fails to open or the URI calls fail (for example, if VS Code isn’t responding). In such cases, the script can time out waiting for VS Code to respond. For instance, we might implement a simple wait/retry loop: after calling `code -r .` to open VS Code, try for a few seconds to send a `terminal.focus` command. If it fails (no response), we warn the user that VS Code did not launch properly.

Additionally, we’ll include checks on the config: if `--multi-term` is used but no config file is found (and no default `.multi-term.json`), the script will print an error or warning (e.g. “No multi-terminal config found”) and skip the multi-term step rather than proceeding blindly.

By integrating these checks and clear messages, we ensure that errors (missing VS Code, missing config, unsupported OS) are handled gracefully and inform the user what went wrong.

## 2. Directory and File Structure

Implementing this feature will involve adding a new helper script and possibly a config file format. Below is the proposed directory and file layout with the new additions:

```
claude-sparc/
├── claude-sparc.sh            # Main CLI script (will import utils/vscode-terminals.sh)
├── utils/
│   ├── vscode-terminals.sh    # New helper script for multi-terminal logic
│   └── ... (other utility scripts)
├── configs/
│   └── multi-term.example.json  # (Optional) Example config file for reference
├── docs/
│   └── README.md              # Documentation (to be updated with multi-term usage)
└── tests/
    ├── test_multiterm.sh      # New tests for multi-terminal feature
    └── ... (other tests)
```

**Helper Script (`utils/vscode-terminals.sh`):** This script will encapsulate functions to launch and control VS Code terminals. For example, it might define a function `launch_vscode_terminals(project_path, config_path)` that executes the steps outlined above. By isolating this logic, we keep `claude-sparc.sh` cleaner and allow reuse or independent testing of terminal launching. Key components of this script: checking for VS Code, parsing the JSON config, and issuing the appropriate `code` or `xdg-open`/`open` commands.

A simplified pseudo-code of `utils/vscode-terminals.sh` could look like:

```bash
#!/usr/bin/env bash
# utils/vscode-terminals.sh

launch_vscode_terminals() {
  local project_dir="$1"
  local config_file="$2"
  # 1. Ensure VS Code is available
  if ! command -v code >/dev/null; then
    echo "VS Code CLI not found. Aborting multi-terminal launch." >&2
    return 1
  fi
  # 2. Open VS Code on the project (reuse window if already open)
  code -r "$project_dir" 
  sleep 2  # brief pause to let VS Code initialize
  
  # 3. Read multi-terminal commands from config (JSON parsing)
  if [[ ! -f "$config_file" ]]; then
    echo "Multi-terminal config '$config_file' not found." >&2
    return 1
  fi
  # Use jq to parse the JSON array of terminals
  local commands=()
  while IFS= read -r cmd; do
    commands+=("$cmd")
  done < <(jq -r '.terminals[].command' "$config_file")
  
  # 4. Open the first terminal (if not already open, focus will create one)
  open_vscode_uri "vscode://workbench.action.terminal.focus"
  if ((${#commands[@]} > 0)); then
    send_to_vscode_terminal "${commands[0]}"
  fi
  # 5. Open and send commands to additional terminals
  for (( i=1; i<${#commands[@]}; i++ )); do
    open_vscode_uri "vscode://workbench.action.terminal.new"
    send_to_vscode_terminal "${commands[i]}"
  done
}
```

In the above snippet, `open_vscode_uri` and `send_to_vscode_terminal` would be small helper functions. `open_vscode_uri` would handle cross-platform launching of a `vscode://` URI (using `xdg-open` on Linux, `open` on macOS, and perhaps a `powershell -c start` on Windows). `send_to_vscode_terminal` would construct the JSON payload for `workbench.action.terminal.sendSequence` with the given command and newline encoding, then call `open_vscode_uri` on that URI. We separate those for clarity. The config parsing uses `jq` for reliability; the script will list `jq` as a dependency (which is common in many development environments). If `jq` is not desired, we could implement a simpler parser or require the config to be a plain newline-separated commands file – but using JSON provides structure (e.g., we could extend it with terminal names or other settings later).

**Configuration File Support (`.multi-term.json`):** We choose JSON for the configuration format as it’s human-readable and easily parsed. The config file lives at the root of the project (or a custom path if provided). It defines the commands to run in each terminal, and optionally names or other settings. For example:

```json
{
  "terminals": [
    { "name": "Backend API", "command": "npm run start-api" },
    { "name": "Frontend Dev Server", "command": "npm run start-frontend" }
  ]
}
```

In this example, two terminals will be launched: one running the API server and one running the frontend dev server. The `name` field is optional and for user reference (it could be used to label the terminal tab if we implement that, but initially it might just be documentation). The `command` field is the exact shell command to execute. The helper will iterate in order through this list. Real-world usage might include any long-running processes (servers, watch scripts, etc.) or even test commands that the user wants to run in parallel.

We will ship an example config (as shown above, possibly in `configs/multi-term.example.json` or in the README docs) to guide users in setting up their own. The script will by default look for `.multi-term.json` in the project directory if `--multi-term` is enabled without an explicit file. This filename can be documented as the convention.

**Real-World Usage Example:**
Imagine a project with a Node.js backend and a React frontend. The developer has a `api/` directory and a `web/` directory, each with start scripts. They create a `.multi-term.json` in the project root:

```json
{
  "terminals": [
    { "name": "API Server", "command": "cd api && npm start" },
    { "name": "Web Client", "command": "cd web && npm start" }
  ]
}
```

They run the Claude-SPARC CLI with `--multi-term`:

```bash
./claude-sparc.sh --multi-term myproj .project-spec.md
```

After the CLI goes through the SPARC phases and perhaps generates the application code, it reaches the point where it invokes `launch_vscode_terminals`. VS Code opens (if not already), two integrated terminals appear – one runs `cd api && npm start` (starting the API server) and the other runs `cd web && npm start` (launching the frontend dev server). Both processes run concurrently within VS Code, allowing the developer to see output from both. The CLI then finishes, leaving the VS Code environment running with the processes. This real-world scenario demonstrates how a user can immediately spin up a full-stack environment with one CLI command, improving automation and convenience.

## 3. Test Strategy

Ensuring this feature works across environments and doesn’t regress existing functionality is crucial. We will develop both unit tests and integration tests for the multi-terminal capability.

### Unit Testing (Mocking VS Code CLI and Config Parsing)

For unit tests, we will **mock the VS Code CLI and URI calls** to verify our script logic without actually launching VS Code. This can be done by temporarily overriding the `code` command in PATH or by abstracting the VS Code invocation behind a function that we can substitute in tests. For example, in `vscode-terminals.sh`, `open_vscode_uri` could call an internal command `code` or `xdg-open`. In tests, we set an environment variable like `MOCK_CODE_CLI=1` which our functions check to avoid real execution. Instead, they could echo the command to a log. We will also simulate different platforms by setting `OSTYPE` or using a small wrapper that calls `launch_vscode_terminals` with a fake platform.

Specific unit tests:

* **Config Parsing:** Provide a sample multi-term JSON and ensure our parsing extracts the correct commands. This can be done by calling the parsing portion of `launch_vscode_terminals` with a known temp file and verifying the resulting array of commands matches expected. We can instrument the script to echo parsed commands when in a test mode.
* **Command Encoding:** Test that a command containing special characters (spaces, ampersands, etc.) is correctly encoded into the URI. We can have a function `encode_command_for_uri(cmd)` and test that `encode_command_for_uri("echo hello")` returns the expected `%22echo%20hello%5Cu000D%22` segment inside the URI. This ensures our `send_to_vscode_terminal` logic produces valid output.
* **Flag Handling:** Test the CLI argument parser by invoking `claude-sparc.sh` (or its parsing function) with various combinations like `--multi-term`, `--multi-term config.json`, no flag, etc., and verify that the internal variables are set as expected (`MULTI_TERM=true/false`, `MULTI_TERM_CONFIG` path correctly captured). This can be done by sourcing the script in a test context or checking output of `--help` to ensure the new flag is listed.

These unit tests will use minimal dependencies. We might utilize a lightweight testing framework (even just bash scripts in `tests/` directory using assertions). For example, `tests/test_multiterm.sh` could run scenarios and echo “OK” or “FAIL” based on outcomes.

### Integration Testing (CLI End-to-End)

For integration tests, we want to simulate the whole CLI run with the multi-term flag. We will create a dummy project directory in a temp location, with a dummy `.multi-term.json`. We won’t actually launch VS Code in the test; instead, we’ll **stub the VS Code invocation**. One approach is to prepend our `PATH` with a fake `code` executable. For example, create a small script `fake_code.sh` that logs its arguments to a file (to verify later) and exits successfully, and put that in `PATH` ahead of the real `code`. Then run `claude-sparc.sh --multi-term` in the context of the dummy project. After execution, check that the log file contains the expected calls (e.g., we should see it called with `-r` and the project path, and perhaps attempts to open the appropriate URIs). This confirms that our script attempts to launch the terminals as designed, without needing a GUI.

We will test on both Linux and macOS environments in CI if available:

* On Linux, ensure the script tries to use `xdg-open` (we can override `xdg-open` similarly to log calls).
* On macOS, ensure it uses `open` with correct parameters.
  For Windows (if we plan to support it), we would test that the script either warns or attempts a fallback. In a Windows test environment, we could simulate `OS=CYGWIN` or `MSYS` to represent Git Bash, and ensure the script doesn’t break parsing paths, etc. (Full native Windows support might be limited; see below.)

**Behavioral Validation:** The tests will also verify that enabling `--multi-term` does not interfere with normal operation when not used. For example, running the CLI without `--multi-term` should behave exactly as before (so we run a sample spec through a dry-run and ensure outputs match expected). With `--multi-term`, since we can’t fully spawn processes in tests, we mainly verify the intentions (calls to code CLI). If possible, a manual test will be performed: actually run the CLI on a real sample project with multi-term and observe that multiple terminals open in VS Code and run the commands. This manual verification will complement automated tests.

### Platform Compatibility and Edge Testing

We plan to support Linux and macOS fully, with an **optional Windows fallback**. The testing strategy includes:

* **Linux:** Test on a typical Linux environment (Ubuntu in CI) where `xdg-open` is present. Ensure that the URIs we construct are well-formed (we may parse the logged `xdg-open` arguments to verify they contain properly encoded JSON). We also check behavior if `jq` is missing (simulate by temporarily removing it from PATH) – the script should detect the absence and produce a reasonable error.
* **macOS:** Test on macOS (if available in CI or via local testing) that the `open` commands are formed correctly. Also test an AppleScript path if we decide to use AppleScript for more complex behaviors (though currently plan is to use `open` for URIs which should be sufficient).
* **Windows:** Since VS Code’s CLI on Windows (`code.cmd`) can be used similarly, we will attempt to support it. However, automatic URI opening on Windows might require using PowerShell’s `Start-Process` or `start` command. We will implement a minimal solution: if `OSTYPE` indicates Windows, use `cmd.exe /C start vscode://...` for URIs (this will cause VS Code to handle the protocol). This will be tested on a Windows machine manually. If it proves too inconsistent, we will document that multi-terminal is only fully supported on UNIX-like systems for now. Our test strategy for Windows might just verify that the script recognizes the OS and either warns or attempts the start command string (without actually verifying VS Code opened in headless test).

Furthermore, we’ll include tests for **failure scenarios**:

* Provide a malformed JSON config and ensure the script catches the parse error (we can simulate `jq` returning error).
* Use `--multi-term` flag when `code` is not installed: our test can temporarily rename `code` and ensure the script exits with the error message “VS Code CLI not found”.
* Run the multi-term function with zero commands (empty list) – it should open VS Code but simply not open extra terminals or send anything (perhaps just open one blank terminal). The test verifies no `sendSequence` was attempted in that case.

By covering unit, integration, and cross-platform scenarios, we will have a high confidence that the multi-terminal feature is robust and behaves as expected in different environments.

## 4. Documentation Updates

Introducing the multi-terminal execution capability requires updates to the CLI’s documentation to guide users in using this feature. We will update the **README.md** (or equivalent documentation site) with a new section and examples, as well as adjust help text in the CLI.

### README – New Section on Multi-Terminal Usage

We will add a section such as **“### Multi-Terminal Execution (Parallel Terminal Automation)”** under the features or usage part of the README. This section will explain what the feature does and how to use it. For example:

> **Multi-Terminal Execution:** Claude-SPARC CLI can launch multiple terminals in VS Code to run different parts of your application in parallel. This is useful for orchestrating microservices, front-end/back-end servers, or other concurrent processes during development. To use this, run the CLI with the `--multi-term` flag. By default, it looks for a `.multi-term.json` in your project directory describing the commands to run in each terminal. You can also specify a custom config file via `--multi-term path/to/config.json`.

We will provide a step-by-step usage example in the README, similar to the real-world example discussed. For instance:

```bash
# Example usage of multi-terminal execution
claude-sparc.sh --multi-term my-project specs/feature.md
```

Along with an explanation: “After running the above, VS Code will open and start the processes defined in the multi-term config (for example, starting the dev server and watcher). You can then interact with those processes via VS Code’s terminal as they run.” We’ll ensure to note that the CLI itself will finish executing once the terminals are launched; the processes continue in VS Code.

### Command Reference and Help Text

In the **Command Line Options** section of the README (and `--help` output), we will add an entry for the new flag. For example:

* `--multi-term [CONFIG]` – Launch multiple VS Code integrated terminals as defined by the optional CONFIG JSON file (default config: `.multi-term.json`).

We will also mention any environment requirements, e.g., “Requires VS Code with CLI (`code`) in PATH.” and “Currently supported on macOS/Linux (Windows support in beta)”.

### Notes on Terminal Support and Usage Patterns

We will add documentation notes about how the feature works under the hood and any best practices. For instance, advising users to keep commands in the config long-running or to be aware that they will run concurrently. If there are known limitations (like no support for interactive prompts in those terminals initiated automatically), we will mention them. We’ll also note that the integrated terminals launched are part of the VS Code instance for the project, so closing the VS Code window will terminate those processes.

For usage patterns, we might suggest common scenarios:

* Starting a back-end API server and front-end dev server together.
* Running a test watcher alongside the application.
* Launching multiple microservices or worker processes for an orchestrated test environment.

By documenting these patterns, users can get ideas of how to leverage multi-terminal execution in their workflow.

Any relevant configuration specifics (such as the format of `.multi-term.json`) will be clearly documented. We may include the example JSON inline in the README with explanation of each field, so users can copy-paste and modify for their needs.

Finally, we update any **FAQ or Troubleshooting** section: e.g., “Q: The terminals didn’t open in VS Code, what happened?” with answers like checking that VS Code is installed and `code` command is available, or that the JSON is valid. This will preempt common issues.

By thoroughly updating documentation, we ensure developers know about this new feature and can use it effectively without confusion.

## 5. SPARC Integration Notes

The SPARC methodology phases are **Specification, Pseudocode, Architecture, Refinement, Completion**. The multi-terminal capability will be integrated in a way that complements these phases without disrupting their sequence.

### Phase Triggering (When to Launch Multi-Terminals)

The optimal point to trigger the multi-terminal execution is near the end of the workflow – most likely during **Phase 4: Refinement or Phase 5: Completion**. In practice, after the code has been generated (Architecture/Completion) and all tests passed in Refinement, the system is ready to run. We will hook the multi-terminal launch at the end of the pipeline as a final step. For example, if Phase 5 (Completion) includes a final verification or run, the multi-term can be part of that.

Concretely, in the code, after all code generation and optional test phases are done (or perhaps right after final build/test in Refinement), we insert:

```bash
if [[ "$MULTI_TERM" = true ]]; then
    launch_vscode_terminals "$PROJECT_DIR" "${MULTI_TERM_CONFIG:-$PROJECT_DIR/.multi-term.json}"
fi
```

This ensures that if the flag was enabled, we call our function to actually open the terminals. We do this towards the end so it doesn’t interfere with earlier automated phases (which might involve compiling, running tests, etc., possibly in a non-interactive environment). By launching at the end, we hand off to the developer an active environment with everything running, which aligns with the idea of concluding the SPARC workflow with a working system ready to be inspected or manually used.

If there are scenarios where multi-terminal launch might be useful mid-way (for example, perhaps using a server’s output during refinement), we considered that, but it complicates automation (as the CLI would have to continue working while processes run). Thus, the initial integration will treat multi-term as a **final orchestration step** after automated tasks are done.

### Integration with `dispatch_agent` and `BatchTool`

Claude-SPARC’s internal architecture includes tools like `dispatch_agent` (for delegating subtasks) and `BatchTool` (for parallel execution). The multi-terminal feature can leverage these if needed. For instance, if during the Refinement phase we wanted to run multiple test suites in parallel, BatchTool could theoretically spawn them. However, BatchTool typically runs commands in parallel without opening UI terminals. Our multi-terminal approach is more about developer-facing processes (in the IDE).

That said, we will ensure that `dispatch_agent` or any orchestrator knows about the `--multi-term` flag. One integration point: if the SPARC system uses an agent to handle the final deployment or run, that agent could call the `launch_vscode_terminals` function instead of a normal `Bash` tool execution. We will add a hook such that when `MULTI_TERM=true`, any final `Bash` execution step that runs the app is replaced or augmented by our multi-terminal launcher. This could be done by adjusting the logic in `claude-sparc.sh` where it would normally run something like `npm start` (if it did) – instead of running it hidden, pass it to VS Code terminal.

Optionally, we could introduce a specialized tool or command in the agent’s toolkit for this. For example, a pseudo-tool called `VSCodeTerminalTool` that the agent can invoke with a list of commands. However, since our approach uses an external script, it might be sufficient to trigger it outside of the AI agent context, directly from the shell script.

In summary, from the SPARC workflow perspective:

* **No impact on Specification/Pseudocode/Architecture phases:** those remain unchanged.
* **Refinement phase:** if tests or concurrent checks were to be run in visible terminals (not typical), we could integrate, but by default we won’t disturb automated tests by opening terminals. Those will still run via BatchTool and headless Bash as before.
* **Completion phase:** this is where multi-terminal is naturally fitted. After final code completion and perhaps a successful test run, the multi-terminal is launched to allow the developer to **manually verify the running application or environment**. It’s essentially an automated way to “launch the app” in dev mode across components.

We will document this in developer notes: the multi-terminal step is outside the AI agent’s own operations (the agent isn’t “aware” of the terminals; it’s a convenience for the human developer after the automated workflow completes). This avoids confusion where the agent might try to read terminal output – it will not; the terminals are for the user.

Should there be a need in future to have the AI agent coordinate multiple terminals (for example, an agent monitoring logs from one terminal while coding in another), we could explore deeper integration with `dispatch_agent`. That might involve the agent sending a command to launch terminals via a tool plugin. For now, the integration is implemented at the CLI level after the agent’s work, which is simpler and covers the primary use case (developer convenience).

### BatchTool Parallel Execution vs Multi-Terminals

It’s worth noting the difference between using the **BatchTool** for parallel tasks and our multi-terminal approach. BatchTool runs multiple tasks concurrently (e.g., running tests, linters in parallel) but all output still goes back to the CLI/agent context. The multi-terminal feature, on the other hand, is explicitly to open *interactive terminals* in VS Code for processes that are meant to continue running. We will clarify that these two are complementary: BatchTool is used during the automated phases for things like parallel computations or checks (headless), while multi-terminal is for interactive or long-running processes at the end.

If needed, we could have the `launch_vscode_terminals` function itself use BatchTool logic internally (to, say, send multiple commands at once). However, since we are controlling VS Code, we will sequentially send the commands (which effectively start in parallel once launched). The slight delay between opening each terminal is not significant in human terms.

**Hooks for Future Extension:** We will keep the design such that it’s easy to invoke the multi-terminal logic from other parts of the system. For example, if in future a user wants a command like `./claude-sparc.sh --phase completion --multi-term`, our internal logic would already support that because the flag is decoupled from phases. We just ensure the flag triggers the terminal launch at the right time. The `dispatch_agent` could be extended with a condition to call `launch_vscode_terminals` if an instruction or config requests interactive run. We will note this in developer comments for the project, indicating where the insertion point is in the code.

---

By following this implementation plan, we will integrate a robust and user-friendly multi-terminal execution capability into the Claude-SPARC CLI. The plan covers all aspects: from how we’ll implement and structure the code, through testing, documentation, and how it fits into the broader SPARC workflow. This ensures that once developed, the feature will be reliable, easy to use, and well-understood by the users.

#!/bin/bash
# Spawn Gemini in a new terminal window with proper TTY support

# Get the prompt file and other arguments
PROMPT_FILE="$1"
shift
CLAUDE_ARGS="$@"

# Detect the platform and terminal emulator
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use Terminal.app
    osascript -e "tell application \"Terminal\" to do script \"gemini \\\"$(cat $PROMPT_FILE)\\\" $CLAUDE_ARGS\""
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - try various terminal emulators
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal -- bash -c "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS; read -p 'Press enter to close...'"
    elif command -v xterm >/dev/null 2>&1; then
        xterm -e bash -c "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS; read -p 'Press enter to close...'"
    elif command -v konsole >/dev/null 2>&1; then
        konsole -e bash -c "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS; read -p 'Press enter to close...'"
    else
        echo "No supported terminal emulator found. Please run manually:"
        echo "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS"
    fi
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    # Windows
    cmd.exe /c start cmd /k "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS"
else
    echo "Unsupported platform: $OSTYPE"
    echo "Please run manually:"
    echo "gemini \"$(cat $PROMPT_FILE)\" $CLAUDE_ARGS"
fi
#!/bin/bash

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Trap Ctrl+C to keep terminal open after stopping logs
trap 'echo ""; echo ""; echo "Logs streaming stopped."; echo ""; read -p "Press Enter to close..." dummy; exit 0' INT TERM

# Keep terminal open and show logs
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Logs Monitor for ezcater_web_establishment_bot (tail -f)   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Streaming logs in real-time using tail -f..."
echo "Press Ctrl+C to stop streaming"
echo "============================================================"
echo ""

# PM2 converts underscores to hyphens in log filenames
APP_NAME="ezcater_web_establishment_bot"
LOG_NAME="${APP_NAME//_/-}"  # Replace _ with -

# Check if log files exist
LOG_OUT="$HOME/.pm2/logs/${LOG_NAME}-out.log"
LOG_ERR="$HOME/.pm2/logs/${LOG_NAME}-error.log"

echo "App name: $APP_NAME"
echo "Log file prefix: $LOG_NAME"
echo ""

if [ ! -f "$LOG_OUT" ] && [ ! -f "$LOG_ERR" ]; then
    echo "ERROR: Log files not found!"
    echo ""
    echo "Expected locations:"
    echo "  - $LOG_OUT"
    echo "  - $LOG_ERR"
    echo ""
    echo "This might mean:"
    echo "  - The app '$APP_NAME' has never been started"
    echo "  - PM2 is using a different log location"
    echo "  - The app name is different"
    echo ""
    echo "Current PM2 processes:"
    pm2 list
    echo ""
    echo "Actual log files in ~/.pm2/logs/:"
    ls -la "$HOME/.pm2/logs/" | grep -E "(out|error)\.log"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# Show which log file we're following
if [ -f "$LOG_OUT" ]; then
    echo "Following: $LOG_OUT"
    echo ""
    # Stream logs indefinitely (this blocks until Ctrl+C)
    tail -f "$LOG_OUT"
else
    echo "Output log not found, showing error log instead"
    echo "Following: $LOG_ERR"
    echo ""
    tail -f "$LOG_ERR"
fi

# This should not be reached unless tail exits unexpectedly
echo ""
echo "============================================================"
echo "WARNING: tail command exited unexpectedly"
echo ""
read -p "Press Enter to close..."

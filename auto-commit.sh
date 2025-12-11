#!/bin/bash
# Auto-commit watcher script
# Watches for file changes and automatically commits and pushes to GitHub

WATCH_DIR="$(dirname "$(realpath "$0")")"
cd "$WATCH_DIR"

echo "Starting auto-commit watcher for: $WATCH_DIR"
echo "Press Ctrl+C to stop"

# Function to commit and push changes
commit_and_push() {
    # Check if there are any changes
    if [[ -n $(git status --porcelain) ]]; then
        timestamp=$(date "+%Y-%m-%d %H:%M:%S")
        git add -A
        git commit -m "Auto-commit: $timestamp"
        git push
        echo "[$timestamp] Changes committed and pushed"
    fi
}

# Initial commit of any pending changes
commit_and_push

# Watch for changes every 30 seconds
while true; do
    sleep 30
    commit_and_push
done

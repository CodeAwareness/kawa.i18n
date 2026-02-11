#!/bin/bash

# Script to update all file and directory timestamps to current time
# Updates modification time (mtime), access time (atime), and creation time (birth time)

echo "Updating timestamps for all files and directories in: $(pwd)"
echo "This may take a moment..."

# Check if SetFile is available (part of Xcode Command Line Tools)
if ! command -v SetFile &> /dev/null; then
    echo "Error: SetFile command not found."
    echo "Please install Xcode Command Line Tools: xcode-select --install"
    exit 1
fi

# Get current date/time in SetFile format (MM/DD/YYYY HH:MM:SS)
CURRENT_DATE=$(date "+%m/%d/%Y %H:%M:%S")

echo "Setting all timestamps to: $CURRENT_DATE"

# Find all files and directories (excluding .git)
find . -not -path "./.git/*" -print0 | while IFS= read -r -d '' file; do
    # Update modification and access time
    touch "$file"
    # Update creation time (birth time) - SetFile doesn't work on directories
    if [ -f "$file" ]; then
        SetFile -d "$CURRENT_DATE" "$file" 2>/dev/null
    fi
done

echo "Done! All timestamps have been updated to: $(date)"

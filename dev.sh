#!/bin/bash
# Development wrapper for i18n extension
# Called by Muninn when launching extension in dev mode

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run extension with tsx
cd "$SCRIPT_DIR"
exec npx tsx src/index.ts

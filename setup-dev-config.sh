#!/bin/bash
# Sets up kawa.i18n extension for development with Kawa Code

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAWA_DIR="$HOME/.kawa-code"
EXTENSIONS_DIR="$KAWA_DIR/extensions"
EXTENSION_DIR="$EXTENSIONS_DIR/i18n"

echo "🔧 Setting up kawa.i18n extension for development..."
echo ""

# Create directories
mkdir -p "$EXTENSIONS_DIR"

# Remove existing symlink/directory if it exists
if [ -e "$EXTENSION_DIR" ]; then
    echo "📁 Removing existing extension at: $EXTENSION_DIR"
    rm -rf "$EXTENSION_DIR"
fi

# Create symlink to development directory
echo "🔗 Creating symlink: $EXTENSION_DIR -> $SCRIPT_DIR"
ln -s "$SCRIPT_DIR" "$EXTENSION_DIR"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Extension location: $EXTENSION_DIR"
echo "Extension manifest: $EXTENSION_DIR/extension.json"
echo "Dev binary: $EXTENSION_DIR/dev.sh"
echo ""
echo "Now run:"
echo "  1. Terminal 1: cd ../kawa.gardener && yarn dev"
echo "  2. Terminal 2: cd ../kawa.muninn && ./debug.sh"
echo ""
echo "Kawa Code will auto-discover and load the i18n extension!"

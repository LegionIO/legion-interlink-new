#!/usr/bin/env bash
#
# Compile LocalMacosHelper.swift into a universal (arm64 + x86_64) binary.
# Output: build/bin/LocalMacosHelper
#
# Usage:
#   bash scripts/compile-swift-helper.sh
#
# Requires Xcode or Command Line Tools with swiftc available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SWIFT_SOURCE="$PROJECT_ROOT/electron/computer-use/helpers/LocalMacosHelper.swift"
OUTPUT_DIR="$PROJECT_ROOT/build/bin"
OUTPUT_BINARY="$OUTPUT_DIR/LocalMacosHelper"

# macOS 14.0 minimum — SCScreenshotManager.captureImage requires macOS 14.0+
MIN_MACOS_VERSION="14.0"

FRAMEWORKS=(
  -framework ScreenCaptureKit
  -framework ApplicationServices
  -framework AppKit
)

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

echo "Compiling LocalMacosHelper.swift → build/bin/LocalMacosHelper"

# Temporary per-arch binaries
ARM64_BIN="$OUTPUT_DIR/.LocalMacosHelper-arm64"
X86_64_BIN="$OUTPUT_DIR/.LocalMacosHelper-x86_64"

cleanup() {
  rm -f "$ARM64_BIN" "$X86_64_BIN"
}
trap cleanup EXIT

# Compile for arm64
echo "  ▸ Compiling arm64..."
swiftc -O \
  -target arm64-apple-macosx${MIN_MACOS_VERSION} \
  "${FRAMEWORKS[@]}" \
  -o "$ARM64_BIN" \
  "$SWIFT_SOURCE"

# Compile for x86_64
echo "  ▸ Compiling x86_64..."
swiftc -O \
  -target x86_64-apple-macosx${MIN_MACOS_VERSION} \
  "${FRAMEWORKS[@]}" \
  -o "$X86_64_BIN" \
  "$SWIFT_SOURCE"

# Merge into a universal binary
echo "  ▸ Creating universal binary..."
lipo -create "$ARM64_BIN" "$X86_64_BIN" -output "$OUTPUT_BINARY"
chmod +x "$OUTPUT_BINARY"

# Verify
ARCHS=$(lipo -archs "$OUTPUT_BINARY")
SIZE=$(stat -f%z "$OUTPUT_BINARY" 2>/dev/null || stat --printf=%s "$OUTPUT_BINARY" 2>/dev/null || echo "unknown")
echo "  ✓ Universal binary: $ARCHS (${SIZE} bytes)"
echo "  ✓ Output: $OUTPUT_BINARY"

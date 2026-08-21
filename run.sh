#!/usr/bin/env bash
# Retro Love Photobooth — quick launcher (macOS/Linux)
# Compiles the single Java backend class and starts the server on
# http://localhost:8080 (override with PHOTOBOOTH_PORT).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

OUT_DIR="backend/target/classes"
mkdir -p "$OUT_DIR"

echo "Compiling PhotoBoothServer.java..."
javac -d "$OUT_DIR" backend/src/main/java/com/retrolove/photobooth/PhotoBoothServer.java

echo "Starting Retro Love Photobooth..."
exec java -Dphotobooth.root="$DIR" -cp "$OUT_DIR" com.retrolove.photobooth.PhotoBoothServer

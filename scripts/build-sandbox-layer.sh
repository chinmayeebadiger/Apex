#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LAYER_DIR="$REPO_ROOT/infra/lambda/sandbox-layer/nodejs"

mkdir -p "$LAYER_DIR"

cat > "$LAYER_DIR/package.json" <<'EOF'
{
  "name": "sandbox-layer",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "aws-cdk": "2.1126.0",
    "aws-cdk-lib": "2.170.0",
    "constructs": "10.4.2",
    "ts-node": "10.9.2",
    "typescript": "5.4.5"
  }
}
EOF

cd "$LAYER_DIR"
npm install --omit=dev

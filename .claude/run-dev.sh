#!/bin/bash
export PATH="/tmp/node-v22.12.0-linux-x64/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
exec npm run dev

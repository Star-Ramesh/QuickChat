#!/usr/bin/env sh
# QuickChat one-time setup: saves PeerJS locally into assets/js (the site never loads it from a CDN).
# Designed & Developed by [STAR RAMESH] | © 2026 [STAR RAMESH]. All rights reserved.
set -e
cd "$(dirname "$0")"
curl -L --fail -o assets/js/peerjs.min.js https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js
echo "Done: assets/js/peerjs.min.js"

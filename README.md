# QuickChat
**A temporary private communication platform.** Designed & Developed by **[STAR RAMESH]**. © 2026 [STAR RAMESH]. All rights reserved.

Peer-to-peer browser chat. No accounts, no database, no stored history. The host's browser coordinates the room; guests connect to it over WebRTC through the free PeerJS cloud signaling server (so it is "no backend of our own", not fully serverless).

## Install (2 minutes)
1. Unzip. `index.html` must sit next to `assets/`.
2. Download PeerJS once: Windows, double-click `install-libs.bat`; macOS/Linux, run `sh install-libs.sh`. (Or save https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js as `assets/js/peerjs.min.js`.) jQuery is already included.
3. Serve it over HTTP(S), not `file://`: run `python -m http.server 8080` in this folder and open `http://localhost:8080/`, or copy the folder into XAMPP `htdocs`.

## Use
- **Create room:** name, maximum members (you must choose; 2 = one-to-one), optional password. Share the Room ID or "Copy invite link".
- **Join room:** open the invite link, or enter the Room ID, your name, and the password if any.
- Host controls: change the member limit, remove members, close the room for everyone.

## Deploy on GitHub Pages
Commit everything (including `assets/js/peerjs.min.js`), then Settings → Pages → Deploy from branch `main` / root. Open the `https://<user>.github.io/<repo>/` URL on two devices to test.

## Limits
- The room exists only while the host is online. If the host disconnects, the room ends (no host failover yet).
- Some networks (symmetric NAT, strict mobile or corporate) need a TURN relay, which needs a server. Those users will see a connection error.
- Room rules and the password are checked by the host's browser; this is not tamper-proof. Chat is encrypted per link by WebRTC, but the host relays and can read it.
- Not included in this version: file sharing, music player, admin promotion and ownership transfer.

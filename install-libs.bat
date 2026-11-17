@echo off
cd /d "%~dp0"
curl -L --fail -o assets\js\peerjs.min.js https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js
if errorlevel 1 (echo Download failed. Check your internet connection and run again.) else (echo Done: assets\js\peerjs.min.js)
pause

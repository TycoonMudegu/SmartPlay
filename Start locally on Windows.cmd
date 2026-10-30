@echo off
cd /d "%~dp0"
echo Starting Smart Play locally at http://localhost:8080
start "" "http://localhost:8080"
node src/server.js
pause

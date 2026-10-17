@echo off
rem Starts the local server, which opens Module Builder in your browser. Close this window to stop.
cd /d "%~dp0"
python server.py
if errorlevel 1 pause

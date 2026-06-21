@echo off
title FS25 Dashboard Server
cd /d "%~dp0"

echo.
echo  FS25 Dashboard
echo  ==============
echo.

if not exist node_modules (
    echo  Installing dependencies ^(first run only^)...
    npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed. Is Node.js installed?
        echo  Download: https://nodejs.org/
        pause
        exit /b 1
    )
    echo.
)

echo  Server log (Ctrl+C to stop):
echo  -------------------------------------------
node index.js

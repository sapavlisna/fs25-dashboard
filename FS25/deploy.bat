@echo off
REM Build FS25_Dashboard.zip from this folder and drop it into FS25's mod folder.
REM
REM CRITICAL: modDesc.xml and DashboardExport.lua MUST be at the ZIP ROOT.
REM FS25 silently rejects mods whose modDesc.xml is one level nested.
REM
REM Run with FS25 closed. The mod ZIP is locked while the game is running.
REM
REM Override the destination if your FS25 mod folder is elsewhere:
REM   set "FS25_MODS_DIR=D:\Games\FS25\mods" && deploy.bat
REM Or create deploy.local.bat (see deploy.local.bat.example) for a permanent override.

setlocal
set "SRC=%~dp0"

REM Allow a local override script to set FS25_MODS_DIR without modifying this file.
if exist "%SRC%deploy.local.bat" call "%SRC%deploy.local.bat"

REM Default: standard FS25 user mod folder under Documents.
if not defined FS25_MODS_DIR set "FS25_MODS_DIR=%USERPROFILE%\Documents\My Games\FarmingSimulator2025\mods"

set "DEST=%FS25_MODS_DIR%\FS25_Dashboard.zip"

echo.
echo  FS25_Dashboard build + deploy
echo  -----------------------------
echo  Source: %SRC%
echo  Output: %DEST%
echo.

if not exist "%FS25_MODS_DIR%" (
    echo  ERROR: Mod folder does not exist: %FS25_MODS_DIR%
    echo  Set FS25_MODS_DIR to your actual mod folder.
    pause
    exit /b 1
)

REM Remove any previous folder-form deploy (FS25 also accepts folders, but this mod ships as a ZIP)
if exist "%FS25_MODS_DIR%\FS25_Dashboard\" rmdir /s /q "%FS25_MODS_DIR%\FS25_Dashboard"

if exist "%DEST%" del /q "%DEST%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Compress-Archive -Path '%SRC%modDesc.xml','%SRC%DashboardExport.lua','%SRC%icon_dashboard.dds' -DestinationPath '%DEST%' -CompressionLevel Optimal"

if errorlevel 1 (
    echo.
    echo  ERROR: Compress-Archive failed.
    pause
    exit /b 1
)

echo  Built: %DEST%
echo.
echo  Done. Start FS25 and check log.txt for:
echo    Available mod: (Hash: ...) (Version: X.Y.Z.W) FS25_Dashboard
echo    [FS25_Dashboard] loaded - will export every 2000 ms
echo.
pause

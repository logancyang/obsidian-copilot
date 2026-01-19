@echo off
REM Phison aiDAPTIV+ for Obsidian - Installation Script
REM This script automates the installation of the plugin to your Obsidian vault

chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ========================================
echo Phison aiDAPTIV+ for Obsidian Installer
echo ========================================
echo.

REM Get script directory
set "SCRIPT_DIR=%~dp0"

REM Plugin zip file is in the Installer subfolder
set "PLUGIN_ZIP=%SCRIPT_DIR%Installer\aiDAPTIV-Integration-Obsidian.zip"

REM Example note is in Example/Files folder
set "EXAMPLE_NOTE=%SCRIPT_DIR%Example\Files\Example_Note.md"

REM Check if plugin zip exists
if not exist "%PLUGIN_ZIP%" (
    echo [ERROR] Plugin zip file not found at:
    echo   %PLUGIN_ZIP%
    echo.
    echo Please ensure the plugin zip file exists in the Installer folder.
    echo.
    pause
    exit /b 1
)

echo [OK] Plugin zip file found!
echo.

REM Prompt user for vault path
echo Please enter your Obsidian vault path:
echo Example: D:\anna_hsu\Documents\Obsidian Vault
echo.
set /p "VAULT_PATH=Vault Path: "

REM Remove quotes if present
set "VAULT_PATH=%VAULT_PATH:"=%"

REM Validate vault path
if "%VAULT_PATH%"=="" (
    echo.
    echo [ERROR] Vault path cannot be empty!
    echo.
    pause
    exit /b 1
)

if not exist "%VAULT_PATH%" (
    echo.
    echo [ERROR] The specified vault path does not exist:
    echo   %VAULT_PATH%
    echo.
    pause
    exit /b 1
)

echo.
echo Installing to: %VAULT_PATH%
echo.

REM Create .obsidian folder if it doesn't exist
set "OBSIDIAN_DIR=%VAULT_PATH%\.obsidian"
if not exist "%OBSIDIAN_DIR%" (
    echo Creating .obsidian folder...
    mkdir "%OBSIDIAN_DIR%"
    echo   Created: %OBSIDIAN_DIR%
)

REM Create plugins folder if it doesn't exist
set "PLUGINS_DIR=%OBSIDIAN_DIR%\plugins"
if not exist "%PLUGINS_DIR%" (
    echo Creating plugins folder...
    mkdir "%PLUGINS_DIR%"
    echo   Created: %PLUGINS_DIR%
)

REM Set plugin target directory
set "PLUGIN_TARGET_DIR=%PLUGINS_DIR%\aiDAPTIV-Integration-Obsidian"

echo.
echo Extracting plugin files...
echo Target: %PLUGIN_TARGET_DIR%

REM Remove existing plugin folder if it exists
if exist "%PLUGIN_TARGET_DIR%" (
    echo   Removing existing plugin folder...
    rmdir /s /q "%PLUGIN_TARGET_DIR%"
)

REM Create target directory first
mkdir "%PLUGIN_TARGET_DIR%"

REM Use PowerShell to extract the zip file
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Expand-Archive -Path '%PLUGIN_ZIP%' -DestinationPath '%PLUGIN_TARGET_DIR%' -Force}" 2>nul

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to extract plugin files!
    echo   Please make sure PowerShell is available on your system.
    echo.
    echo Alternative: Manually extract the zip file to:
    echo   %PLUGIN_TARGET_DIR%\
    echo.
    pause
    exit /b 1
)

REM Check extracted content structure - files might be in a subfolder
if exist "%PLUGIN_TARGET_DIR%\aiDAPTIV-Integration-Obsidian\main.js" (
    echo   Moving files from subfolder...
    REM Move files from subfolder to target directory
    xcopy /e /y /q "%PLUGIN_TARGET_DIR%\aiDAPTIV-Integration-Obsidian\*" "%PLUGIN_TARGET_DIR%\" >nul
    rmdir /s /q "%PLUGIN_TARGET_DIR%\aiDAPTIV-Integration-Obsidian" >nul 2>&1
)

if exist "%PLUGIN_TARGET_DIR%" (
    echo   Plugin extracted successfully!
    echo   Location: %PLUGIN_TARGET_DIR%
    
    REM Verify required files
    set "FILES_OK=1"
    if not exist "%PLUGIN_TARGET_DIR%\main.js" set "FILES_OK=0"
    if not exist "%PLUGIN_TARGET_DIR%\manifest.json" set "FILES_OK=0"
    
    if "!FILES_OK!"=="0" (
        echo.
        echo [WARNING] Some required files may be missing!
        if exist "%PLUGIN_TARGET_DIR%\main.js" (echo   - main.js: FOUND) else (echo   - main.js: NOT FOUND)
        if exist "%PLUGIN_TARGET_DIR%\manifest.json" (echo   - manifest.json: FOUND) else (echo   - manifest.json: NOT FOUND)
        echo.
    ) else (
        echo   [OK] main.js found
        echo   [OK] manifest.json found
    )
) else (
    echo.
    echo [ERROR] Plugin folder not found after extraction!
    echo.
    pause
    exit /b 1
)

REM Copy example note to vault
echo.
echo Copying example note to vault...

if exist "%EXAMPLE_NOTE%" (
    set "EXAMPLE_TARGET=%VAULT_PATH%\Example_Note.md"
    
    if exist "!EXAMPLE_TARGET!" (
        set /p "OVERWRITE=  Example note already exists. Overwrite? (y/n): "
        if /i "!OVERWRITE!"=="y" (
            copy /y "%EXAMPLE_NOTE%" "!EXAMPLE_TARGET!" >nul
            echo   Example note copied successfully!
            echo   Location: !EXAMPLE_TARGET!
        ) else (
            echo   Skipped copying example note.
        )
    ) else (
        copy "%EXAMPLE_NOTE%" "!EXAMPLE_TARGET!" >nul
        echo   Example note copied successfully!
        echo   Location: !EXAMPLE_TARGET!
    )
) else (
    echo   [WARNING] Example note file not found at:
    echo   %EXAMPLE_NOTE%
    echo   Skipping...
)

REM Installation complete
echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Restart Obsidian
echo   2. Go to Settings ^> Community plugins
echo   3. Enable 'aiDAPTIV-Integration-Obsidian'
echo   4. Click the Copilot icon in the left sidebar
echo.
echo Plugin installed to: %PLUGIN_TARGET_DIR%
echo.
echo Happy note-taking! 🚀
echo.

pause


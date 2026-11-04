@echo off
rem RobotForge Scan Bridge - the double-click launcher (Windows).
rem
rem What it does, with no command line and nothing to type:
rem   * Registers the robotforge-scan:// link for your Windows account,
rem     which is how Scan Studio's "Start the bridge app" button wakes
rem     it. No administrator rights are needed (current-user keys).
rem   * If the bridge is already running, it just steps aside (and,
rem     when you double-clicked this file yourself, opens Scan Studio).
rem   * On the first run it sets itself up in
rem     %LOCALAPPDATA%\RobotForgeScanBridge: a private Python
rem     environment with the open-source camera pieces (numpy,
rem     pyrealsense2, Open3D). That download happens once.
rem   * Then it starts the bridge on 127.0.0.1:8765, minimised.
setlocal
set "PORT=8765"
set "PAGE=https://robot-forge-hackathon.vercel.app/scan"
set "APP_HOME=%LOCALAPPDATA%\RobotForgeScanBridge"

reg add "HKCU\Software\Classes\robotforge-scan" /f /ve /d "URL:RobotForge Scan Bridge" >nul 2>&1
reg add "HKCU\Software\Classes\robotforge-scan" /f /v "URL Protocol" /d "" >nul 2>&1
reg add "HKCU\Software\Classes\robotforge-scan\shell\open\command" /f /ve /d "\"%~f0\" \"%%1\"" >nul 2>&1

curl -s -m 2 http://127.0.0.1:%PORT%/status >nul 2>&1
if not errorlevel 1 goto already

if not exist "%APP_HOME%" mkdir "%APP_HOME%"
copy /y "%~dp0scan_bridge.py" "%APP_HOME%\scan_bridge.py" >nul

if exist "%APP_HOME%\venv\Scripts\python.exe" goto run
echo First run: downloading the open-source camera pieces. This happens once and can take a few minutes.
py -3 -m venv "%APP_HOME%\venv" 2>nul
if exist "%APP_HOME%\venv\Scripts\python.exe" goto install
python -m venv "%APP_HOME%\venv" 2>nul
if not exist "%APP_HOME%\venv\Scripts\python.exe" goto nopython
:install
"%APP_HOME%\venv\Scripts\python.exe" -m pip install numpy pyrealsense2 open3d > "%APP_HOME%\setup.log" 2>&1
if errorlevel 1 goto setupfail

:run
start "RobotForge Scan Bridge" /min "%APP_HOME%\venv\Scripts\python.exe" "%APP_HOME%\scan_bridge.py" --port %PORT%
if "%~1"=="" start "" "%PAGE%"
exit /b 0

:already
if "%~1"=="" start "" "%PAGE%"
exit /b 0

:nopython
echo Python 3 was not found on this PC. The bridge app needs it:
echo install Python from python.org (tick "Add python.exe to PATH"), then double-click this file again.
pause
exit /b 1

:setupfail
echo Setup could not download the camera pieces (numpy, pyrealsense2, Open3D).
echo Check the internet connection, then double-click this file again. Details: %APP_HOME%\setup.log
pause
exit /b 1

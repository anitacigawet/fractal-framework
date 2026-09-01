@echo off
REM Fractal Framework Wizard launcher.
REM Double-click to install/repair dependencies and launch the wizard.
REM Run `Launch_Wizard.bat /verify` for checks without opening windows.

setlocal
set "REPO_DIR=%~dp0"
set "VERIFY_ONLY="
set "BACKEND_PORT=7101"
if /I "%~1"=="/verify" set "VERIFY_ONLY=1"
if /I "%~1"=="--verify" set "VERIFY_ONLY=1"
if defined PORT set "BACKEND_PORT=%PORT%"
if exist "%REPO_DIR%wizard\.env" (
    if not defined PORT for /f "tokens=1,* delims==" %%a in ('findstr /B "PORT=" "%REPO_DIR%wizard\.env"') do set "BACKEND_PORT=%%b"
    if not defined BRIDGE_PYTHON for /f "tokens=1,* delims==" %%a in ('findstr /B "BRIDGE_PYTHON=" "%REPO_DIR%wizard\.env"') do set "BRIDGE_PYTHON=%%b"
)

echo === Fractal Framework Wizard launcher ===
echo.

REM --- Refuse to terminate an unrelated process on the wizard port ---
echo Checking wizard ports...
call :check_port %BACKEND_PORT%
if errorlevel 1 goto :fail

REM --- Move to the wizard directory (relative to this .bat) ---
cd /d "%REPO_DIR%wizard"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: pnpm not found on PATH.
    echo Install pnpm first: https://pnpm.io/installation
    goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js not found on PATH.
    echo Install Node.js 22 or newer: https://nodejs.org/
    goto :fail
)

if defined VERIFY_ONLY (
    call :verify_python
    if errorlevel 1 goto :fail
    call :verify_node_dependencies
    if errorlevel 1 goto :fail
    echo.
    echo Verification passed: tools, Python bridge, Node dependencies, types, and port.
    exit /b 0
)

REM --- Install or repair dependencies from the exact lockfile ---
echo Ensuring wizard dependencies match the lockfile...
call pnpm install --frozen-lockfile --prefer-offline
if errorlevel 1 (
    echo.
    echo pnpm install failed. See above.
    goto :fail
)
call :verify_python
if errorlevel 1 goto :fail

echo Building the local wizard...
call pnpm build
if errorlevel 1 (
    echo.
    echo Wizard build failed. See above.
    goto :fail
)

REM --- Launch the built wizard in one local process ---
echo.
echo Starting wizard on :%BACKEND_PORT%...
set "PORT=%BACKEND_PORT%"
start "Fractal Framework Wizard (:%BACKEND_PORT%)" cmd /k pnpm start

echo.
echo Wizard launching.
echo   http://127.0.0.1:%BACKEND_PORT%
echo.
echo Close the Fractal Framework Wizard terminal window to stop it.
echo.

timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:%BACKEND_PORT%

endlocal
exit /b 0

:check_port
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /R /C:":%~1 .*LISTENING"') do (
    echo.
    echo ERROR: Port %~1 is already in use by PID %%a.
    echo Close that process, then try again.
    exit /b 1
)
exit /b 0

:verify_python
set "PYTHON_EXE="
set "PYTHON_ARGS="
if defined BRIDGE_PYTHON (
    set "PYTHON_EXE=%BRIDGE_PYTHON%"
)
if not defined PYTHON_EXE (
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=python"
)
if not defined PYTHON_EXE (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3"
    )
)
if not defined PYTHON_EXE (
    echo.
    echo ERROR: Python was not found. Install Python 3.11 or newer.
    exit /b 1
)
pushd "%REPO_DIR%engine"
call "%PYTHON_EXE%" %PYTHON_ARGS% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 (
    popd
    echo.
    echo ERROR: Python 3.11 or newer is required.
    exit /b 1
)
call "%PYTHON_EXE%" %PYTHON_ARGS% -c "import notebooklm_bridge" >nul 2>&1
if errorlevel 1 (
    popd
    echo.
    echo ERROR: Python can run, but the NotebookLM bridge dependencies are missing.
    echo Install them from engine\notebooklm_bridge\requirements.txt.
    exit /b 1
)
call "%PYTHON_EXE%" %PYTHON_ARGS% -m notebooklm_bridge.runner --help >nul 2>&1
if errorlevel 1 (
    popd
    echo.
    echo ERROR: The NotebookLM bridge CLI could not start.
    exit /b 1
)
popd
exit /b 0

:verify_node_dependencies
if not exist node_modules\.modules.yaml (
    echo.
    echo ERROR: Node dependencies are not installed. Run Launch_Wizard.bat normally first.
    exit /b 1
)
if not exist node_modules\.bin\tsx.cmd (
    echo.
    echo ERROR: The Node dependency installation is incomplete ^(tsx is missing^).
    exit /b 1
)
if not exist node_modules\.bin\vite.cmd (
    echo.
    echo ERROR: The Node dependency installation is incomplete ^(Vite is missing^).
    exit /b 1
)
call pnpm check >nul
if errorlevel 1 (
    echo.
    echo ERROR: TypeScript validation failed. Run "pnpm check" in wizard\ for details.
    exit /b 1
)
exit /b 0

:fail
if not defined VERIFY_ONLY pause
exit /b 1

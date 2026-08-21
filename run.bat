@echo off
REM Retro Love Photobooth -- quick launcher (Windows)
REM Compiles the single Java backend class and starts the server on
REM http://localhost:8080 (override with PHOTOBOOTH_PORT).

setlocal
set "DIR=%~dp0"
cd /d "%DIR%"

set "OUT_DIR=backend\target\classes"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

echo Compiling PhotoBoothServer.java...
javac -d "%OUT_DIR%" backend\src\main\java\com\retrolove\photobooth\PhotoBoothServer.java
if errorlevel 1 goto :error

echo Starting Retro Love Photobooth...
java -Dphotobooth.root="%DIR%" -cp "%OUT_DIR%" com.retrolove.photobooth.PhotoBoothServer
goto :eof

:error
echo Build failed. See the errors above.
exit /b 1

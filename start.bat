@echo off
setlocal
cd /d "%~dp0"
node scripts\start-dev.cjs %*
endlocal

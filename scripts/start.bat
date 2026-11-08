@echo off
setlocal enabledelayedexpansion
title FlowStudio - Collaborative Diagram Platform

cd /d "%~dp0\.."

echo ========================================================
echo   FlowStudio - Collaborative Diagram Platform
echo   Starting server...
echo ========================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [Error] Node.js is not found in PATH. Please install Node.js 20+ first.
  pause
  exit /b 1
)

echo Building workspace packages to ensure latest code is deployed...
call pnpm -r build
if %errorlevel% neq 0 (
  echo [Error] Monorepo build failed.
  pause
  exit /b 1
)

echo Checking port 3000 availability...
netstat -ano | findstr :3000 >nul 2>nul
if %errorlevel% equ 0 (
  echo [Notice] Port 3000 is currently occupied. The server will attempt binding or report conflicts.
)

start "" /b cmd /c "ping 127.0.0.1 -n 3 >nul && start http://127.0.0.1:3000"

echo.
echo Server is launching. Browser will open at http://127.0.0.1:3000 shortly...
echo (Close this window to stop the server)
echo.

if not exist "data" mkdir data

node packages/server/dist/index.js

if %errorlevel% neq 0 (
  echo.
  echo [Error] Server stopped with error code: %errorlevel%
  pause
)

@echo off
setlocal enabledelayedexpansion
title FlowStudio - Pull Latest Code

cd /d "%~dp0\.."

echo ========================================================
echo   FlowStudio - Pull Latest Code
echo ========================================================

where git >nul 2>nul
if %errorlevel% neq 0 (
  echo [Error] Git is not found in PATH.
  goto :fail
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if not defined BRANCH (
  echo [Error] Failed to detect current git branch.
  goto :fail
)

echo Current branch: %BRANCH%
echo Pulling from origin/%BRANCH%...
echo.

git pull origin %BRANCH%
if %errorlevel% neq 0 (
  echo.
  echo [Error] git pull failed. Please check network or local conflicts.
  goto :fail
)

echo.
echo [Done] Repository is up to date.
if /i not "%~1"=="--no-pause" pause
exit /b 0

:fail
if /i not "%~1"=="--no-pause" pause
exit /b 1

@echo off
chcp 65001 >nul
title FlowStudio - 在线协作画图平台

echo ========================================================
echo   FlowStudio 正在启动服务...
echo ========================================================

rem 检查服务端产物是否存在
if not exist "packages\server\dist\index.js" (
  echo 正在执行工程编译，请稍候...
  call pnpm -r build
)

rem 启动服务端并在后台打开默认浏览器
start "" http://127.0.0.1:3000

echo.
echo 服务启动中，请勿关闭本窗口...
echo.

node packages/server/dist/index.js
pause

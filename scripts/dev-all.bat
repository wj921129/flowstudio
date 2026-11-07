@echo off
chcp 65001 >nul
echo ========================================================
echo   FlowStudio 局域网协同系统启动中...
echo   服务端 API & 协同 WebSocket: http://127.0.0.1:3000
echo   前端开发界面: http://127.0.0.1:5173
echo ========================================================

start "FlowStudio Server" cmd /k "pnpm dev:server"
start "FlowStudio Web" cmd /k "pnpm dev"

echo 服务已在新窗口启动完成。

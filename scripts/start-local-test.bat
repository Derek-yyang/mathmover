@echo off
chcp 65001 >nul
set "ROOT=%~dp0.."
set "NODE=C:\Users\Derek\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node.exe"

echo ============================================
echo  MathMover 本地测试环境（Agnes 模型）
echo ============================================
echo.

echo [1/2] 启动后端 Flask (端口 5000)...
start "MathMover-Backend" "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\app.py"

echo [2/2] 启动前端 Next.js (端口 3000)...
cd /d "%ROOT%\math-mover-next"
start "MathMover-Frontend" "%NODE%" node_modules\next\dist\bin\next dev -p 3000

echo.
echo 两个窗口启动后，等待约 20 秒，浏览器访问:
echo.
echo     http://localhost:3000
echo.
echo 关闭对应的两个命令行窗口即可停止服务。
pause

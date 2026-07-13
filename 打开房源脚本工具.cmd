@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "APP_URL=http://127.0.0.1:5173/"
set "NODE_URL=https://nodejs.org/"

cd /d "%~dp0"

echo.
echo ================================
echo  房源脚本工具 - Windows 一键启动
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。
  echo 请安装 Node.js LTS 后再双击本文件。
  start "" "%NODE_URL%"
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未检测到 npm。请重新安装 Node.js LTS，安装时勾选 npm。
  start "" "%NODE_URL%"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "NODE_MAJOR=%%v"
if "%NODE_MAJOR%"=="" (
  echo 无法读取 Node.js 版本。请安装 Node.js LTS 后再试。
  start "" "%NODE_URL%"
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS 20 (
  echo 当前 Node.js 主版本为 %NODE_MAJOR%，低于本工具要求的 Node.js LTS 20+。
  echo 请安装 Node.js LTS 后再双击本文件。
  start "" "%NODE_URL%"
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行需要安装依赖，正在执行 npm install ...
  call npm install
  if errorlevel 1 (
    echo npm install 失败，请检查网络或 npm 环境。
    pause
    exit /b 1
  )
)

echo 正在检查服务是否已经运行...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"

if "%ERRORLEVEL%"=="0" (
  echo 服务已经在运行，正在打开页面...
  start "" "%APP_URL%"
  exit /b 0
)

echo 服务未运行，正在启动 npm run dev...
start "房源脚本工具服务 - 请勿关闭" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo 等待服务启动...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto open_app
  timeout /t 1 /nobreak >nul
)

:open_app
start "" "%APP_URL%"
echo 已打开页面。如果页面暂时打不开，请等服务窗口启动完成后刷新。
echo 关闭“房源脚本工具服务”窗口后，网页工具会停止运行。

endlocal

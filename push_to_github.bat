@echo off
chcp 65001 >nul
echo ========================================================
echo   博館分隊救護義消智慧協勤系統 - GitHub 一鍵推送工具
echo ========================================================
echo.
set /p REPO_URL="請貼上您在 GitHub 建立的儲存庫網址 (例如 https://github.com/your-name/boguan-ems.git): "

if "%REPO_URL%"=="" (
    echo 網址不可為空，操作已取消。
    pause
    exit /b
)

git remote remove origin 2>nul
git remote add origin %REPO_URL%
echo.
echo 正在推送到 GitHub main 分支...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo [成功] 程式碼已成功推送到 GitHub！
    echo 接下來請前往 GitHub 儲存庫 -> Settings -> Pages：
    echo 1. Branch 選擇 'main'，路徑選 '/ (root)'
    echo 2. 點擊 'Save'
    echo 1~2 分鐘後即可取得固定公開網址！
    echo ========================================================
) else (
    echo.
    echo [提示] 推送過程中若需要登入，請依照彈出視窗完成 GitHub 授權。
)
pause

@echo off
chcp 65001 >nul
start "" explorer "%~dp0extension"
start "" chrome "chrome://extensions/"
echo.
echo 1. 在 Chrome 扩展页面开启“开发者模式”。
echo 2. 点击“加载已解压的扩展程序”。
echo 3. 选择刚刚打开的 extension 文件夹。
echo 4. 刷新网页后即可使用 Pick Memory。
echo.
pause

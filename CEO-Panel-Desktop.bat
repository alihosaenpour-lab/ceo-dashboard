@echo off
title CEO Panel - Desktop
echo ========================================
echo   CEO Panel - فروشگاه جنرال - Desktop
echo   در حال اجرا...
echo ========================================
REM اگر Chrome نصب باشد، در حالت اپ باز می‌کند (بدون نوار مرورگر)
start "" "chrome" --app="http://localhost:3000" --window-size=1400,900 2>nul
if %errorlevel% neq 0 (
  echo Chrome پيدا نشد، با مرورگر پيش‌فرض باز مي‌شود...
  start http://localhost:3000
)
echo ✅ پنل باز شد! اگر باز نشد، مرورگر را باز کن و برو به http://localhost:3000
pause

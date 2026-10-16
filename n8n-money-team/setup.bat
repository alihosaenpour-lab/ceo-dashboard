@echo off
chcp 65001 >nul
title راه‌اندازی تیم پول‌ساز n8n
color 0B
setlocal EnableDelayedExpansion

echo ==========================================================
echo       💰 راه‌اندازی تیم پول‌ساز n8n
echo       ۷۶ ورک‌فلوی آماده برای تلگرام و اینستاگرام
echo ==========================================================
echo.

REM ---------- مسیر این پوشه ----------
set "TEAM_DIR=%~dp0"
set "N8N_DIR=%USERPROFILE%\n8n-ceo"

REM ============================================================
REM  گام ۱ — نصب Node.js
REM ============================================================
echo [۱/۵] بررسی Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo   ❌ Node.js نصب نیست و n8n بدون آن اجرا نمی‌شود.
  echo.
  echo   کاری که باید بکنی:
  echo     ۱. صفحه‌ای که باز می‌شود، نسخه LTS را دانلود کن
  echo     ۲. نصب کن (Next, Next, Finish)
  echo     ۳. این فایل را دوباره اجرا کن
  echo.
  pause
  start https://nodejs.org/en/download
  exit /b 1
)
for /f "delims=" %%i in ('node --version') do set NODEVER=%%i
echo   ✅ Node.js !NODEVER! نصب است
echo.

REM ============================================================
REM  گام ۲ — آماده‌سازی پوشهٔ n8n
REM ============================================================
echo [۲/۵] آماده‌سازی پوشهٔ نصب...
if not exist "%N8N_DIR%" mkdir "%N8N_DIR%"
cd /d "%N8N_DIR%"
echo   📁 محل نصب: %N8N_DIR%
echo.

REM ============================================================
REM  گام ۳ — نصب n8n
REM ============================================================
if exist "%N8N_DIR%\node_modules\n8n" (
  echo [۳/۵] n8n قبلاً نصب شده — رد می‌شوم ✅
  echo.
  goto :import
)

echo [۳/۵] نصب n8n...
echo   ⏳ این مرحله ۳ تا ۸ دقیقه طول می‌کشد. صبر کن و پنجره را نبند.
echo.
if not exist "%N8N_DIR%\package.json" call npm init -y >nul 2>&1
call npm install n8n --no-audit --no-fund
if %errorlevel% neq 0 (
  echo.
  echo   ⚠️ نصب با خطا تمام شد. یک بار دیگر امتحان کن:
  echo      cd /d "%N8N_DIR%"
  echo      npm install n8n
  echo.
  pause
  exit /b 1
)
echo   ✅ n8n نصب شد
echo.

:import
REM ============================================================
REM  گام ۴ — ایمپورت ۷۶ ورک‌فلو
REM ============================================================
echo [۴/۵] ایمپورت ورک‌فلوها...
echo.

set "N8N_BIN=%N8N_DIR%\node_modules\.bin\n8n.cmd"
if not exist "%N8N_BIN%" (
  echo   ❌ فایل اجرایی n8n پیدا نشد. نصب ناقص است.
  pause
  exit /b 1
)

set COUNT=0
for %%S in (01-content-factory 02-instagram-social 03-telegram 04-leads-sales 05-money-ops 06-dashboard-glue) do (
  if exist "%TEAM_DIR%%%S" (
    echo   ⏳ %%S ...
    call "%N8N_BIN%" import:workflow --separate --input="%TEAM_DIR%%%S" >nul 2>&1
    if !errorlevel! equ 0 (
      echo      ✅ %%S ایمپورت شد
    ) else (
      echo      ⚠️  %%S — بخشی از فایل‌ها ایمپورت نشدند ^(طبیعی است اگر بعضی نودها را نداشته باشی^)
    )
  )
)

echo.
echo   📋 لیست ورک‌فلوهای ایمپورت‌شده:
call "%N8N_BIN%" list:workflow 2>nul | find /c "|" > "%TEMP%\n8n_count.txt"
set /p WCOUNT=<"%TEMP%\n8n_count.txt"
echo      مجموع: !WCOUNT! ورک‌فلو
del "%TEMP%\n8n_count.txt" >nul 2>&1
echo.

REM ============================================================
REM  گام ۵ — اجرا
REM ============================================================
echo [۵/۵] اجرای n8n...
echo.
echo ==========================================================
echo   ✅ همه چیز آماده است!
echo ==========================================================
echo.
echo   🌐 آدرس پنل:  http://localhost:5678
echo.
echo   مرورگر خودش باز می‌شود. اگر باز نشد، این آدرس را دستی بزن.
echo.
echo   ─────────────────────────────────────────────
echo   قدم بعدی (۵ دقیقه):
echo.
echo   ۱. در پنل، از منوی چپ برو به Workflows
echo   ۲. ورک‌فلوی "Telegram echo-bot" یا
echo      "Telegram AI-bot" را باز کن
echo   ۳. روی گره‌های قرمز کلیک کن و اعتبارنامه بساز:
echo      • Telegram  → توکن از @BotFather
echo      • OpenAI    → کلید از platform.openai.com
echo   ۴. دکمه Active (بالا-راست) را روشن کن
echo   ۵. در تلگرام به ربات خودت پیام بده 🎉
echo.
echo   ─────────────────────────────────────────────
echo   برای چک کردن وضعیت (در پنجرهٔ دیگر):
echo      cd /d "%TEAM_DIR%"
echo      node check.js
echo   ─────────────────────────────────────────────
echo.
echo   ⚠️  این پنجره را نبند — n8n باید روشن بماند
echo      برای خروج: Ctrl + C
echo.
echo ==========================================================
echo.

start "" http://localhost:5678
call "%N8N_BIN%" start

echo.
echo n8n متوقف شد.
pause

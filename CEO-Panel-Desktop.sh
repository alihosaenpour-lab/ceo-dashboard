#!/bin/bash
# CEO Panel - Desktop Launcher (Mac/Linux)
echo "========================================"
echo "  CEO Panel - فروشگاه جنرال - Desktop"
echo "  در حال اجرا..."
echo "========================================"

# اگر سرور ران نیست، ران کن
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo "🚀 سرور ران نیست، در حال ران..."
  node server.js &
  sleep 2
fi

# باز کردن در حالت اپ
if command -v google-chrome &> /dev/null; then
  google-chrome --app=http://localhost:3000 --window-size=1400,900 &
elif command -v chromium &> /dev/null; then
  chromium --app=http://localhost:3000 &
elif command -v open &> /dev/null; then
  open -a "Google Chrome" --args --app=http://localhost:3000 2>/dev/null || open http://localhost:3000
else
  xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000
fi

echo "✅ پنل باز شد! http://localhost:3000"

#!/usr/bin/env bash
# ============================================================
#   راه‌اندازی تیم پول‌ساز n8n — برای لینوکس / مک / VPS
# ============================================================
#   اجرا:   bash setup.sh
#   روی VPS با دامنه:
#           bash setup.sh --url=https://n8n.yourdomain.ir
#   با داکر (پیشنهادی برای VPS):
#           bash setup.sh --docker --url=https://n8n.yourdomain.ir
# ============================================================
set -euo pipefail

TEAM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N8N_DIR="${HOME}/n8n-ceo"
USE_DOCKER=0
WEBHOOK_URL=""
CONTAINER="n8n-ceo"

for a in "$@"; do
  case "$a" in
    --docker) USE_DOCKER=1 ;;
    --url=*)  WEBHOOK_URL="${a#*=}" ;;
    *) echo "آرگومان ناشناخته: $a" ;;
  esac
done

G='\033[32m'; R='\033[31m'; Y='\033[33m'; B='\033[1m'; C='\033[36m'; D='\033[2m'; N='\033[0m'
ok(){   echo -e "  ${G}✅${N} $1"; }
bad(){  echo -e "  ${R}❌${N} $1"; }
warn(){ echo -e "  ${Y}⚠️${N}  $1"; }
info(){ echo -e "  ${D}   $1${N}"; }
head(){ echo -e "\n${B}${C}$1${N}"; }

echo -e "${B}💰 راه‌اندازی تیم پول‌ساز n8n${N}"
echo -e "${D}   پوشه: ${TEAM_DIR}${N}"

SQUADS=(01-content-factory 02-instagram-social 03-telegram 04-leads-sales 05-money-ops 06-dashboard-glue)

# ============================================================
if [ "$USE_DOCKER" = "1" ]; then
# ---------- مسیر داکر ----------
head "۱) بررسی داکر"
  if ! command -v docker >/dev/null 2>&1; then
    bad "docker نصب نیست"
    info "نصب:  curl -fsSL https://get.docker.com | sh"
    exit 1
  fi
  ok "داکر نصب است"

  head "۲) اجرای کانتینر n8n"
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    warn "کانتینر «${CONTAINER}» از قبل هست — استفادهٔ مجدد"
    docker start "${CONTAINER}" >/dev/null 2>&1 || true
  else
    ARGS=(-d --name "$CONTAINER" --restart unless-stopped -p 5678:5678
          -v n8n_data:/home/node/.n8n
          -e N8N_SECURE_COOKIE=false
          -e N8N_DIAGNOSTICS_ENABLED=false
          -e GENERIC_TIMEZONE=Asia/Tehran
          -e TZ=Asia/Tehran)
    if [ -n "$WEBHOOK_URL" ]; then
      ARGS+=(-e "WEBHOOK_URL=${WEBHOOK_URL}" -e "N8N_HOST=$(echo "$WEBHOOK_URL" | sed -E 's#https?://##; s#/.*##')" -e N8N_PROTOCOL=https)
      ok "آدرس وبهوک: ${WEBHOOK_URL}"
    else
      warn "آدرس وبهوک تنظیم نشد — تلگرام کار نخواهد کرد تا این را بگذاری"
      info "دفعهٔ بعد اجرا کن:  bash setup.sh --docker --url=https://دامنه-تو"
    fi
    docker run "${ARGS[@]}" docker.n8n.io/n8nio/n8n >/dev/null
    ok "کانتینر ساخته و اجرا شد"
  fi

  head "۳) ایمپورت ورک‌فلوها"
  info "صبر می‌کنیم n8n بالا بیاید..."
  for i in $(seq 1 40); do
    if docker exec "$CONTAINER" wget -qO- http://localhost:5678/healthz >/dev/null 2>&1; then break; fi
    sleep 3
  done
  docker exec "$CONTAINER" mkdir -p /tmp/import >/dev/null 2>&1
  for s in "${SQUADS[@]}"; do
    [ -d "${TEAM_DIR}/${s}" ] || continue
    docker cp "${TEAM_DIR}/${s}" "${CONTAINER}:/tmp/import/" >/dev/null 2>&1
    if docker exec "$CONTAINER" n8n import:workflow --separate --input="/tmp/import/${s}" >/dev/null 2>&1; then
      ok "${s}"
    else
      warn "${s} — بخشی ایمپورت نشد (طبیعی اگر بعضی نودها را نداشته باشی)"
    fi
  done

  N8N_URL="http://localhost:5678"

else
# ---------- مسیر npm ----------
head "۱) بررسی Node.js"
  if ! command -v node >/dev/null 2>&1; then
    bad "Node.js نصب نیست"
    info "نصب روی اوبونتو/دبیان:"
    info "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    info "  sudo apt-get install -y nodejs"
    exit 1
  fi
  ok "Node.js $(node --version)"

  head "۲) نصب n8n در ${N8N_DIR}"
  mkdir -p "$N8N_DIR"
  cd "$N8N_DIR"
  if [ -d node_modules/n8n ]; then
    ok "n8n از قبل نصب است"
  else
    info "این مرحله ۳ تا ۸ دقیقه طول می‌کشد..."
    npm init -y >/dev/null 2>&1
    npm install n8n --no-audit --no-fund 2>&1 | tail -3
    ok "n8n نصب شد"
  fi

  head "۳) ایمپورت ورک‌فلوها"
  for s in "${SQUADS[@]}"; do
    [ -d "${TEAM_DIR}/${s}" ] || continue
    if ./node_modules/.bin/n8n import:workflow --separate --input="${TEAM_DIR}/${s}" >/dev/null 2>&1; then
      ok "${s}"
    else
      warn "${s} — بخشی ایمپورت نشد"
    fi
  done
  N8N_URL="http://localhost:5678"
fi

# ============================================================
head "✅ آماده است"
echo
echo -e "  🌐 پنل n8n:  ${B}${N8N_URL}${N}"
echo
if [ -z "$WEBHOOK_URL" ]; then
  echo -e "  ${Y}⚠️  برای تلگرام باید آدرس عمومی HTTPS داشته باشی.${N}"
  echo -e "  ${D}   راه سریع برای تست روی لپ‌تاپ:${N}"
  echo -e "  ${D}     npx localtunnel --port 5678${N}"
  echo -e "  ${D}   یا روی سرور، دامنه را با nginx/Caddy وصل کن.${N}"
  echo
fi
echo -e "  ${B}قدم بعدی — اولین پیروزی در ۵ دقیقه:${N}"
echo -e "  ${D}  ۱. در تلگرام @BotFather → /newbot → توکن را بگیر${N}"
echo -e "  ${D}  ۲. در پنل → Workflows → ورک‌فلوی «Telegram AI-bot» را باز کن${N}"
echo -e "  ${D}  ۳. روی گره قرمز کلیک کن → Credential بساز → توکن را بگذار${N}"
echo -e "  ${D}  ۴. کلید OpenAI را هم وصل کن${N}"
echo -e "  ${D}  ۵. دکمه Active را روشن کن و در تلگرام به ربات پیام بده 🎉${N}"
echo
echo -e "  ${D}بررسی وضعیت:  node ${TEAM_DIR}/check.js${N}"
echo
if [ "$USE_DOCKER" != "1" ]; then
  echo -e "  ${B}اجرای n8n:${N}"
  echo -e "  ${D}    cd ${N8N_DIR} && ./node_modules/.bin/n8n start${N}"
  echo
fi

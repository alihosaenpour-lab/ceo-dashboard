'use strict';
/**
 * Generates brand-consistent SVG "mockup" artwork for seeded products & portfolio.
 * Run once: node scripts/gen-assets.js  → public/img/products/*.svg, public/img/portfolio/*.svg
 */
const fs = require('fs');
const path = require('path');

const OUT_P = path.join(__dirname, '..', 'public', 'img', 'products');
const OUT_W = path.join(__dirname, '..', 'public', 'img', 'portfolio');
fs.mkdirSync(OUT_P, { recursive: true });
fs.mkdirSync(OUT_W, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function defs(id, a, b) {
  return `<defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="800" y2="600" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B1220"/><stop offset="1" stop-color="#101C33"/>
    </linearGradient>
    <linearGradient id="ac-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <radialGradient id="gl-${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${a}" stop-opacity="0.35"/><stop offset="1" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
    <filter id="sh-${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#020617" flood-opacity="0.55"/>
    </filter>
  </defs>`;
}

function grid() {
  let g = '';
  for (let x = 40; x < 800; x += 40) g += `<line x1="${x}" y1="0" x2="${x}" y2="600" stroke="#1E293B" stroke-opacity="0.25" stroke-width="1"/>`;
  for (let y = 40; y < 600; y += 40) g += `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="#1E293B" stroke-opacity="0.25" stroke-width="1"/>`;
  return `<g>${g}</g>`;
}

function badge(id, title, sub) {
  return `<g>
    <rect x="40" y="40" width="290" height="66" rx="14" fill="#0F1B30" stroke="#1E293B"/>
    <circle cx="72" cy="73" r="12" fill="url(#ac-${id})"/>
    <text x="96" y="68" font-family="Tahoma,sans-serif" font-size="17" font-weight="bold" fill="#E2E8F0">${esc(title)}</text>
    <text x="96" y="92" font-family="Tahoma,sans-serif" font-size="12.5" fill="#64748B">${esc(sub)}</text>
  </g>`;
}

/* ---------- layout: browser dashboard ---------- */
function dashboard({ id, title, sub, a, b, chart = 'bars', label }) {
  let viz = '';
  if (chart === 'bars') {
    const hs = [70, 120, 95, 160, 130, 190, 150];
    viz = hs.map((h, i) => `<rect x="${330 + i * 58}" y="${430 - h}" width="34" height="${h}" rx="8" fill="url(#ac-${id})" opacity="${0.55 + i * 0.07}"/>`).join('');
    viz += `<line x1="310" y1="430" x2="760" y2="430" stroke="#334155" stroke-width="2"/>`;
  } else if (chart === 'line') {
    viz = `<polyline points="320,400 380,350 440,370 500,300 560,320 620,250 680,270 740,200"
      fill="none" stroke="url(#ac-${id})" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    [[380,350],[500,300],[620,250],[740,200]].forEach(([x,y]) => viz += `<circle cx="${x}" cy="${y}" r="7" fill="#0B1220" stroke="${a}" stroke-width="4"/>`);
    viz += `<line x1="310" y1="430" x2="760" y2="430" stroke="#334155" stroke-width="2"/>`;
  } else { // donut
    viz = `<circle cx="530" cy="330" r="86" fill="none" stroke="#1E293B" stroke-width="26"/>
    <circle cx="530" cy="330" r="86" fill="none" stroke="url(#ac-${id})" stroke-width="26" stroke-dasharray="360 540" stroke-linecap="round" transform="rotate(-90 530 330)"/>
    <circle cx="530" cy="330" r="86" fill="none" stroke="${b}" stroke-width="26" stroke-dasharray="120 540" stroke-dashoffset="-380" stroke-linecap="round" transform="rotate(-90 530 330)" opacity="0.7"/>
    <text x="530" y="340" text-anchor="middle" font-family="Tahoma,sans-serif" font-size="26" font-weight="bold" fill="#E2E8F0">${esc(label || '۷۲٪')}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="700" cy="80" r="260" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    <rect x="290" y="150" width="480" height="330" rx="18" fill="#0F1B30" stroke="#1E293B"/>
    <rect x="290" y="150" width="480" height="42" rx="18" fill="#131F38"/>
    <circle cx="314" cy="171" r="6" fill="#EF4444" opacity="0.8"/><circle cx="334" cy="171" r="6" fill="#F59E0B" opacity="0.8"/><circle cx="354" cy="171" r="6" fill="#22C55E" opacity="0.8"/>
    <rect x="310" y="212" width="120" height="14" rx="7" fill="#1E293B"/>
    <rect x="310" y="240" width="200" height="10" rx="5" fill="#1E293B" opacity="0.7"/>
    ${viz}
    <rect x="40" y="150" width="210" height="330" rx="18" fill="#0F1B30" stroke="#1E293B"/>
    ${[0,1,2,3,4].map(i => `<rect x="60" y="${180 + i * 52}" width="170" height="36" rx="10" fill="${i === 1 ? `url(#ac-${id})` : '#16233D'}" opacity="${i === 1 ? 0.9 : 1}"/>`).join('')}
    <rect x="40" y="510" width="730" height="52" rx="14" fill="#0F1B30" stroke="#1E293B"/>
    <rect x="64" y="530" width="120" height="12" rx="6" fill="url(#ac-${id})" opacity="0.8"/>
    <rect x="210" y="530" width="90" height="12" rx="6" fill="#1E293B"/>
    <rect x="326" y="530" width="140" height="12" rx="6" fill="#1E293B"/>
  </g>
</svg>`;
}

/* ---------- layout: mobile app ---------- */
function mobile({ id, title, sub, a, b, screens = 2 }) {
  const phone = (x, scale, opacity) => `<g transform="translate(${x},90) scale(${scale})" opacity="${opacity}" filter="url(#sh-${id})">
    <rect x="0" y="0" width="230" height="430" rx="30" fill="#0F1B30" stroke="#2B3B57" stroke-width="2"/>
    <rect x="85" y="14" width="60" height="10" rx="5" fill="#2B3B57"/>
    <rect x="18" y="42" width="194" height="120" rx="14" fill="url(#ac-${id})" opacity="0.9"/>
    <rect x="34" y="62" width="100" height="12" rx="6" fill="#0B1220" opacity="0.35"/>
    <rect x="34" y="86" width="150" height="10" rx="5" fill="#0B1220" opacity="0.25"/>
    <rect x="34" y="112" width="70" height="26" rx="13" fill="#0B1220" opacity="0.45"/>
    ${[0,1,2].map(i => `<g>
      <rect x="18" y="${182 + i * 62}" width="194" height="48" rx="12" fill="#16233D"/>
      <rect x="30" y="${194 + i * 62}" width="24" height="24" rx="8" fill="url(#ac-${id})" opacity="${0.5 + i * 0.2}"/>
      <rect x="66" y="${196 + i * 62}" width="90" height="9" rx="4" fill="#334155"/>
      <rect x="66" y="${212 + i * 62}" width="130" height="8" rx="4" fill="#1E293B"/>
    </g>`).join('')}
    <rect x="18" y="378" width="194" height="38" rx="19" fill="url(#ac-${id})"/>
    <rect x="70" y="392" width="90" height="10" rx="5" fill="#0B1220" opacity="0.5"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="120" cy="520" r="280" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  ${screens > 1 ? phone(120, 0.92, 0.55) : ''}
  ${phone(screens > 1 ? 300 : 285, 1.02, 1)}
  ${screens > 2 ? phone(530, 0.92, 0.55) : ''}
</svg>`;
}

/* ---------- layout: AI chat ---------- */
function chat({ id, title, sub, a, b }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="640" cy="480" r="300" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    <rect x="120" y="150" width="560" height="360" rx="20" fill="#0F1B30" stroke="#1E293B"/>
    <circle cx="180" cy="212" r="22" fill="url(#ac-${id})"/>
    <rect x="216" y="192" width="240" height="14" rx="7" fill="#1E293B"/>
    <rect x="216" y="216" width="160" height="10" rx="5" fill="#16233D"/>
    <rect x="240" y="264" width="330" height="52" rx="14" fill="#16233D"/>
    <rect x="262" y="282" width="240" height="9" rx="4" fill="#334155"/>
    <rect x="262" y="298" width="180" height="9" rx="4" fill="#1E293B"/>
    <rect x="150" y="336" width="380" height="76" rx="14" fill="url(#ac-${id})" opacity="0.16" stroke="${a}" stroke-opacity="0.4"/>
    <rect x="172" y="356" width="280" height="9" rx="4" fill="${a}" opacity="0.75"/>
    <rect x="172" y="374" width="320" height="9" rx="4" fill="${a}" opacity="0.45"/>
    <rect x="172" y="392" width="200" height="9" rx="4" fill="${a}" opacity="0.3"/>
    <rect x="150" y="440" width="440" height="44" rx="22" fill="#16233D" stroke="#2B3B57"/>
    <circle cx="562" cy="462" r="14" fill="url(#ac-${id})"/>
  </g>
  <g opacity="0.9">
    <circle cx="668" cy="176" r="5" fill="${a}"/><circle cx="700" cy="220" r="3.5" fill="${b}"/><circle cx="640" cy="240" r="3" fill="${a}" opacity="0.6"/>
  </g>
</svg>`;
}

/* ---------- layout: automation flow ---------- */
function flow({ id, title, sub, a, b }) {
  const node = (x, y, w, t, fill) => `<g>
    <rect x="${x}" y="${y}" width="${w}" height="56" rx="14" fill="${fill}" stroke="#2B3B57"/>
    <circle cx="${x + 26}" cy="${y + 28}" r="9" fill="url(#ac-${id})"/>
    <rect x="${x + 46}" y="${y + 18}" width="${w - 70}" height="9" rx="4" fill="#475569"/>
    <rect x="${x + 46}" y="${y + 33}" width="${w - 110}" height="7" rx="3" fill="#1E293B"/>
  </g>`;
  const edge = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}" fill="none" stroke="${a}" stroke-width="2.5" stroke-opacity="0.65" stroke-dasharray="1 7" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="400" cy="300" r="300" fill="url(#gl-${id})" opacity="0.6"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    ${node(80, 170, 200, '', '#0F1B30')}
    ${node(420, 140, 220, '', '#0F1B30')}
    ${node(420, 260, 220, '', '#0F1B30')}
    ${node(160, 330, 200, '', '#0F1B30')}
    ${node(160, 450, 220, '', '#131F38')}
    ${node(520, 420, 220, '', '#0F1B30')}
    ${edge(280, 198, 420, 168)}
    ${edge(280, 210, 420, 288)}
    ${edge(530, 196, 480, 262)}
    ${edge(420, 292, 360, 350)}
    ${edge(260, 386, 250, 450)}
    ${edge(380, 478, 520, 452)}
  </g>
</svg>`;
}

/* ---------- layout: storefront ---------- */
function store({ id, title, sub, a, b }) {
  const card = (x, y, o) => `<g>
    <rect x="${x}" y="${y}" width="150" height="180" rx="14" fill="#101C33" stroke="#1E293B"/>
    <rect x="${x + 12}" y="${y + 12}" width="126" height="84" rx="10" fill="url(#ac-${id})" opacity="${o}"/>
    <rect x="${x + 12}" y="${y + 110}" width="90" height="10" rx="5" fill="#334155"/>
    <rect x="${x + 12}" y="${y + 128}" width="120" height="8" rx="4" fill="#1E293B"/>
    <rect x="${x + 12}" y="${y + 148}" width="56" height="20" rx="10" fill="url(#ac-${id})" opacity="0.85"/>
    <rect x="${x + 78}" y="${y + 148}" width="56" height="20" rx="10" fill="#16233D"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="150" cy="100" r="260" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    <rect x="60" y="140" width="680" height="410" rx="20" fill="#0F1B30" stroke="#1E293B"/>
    <rect x="60" y="140" width="680" height="46" rx="20" fill="#131F38"/>
    <circle cx="86" cy="163" r="6" fill="#EF4444" opacity="0.8"/><circle cx="106" cy="163" r="6" fill="#F59E0B" opacity="0.8"/><circle cx="126" cy="163" r="6" fill="#22C55E" opacity="0.8"/>
    <rect x="300" y="153" width="220" height="20" rx="10" fill="#0B1220" stroke="#2B3B57"/>
    ${card(90, 210, 0.85)}${card(260, 210, 0.6)}${card(430, 210, 0.8)}${card(600, 210, 0.5)}
    ${card(90, 410, 0.5)}${card(260, 410, 0.8)}${card(430, 410, 0.6)}${card(600, 410, 0.85)}
  </g>
</svg>`;
}

/* ---------- layout: ui kit ---------- */
function uikit({ id, title, sub, a, b }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="680" cy="120" r="280" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    <rect x="90" y="150" width="620" height="380" rx="20" fill="#0F1B30" stroke="#1E293B"/>
    <rect x="120" y="180" width="120" height="120" rx="16" fill="url(#ac-${id})" opacity="0.9"/>
    <rect x="260" y="180" width="120" height="120" rx="16" fill="#16233D"/>
    <circle cx="450" cy="240" r="58" fill="none" stroke="url(#ac-${id})" stroke-width="14"/>
    <rect x="550" y="180" width="130" height="54" rx="14" fill="#16233D"/>
    <rect x="550" y="248" width="130" height="52" rx="26" fill="url(#ac-${id})" opacity="0.8"/>
    <rect x="120" y="330" width="270" height="44" rx="22" fill="url(#ac-${id})"/>
    <rect x="410" y="330" width="270" height="44" rx="22" fill="#16233D" stroke="#2B3B57"/>
    <rect x="120" y="400" width="560" height="14" rx="7" fill="#16233D"/>
    <rect x="120" y="428" width="420" height="14" rx="7" fill="#16233D" opacity="0.7"/>
    <rect x="120" y="456" width="300" height="14" rx="7" fill="#16233D" opacity="0.5"/>
  </g>
</svg>`;
}

/* ---------- layout: kanban/CRM ---------- */
function kanban({ id, title, sub, a, b }) {
  const col = (x, cards) => `<g>
    <rect x="${x}" y="150" width="170" height="380" rx="16" fill="#0F1B30" stroke="#1E293B"/>
    <rect x="${x + 16}" y="168" width="90" height="12" rx="6" fill="url(#ac-${id})" opacity="0.8"/>
    ${cards.map((h, i) => `<g><rect x="${x + 14}" y="${200 + i * (h + 14)}" width="142" height="${h}" rx="12" fill="#16233D"/>
    <rect x="${x + 28}" y="${214 + i * (h + 14)}" width="${70 + (i * 13) % 40}" height="9" rx="4" fill="#334155"/>
    <rect x="${x + 28}" y="${232 + i * (h + 14)}" width="100" height="7" rx="3" fill="#1E293B"/></g>`).join('')}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  ${defs(id, a, b)}
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <circle cx="100" cy="500" r="260" fill="url(#gl-${id})"/>
  ${grid()}
  ${badge(id, title, sub)}
  <g filter="url(#sh-${id})">
    ${col(60, [70, 96, 70])}
    ${col(250, [96, 70])}
    ${col(440, [70, 70, 96])}
    ${col(630, [96])}
  </g>
</svg>`;
}

const LAYOUTS = { dashboard, mobile, chat, flow, store, uikit, kanban };

const PRODUCTS = [
  { file: 'pos-dashboard', layout: 'dashboard', chart: 'bars', title: 'داشبورد فروش ابری', sub: 'Spark POS Cloud · v2.4', a: '#22D3EE', b: '#3B82F6' },
  { file: 'crm-suite', layout: 'kanban', title: 'مدیریت ارتباط با مشتری', sub: 'Spark CRM Suite · v3.1', a: '#818CF8', b: '#3B82F6' },
  { file: 'store-theme', layout: 'store', title: 'قالب فروشگاهی نوا', sub: 'Nova Commerce Theme · v1.8', a: '#2DD4BF', b: '#0EA5E9' },
  { file: 'delivery-app', layout: 'mobile', screens: 3, title: 'اپلیکیشن سفارش و پیک', sub: 'SparkGo Delivery App · v2.0', a: '#F472B6', b: '#8B5CF6' },
  { file: 'ai-assistant', layout: 'chat', title: 'دستیار هوشمند کسب‌وکار', sub: 'Spark AI Assistant · v1.5', a: '#34D399', b: '#22D3EE' },
  { file: 'automation-studio', layout: 'flow', title: 'اتوماسیون فرآیندها', sub: 'Spark Flow Studio · v2.2', a: '#FBBF24', b: '#F97316' },
  { file: 'ui-kit', layout: 'uikit', title: 'کیت رابط کاربری اوربیت', sub: 'Orbit UI Kit · v4.0', a: '#A78BFA', b: '#22D3EE' },
  { file: 'booking-system', layout: 'dashboard', chart: 'donut', label: '٪۸۴', title: 'سامانه نوبت‌دهی و رزرو', sub: 'Spark Booking · v1.9', a: '#38BDF8', b: '#6366F1' },
  { file: 'bi-analytics', layout: 'dashboard', chart: 'line', title: 'تحلیل هوش تجاری', sub: 'Spark BI Analytics · v2.0', a: '#4ADE80', b: '#16A34A' },
];

const PORTFOLIO = [
  { file: 'pf-marketplace', layout: 'store', title: 'مارکت‌پلیس آراد', sub: 'فروشگاه چندفروشنده · ۱۴۰۳', a: '#22D3EE', b: '#3B82F6' },
  { file: 'pf-clinic', layout: 'dashboard', chart: 'donut', label: '٪۹۱', title: 'سامانه کلینیک سینا', sub: 'نوبت‌دهی و پرونده دیجیتال', a: '#34D399', b: '#0EA5E9' },
  { file: 'pf-logistics', layout: 'mobile', screens: 2, title: 'اپلیکیشن باربری نوین', sub: 'رهگیری زنده مرسولات', a: '#FBBF24', b: '#F97316' },
  { file: 'pf-finance', layout: 'dashboard', chart: 'line', title: 'داشبورد مالی هلدینگ پارس', sub: 'BI سازمانی · ۱۴۰۴', a: '#A78BFA', b: '#6366F1' },
];

function write(dir, name, svg) { fs.writeFileSync(path.join(dir, `${name}.svg`), svg); console.log('wrote', name); }

for (const p of PRODUCTS) {
  const fn = LAYOUTS[p.layout];
  write(OUT_P, p.file, fn({ id: p.file.replace(/-/g, ''), ...p }));
}
for (const w of PORTFOLIO) {
  const fn = LAYOUTS[w.layout];
  write(OUT_W, w.file, fn({ id: w.file.replace(/-/g, ''), ...w }));
}

/* hero artwork */
const hero = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 560">
  <defs>
    <linearGradient id="h-ac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#6366F1"/></linearGradient>
    <radialGradient id="h-gl" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#22D3EE" stop-opacity="0.28"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></radialGradient>
    <filter id="h-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#020617" flood-opacity="0.6"/></filter>
  </defs>
  <circle cx="360" cy="260" r="300" fill="url(#h-gl)"/>
  <g opacity="0.55">
    ${[...Array(9)].map((_, i) => `<line x1="${80 + i * 70}" y1="40" x2="${80 + i * 70}" y2="520" stroke="#1E293B" stroke-opacity="0.35"/>`).join('')}
    ${[...Array(7)].map((_, i) => `<line x1="40" y1="${80 + i * 70}" x2="680" y2="${80 + i * 70}" stroke="#1E293B" stroke-opacity="0.35"/>`).join('')}
  </g>
  <g filter="url(#h-sh)">
    <rect x="120" y="90" width="420" height="270" rx="20" fill="#0F1B30" stroke="#223552"/>
    <rect x="120" y="90" width="420" height="44" rx="20" fill="#131F38"/>
    <circle cx="146" cy="112" r="6" fill="#EF4444" opacity="0.85"/><circle cx="166" cy="112" r="6" fill="#F59E0B" opacity="0.85"/><circle cx="186" cy="112" r="6" fill="#22C55E" opacity="0.85"/>
    <rect x="146" y="158" width="130" height="12" rx="6" fill="url(#h-ac)" opacity="0.9"/>
    <rect x="146" y="184" width="220" height="9" rx="4" fill="#1E293B"/>
    ${[60, 100, 75, 140, 110, 170, 130].map((h, i) => `<rect x="${150 + i * 52}" y="${330 - h}" width="30" height="${h}" rx="7" fill="url(#h-ac)" opacity="${0.45 + i * 0.08}"/>`).join('')}
    <line x1="146" y1="330" x2="514" y2="330" stroke="#334155" stroke-width="2"/>
    <rect x="430" y="200" width="200" height="240" rx="18" fill="#101C33" stroke="#223552"/>
    <rect x="452" y="226" width="156" height="80" rx="12" fill="url(#h-ac)" opacity="0.22" stroke="#22D3EE" stroke-opacity="0.5"/>
    <rect x="468" y="244" width="90" height="10" rx="5" fill="#7DD3FC" opacity="0.9"/>
    <rect x="468" y="264" width="120" height="8" rx="4" fill="#334155"/>
    ${[0, 1, 2].map(i => `<rect x="452" y="${326 + i * 34}" width="156" height="24" rx="10" fill="#16233D"/>`).join('')}
  </g>
  <g>
    <circle cx="90" cy="430" r="7" fill="#22D3EE" opacity="0.8"/>
    <circle cx="640" cy="120" r="5" fill="#818CF8"/>
    <circle cx="600" cy="480" r="6" fill="#2DD4BF" opacity="0.7"/>
    <path d="M620 60 646 106 h-16 l 10 34 -26 -46 h16 l-10 -34Z" fill="#22D3EE" opacity="0.85"/>
  </g>
</svg>`;
write(path.join(__dirname, '..', 'public', 'img'), 'hero', hero);
console.log('assets generated');

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let serverProcess = null;
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Try to check if server is already running
function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL + '/api/health', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startServerIfNeeded() {
  return new Promise(async (resolve) => {
    if (await isServerUp()) {
      console.log('✅ Server already running on', SERVER_URL);
      return resolve(true);
    }
    console.log('🚀 Starting local server (node server.js) ...');
    // Spawn server as detached? keep as child so logs visible
    try {
      serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: __dirname,
        env: process.env,
        stdio: 'inherit'
      });
      serverProcess.on('error', (e) => console.error('Server spawn error', e));
      // Wait 2.5s and check again
      setTimeout(async () => {
        const up = await isServerUp();
        if (up) {
          console.log('✅ Server started');
        } else {
          console.warn('⚠️ Server not yet up, will load offline file');
        }
        resolve(up);
      }, 2500);
    } catch (e) {
      console.error('Failed to spawn server', e);
      resolve(false);
    }
  });
}

async function createWindow() {
  const serverUp = await startServerIfNeeded();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#080c18',
    icon: path.join(__dirname, 'icons/icon-512.png'),
    title: 'پنل CEO - آرشیا مارکت (دسکتاپ)',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    autoHideMenuBar: true,
    show: false
  });

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (serverUp) {
    console.log('📂 Loading', SERVER_URL);
    await win.loadURL(SERVER_URL);
  } else {
    console.log('📂 Loading offline file index.html');
    await win.loadFile('index.html');
    // Show dialog hint
    setTimeout(() => {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'حالت آفلاین',
        message: 'سرور محلی در دسترس نیست — پنل در حالت آفلاین (فایل) باز شد.',
        detail: 'برای حالت کامل: در ترمینال npm start را بزن و دوباره برنامه را باز کن — یا از نسخه PWA استفاده کن.',
        buttons: ['باشه']
      });
    }, 800);
  }

  win.once('ready-to-show', () => win.show());

  // Optional: open DevTools with F12
  // win.webContents.openDevTools();

  // Intercept fetch errors hint already handled in index.html filePreviewWarning
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch(e){}
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch(e){}
  }
});

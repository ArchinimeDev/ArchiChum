const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, screen, session, shell } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-http-cache');

let win = null;
let tray = null;
let isVisible = true;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  session.defaultSession.clearCache().then(() => {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  });

  win.on('closed', () => { win = null; });
}

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: '👁️  Mostrar / Ocultar', click: () => toggleVisibility() },
    { label: '👀  Llamar a personaje', click: () => win?.webContents.send('call-lunari') },
    { label: '💤  Esconder personaje', click: () => win?.webContents.send('hide-lunari') },
    { type: 'separator' },
    { label: '🎭  Cambiar pose', click: () => win?.webContents.send('toggle-pose') },
    { label: 'ℹ️  Acerca de ArchiChum', click: () => win?.webContents.send('show-credits') },
    { type: 'separator' },
    {
      label: '🧹  Recargar sin caché',
      click: () => {
        if (win) session.defaultSession.clearCache().then(() => win.webContents.reloadIgnoringCache());
      }
    },
    { label: '🔧  Abrir consola', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: '🚪  Salir', click: () => app.quit() },
  ]);
  tray.setToolTip('ArchiChum');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleVisibility());
}

function toggleVisibility() {
  if (!win) return;
  isVisible = !isVisible;
  isVisible ? win.show() : win.hide();
}

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (!win) return;
  ignore ? win.setIgnoreMouseEvents(true, { forward: true }) : win.setIgnoreMouseEvents(false);
});

ipcMain.on('quit-app', () => app.quit());

/* 🌐 Abrir enlaces externos en el navegador */
ipcMain.on('open-external', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  createWindow();
  createTray();

  globalShortcut.register('CommandOrControl+Shift+L', () => toggleVisibility());
  globalShortcut.register('CommandOrControl+Shift+K', () => win?.webContents.send('call-lunari'));
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
  globalShortcut.register('CommandOrControl+Shift+C', () => win?.webContents.send('toggle-pose'));
  globalShortcut.register('CommandOrControl+Shift+P', () => win?.webContents.send('copy-config'));
  globalShortcut.register('CommandOrControl+Shift+I', () => win?.webContents.send('show-credits'));
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (win) session.defaultSession.clearCache().then(() => win.webContents.reloadIgnoringCache());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
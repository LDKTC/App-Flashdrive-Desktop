const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { scan, APP_EXT, IMG_EXT } = require('./scan');

// Root to scan: --root=<dir> override, else the drive the app runs from (packaged), else this folder (dev).
// PORTABLE_EXECUTABLE_DIR is set by electron-builder's portable exe, which runs from a temp copy.
const arg = process.argv.find(a => a.startsWith('--root='));
const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
const ROOT = path.resolve(arg ? arg.slice(7) : app.isPackaged ? path.parse(exeDir).root : __dirname);

const allowed = new Set([ROOT]); // only paths we handed to the page may be opened

ipcMain.handle('info', () => ({ root: ROOT }));

ipcMain.handle('apps', async () => {
  const self = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const files = scan(ROOT, APP_EXT, 2, 300).filter(p => p !== self);
  return Promise.all(files.map(async p => {
    allowed.add(p);
    let icon = null;
    try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch {}
    return { name: path.basename(p, path.extname(p)), path: p, icon };
  }));
});

ipcMain.handle('images', () =>
  // ponytail: full-size files as thumbnails with lazy loading; generate real thumbnails if big drives get slow
  scan(ROOT, IMG_EXT, 6, 5000).map(p => ({ name: path.basename(p), url: pathToFileURL(p).href })));

ipcMain.handle('open', (_e, p) => allowed.has(p) ? shell.openPath(p) : 'not allowed');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 800, autoHideMenuBar: true, backgroundColor: '#0f172a',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());

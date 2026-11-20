'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { generateReport, reportSection } = require('./archive');
const { checkWindowsUpdate, supportsWindowsUpdates } = require('./windows-update');

app.setName('Local Twitch Reporting Dashboard');
const appId = 'com.vadian24.local-twitch-reporting-dashboard';
if (process.platform === 'win32') app.setAppUserModelId(appId);
if (process.platform === 'linux') {
  app.setDesktopName?.(appId + '.desktop');
  app.commandLine.appendSwitch('class', appId);
}

let dashboard;
let activeRun;
let latest;

function createWindow() {
  dashboard = new BrowserWindow({
    title: 'Local Twitch Reporting Dashboard',
    width: 1160,
    height: 780,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#101820',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  const contents = dashboard.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  dashboard.on('closed', () => {
    activeRun?.abort();
    activeRun = undefined;
    latest = undefined;
    dashboard = undefined;
  });
  return dashboard.loadFile(path.join(__dirname, 'index.html'));
}

function handle(name, callback) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== dashboard?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Request must come from the dashboard.');
    }
    return callback(event, ...args);
  });
}

handle('update:supported', () => supportsWindowsUpdates());
handle('update:check', () => checkWindowsUpdate(dashboard, () => !activeRun));

handle('report:generate', async (event, options) => {
  if (activeRun) return { error: 'A report is already running.' };
  const controller = new AbortController();
  activeRun = controller;
  try {
    const report = await generateReport(options, {
      signal: controller.signal,
      onProgress: progress => {
        if (!event.sender.isDestroyed()) event.sender.send('report:progress', progress);
      }
    });
    latest = report;
    const { channel, period, sections, data, diagnostics } = report;
    return { channel, period, sections, data, diagnostics };
  } catch (error) {
    return controller.signal.aborted ? { cancelled: true } : { error: error.message };
  } finally {
    if (activeRun === controller) activeRun = undefined;
  }
});
handle('report:cancel', () => activeRun?.abort());

function selectedReport(format, section) {
  if (!latest || (format !== 'txt' && format !== 'csv')) throw new Error('Generate a report first.');
  if (section !== undefined) return reportSection(latest, format, section);
  return { filename: latest.filename, text: latest[format] };
}

handle('report:copy', (_event, format, section) => {
  clipboard.writeText(selectedReport(format, section).text);
});
handle('report:save', async (_event, format, section) => {
  const report = selectedReport(format, section);
  const { canceled, filePath } = await dialog.showSaveDialog(dashboard, {
    defaultPath: path.join(app.getPath('downloads'), report.filename + '.' + format),
    filters: [{ name: format.toUpperCase() + ' report', extensions: [format] }]
  });
  if (canceled || !filePath) return false;
  await writeFile(filePath, report.text, 'utf8');
  return true;
});

async function launch() {
  const loading = createWindow();
  if (!process.argv.includes('--smoke-test')) return loading;
  const timeout = setTimeout(() => app.exit(1), 15_000);
  try {
    await loading;
    const result = await dashboard.webContents.executeJavaScript(
      "(async () => ({ sections: document.querySelectorAll('#section-options input').length, " +
      "updates: await window.reports.supportsUpdates(), " +
      "response: await window.reports.generate({ channel: '/' }) }))()"
    );
    if (result.sections !== 7 || result.response.error !== 'Enter a valid Twitch channel name.') {
      throw new Error('Dashboard controls or report bridge failed.');
    }
    if (result.updates !== (process.platform === 'win32')) {
      throw new Error('Packaged update configuration failed.');
    }
    console.log('Dashboard smoke test passed.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

app.whenReady().then(launch);
app.on('activate', () => {
  if (!dashboard) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

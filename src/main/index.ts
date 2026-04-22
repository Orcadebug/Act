import { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut } from 'electron';
import path from 'path';
import { PulseEngine } from './pulse-engine';
import { PulseSettings, NudgeFeedbackMessage, NudgeUpdateMessage } from '../shared/types';
import pino from 'pino';

const logger = pino({ name: 'Pulse' });

let tray: Tray | null = null;
let toastWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let engine: PulseEngine | null = null;
let isPaused = false;

const defaultSettings: PulseSettings = {
  signalIntervalMs: 2000,
  nudgeCooldownMs: 30000,
  captureAllowlist: ['Code', 'Chrome', 'Notepad', 'Firefox', 'Edge'],
  tinkerApiKey: '',
  tinkerModel: 'tinker-default',
  tinkerEndpoint: 'https://api.tinker.thinkingmachines.ai/v1/chat/completions',
  theme: 'system',
  overlayOpacity: 0.92,
  perplexityApiKey: process.env.PERPLEXITY_API_KEY || '',
  perplexityModel: 'sonar',
  screenshotRetention: false,
  signalWeights: {
    typingHesitation: 0.25,
    appSwitching: 0.25,
    dwellTime: 0.20,
    scrollVelocity: 0.10,
    clipboardCycling: 0.10,
    errorDialog: 0.10,
  },
  edgeDecayRate: 0.995,
  edgePruneThreshold: 0.01,
};

let currentSettings = { ...defaultSettings };

// ── Toast Window (frameless overlay) ──

function createToastWindow() {
  toastWindow = new BrowserWindow({
    width: 420,
    height: 460,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  toastWindow.setBounds({ x: width - 440, y: height - 480, width: 420, height: 460 });
  toastWindow.setIgnoreMouseEvents(false);

  loadPage(toastWindow, 'toast');
}

function createSettingsWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 520,
    height: 660,
    minWidth: 440,
    minHeight: 500,
    frame: true,
    title: 'Pulse — Settings',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  loadPage(dashboardWindow, 'settings');

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

function createDashboardWindow() {
  createSettingsWindow();
}

function loadPage(win: BrowserWindow, route: string) {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/${route}`);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: route || '/',
    });
  }
}

// ── Nudge Display ──

function showNudge(data: NudgeUpdateMessage) {
  if (toastWindow) {
    toastWindow.webContents.send('nudge-update', data);
    if (!toastWindow.isVisible()) {
      toastWindow.showInactive();
    }
  }
}

// ── App Ready ──

app.whenReady().then(async () => {
  createToastWindow();

  // Resolve tray icon
  const { nativeImage } = require('electron');
  const iconCandidates = [
    path.join(__dirname, '../../public/icon.png'),
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(__dirname, '../renderer/icon.png'),
  ];
  let trayIcon = nativeImage.createEmpty();
  for (const candidate of iconCandidates) {
    try {
      if (require('fs').existsSync(candidate)) {
        trayIcon = nativeImage.createFromPath(candidate);
        break;
      }
    } catch {}
  }

  tray = new Tray(trayIcon);

  const buildMenu = () => Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    {
      label: isPaused ? 'Resume' : 'Pause',
      click: () => {
        isPaused = !isPaused;
        if (engine) isPaused ? engine.pause() : engine.resume();
        tray?.setContextMenu(buildMenu());
      },
    },
    { type: 'separator' },
    { label: 'Quit Pulse', click: () => app.quit() },
  ]);

  tray.setToolTip('Pulse — Friction-Aware Desktop Intelligence');
  tray.setContextMenu(buildMenu());

  tray.on('double-click', () => createSettingsWindow());

  // Global shortcut: Ctrl+Shift+P to toggle pause
  try {
    globalShortcut.register('Ctrl+Shift+P', () => {
      isPaused = !isPaused;
      if (engine) {
        isPaused ? engine.pause() : engine.resume();
      }
      logger.info(`Pulse ${isPaused ? 'paused' : 'resumed'} via shortcut`);
      if (tray) tray.setContextMenu(buildMenu());
    });
  } catch (e) {
    logger.warn('Failed to register global shortcut:', e);
  }

  engine = new PulseEngine(currentSettings, showNudge);
  await engine.start();
  logger.info('Pulse is running');
});

app.on('window-all-closed', () => {
  // Don't quit — we're a tray app
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (engine) engine.stop();
});

// ── IPC Handlers ──

// Nudge feedback
ipcMain.on('nudge-feedback', (_event, msg: NudgeFeedbackMessage) => {
  logger.info(`Nudge feedback: ${msg.feedback} for ${msg.nudgeId}`);
  if (engine) {
    engine.handleNudgeFeedback(msg.nudgeId, msg.feedback);
  }
  if (toastWindow && msg.feedback !== 'ignored') {
    toastWindow.hide();
  }
});

// Dashboard data
ipcMain.on('request-dashboard-data', (event) => {
  if (!engine) return;
  event.sender.send('dashboard-data', {
    trust: engine.getTrustProfile(),
    friction: engine.getCurrentFriction(),
    graph: engine.getGraphStats(),
    lastNudge: engine.getLastNudge(),
  });
});

// Settings
ipcMain.on('request-settings', (event) => {
  event.sender.send('settings-data', currentSettings);
});

ipcMain.handle('save-settings', (_event, newSettings: PulseSettings) => {
  currentSettings = { ...currentSettings, ...newSettings };
  logger.info('Settings updated');
  if (engine) {
    engine.applySettings(currentSettings);
  }
  return { ok: true };
});

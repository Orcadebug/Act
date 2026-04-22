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
  perplexityApiKey: process.env.PERPLEXITY_API_KEY || 'test_key',
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
    width: 380,
    height: 420,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  toastWindow.setBounds({
    x: width - 400,
    y: height - 440,
    width: 380,
    height: 420,
  });

  loadPage(toastWindow, 'toast');
}

// ── Dashboard Window ──

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 680,
    height: 700,
    minWidth: 500,
    minHeight: 500,
    frame: true,
    title: 'Pulse — Dashboard',
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  loadPage(dashboardWindow, '');

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

function createSettingsWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    // Load settings into existing dashboard window
    loadPage(dashboardWindow, 'settings');
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 550,
    height: 650,
    minWidth: 450,
    minHeight: 400,
    frame: true,
    title: 'Pulse — Settings',
    backgroundColor: '#0f0f13',
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
  createDashboardWindow(); // Show dashboard on launch

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

  const buildMenu = () => {
    const trustScore = engine ? engine.getTrustScore() : 0.5;
    const friction = engine ? engine.getCurrentFriction() : 0;
    const stats = engine ? engine.getGraphStats() : { nodes: 0, edges: 0, nudges: 0 };

    return Menu.buildFromTemplate([
      {
        label: '📊 Dashboard',
        click: () => createDashboardWindow(),
      },
      {
        label: '⚙ Settings',
        click: () => createSettingsWindow(),
      },
      { type: 'separator' },
      {
        label: isPaused ? '▶ Resume' : '⏸ Pause',
        click: () => {
          isPaused = !isPaused;
          if (engine) {
            isPaused ? engine.pause() : engine.resume();
          }
          tray?.setContextMenu(buildMenu());
        },
      },
      { type: 'separator' },
      {
        label: `Trust: ${(trustScore * 100).toFixed(0)}%  ·  Friction: ${(friction * 100).toFixed(0)}%`,
        enabled: false,
      },
      {
        label: `Graph: ${stats.nodes}N / ${stats.edges}E  ·  ${stats.nudges} nudges`,
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Quit Pulse', click: () => app.quit() },
    ]);
  };

  tray.setToolTip('Pulse — Friction-Aware Desktop Intelligence');
  tray.setContextMenu(buildMenu());

  // Double-click tray → open dashboard
  tray.on('double-click', () => createDashboardWindow());

  // Refresh tray stats periodically
  setInterval(() => {
    if (tray) tray.setContextMenu(buildMenu());
  }, 15_000);

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

app.on('will-quit', () => {
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
  });
});

// Settings
ipcMain.on('request-settings', (event) => {
  event.sender.send('settings-data', currentSettings);
});

ipcMain.on('save-settings', (_event, newSettings: PulseSettings) => {
  currentSettings = { ...newSettings };
  logger.info('Settings updated');
  // TODO: apply settings to running engine without restart
});

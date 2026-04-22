import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ipcRenderer } from 'electron';
import './tailwind.css';
import type { NudgeUpdateMessage, NudgeFeedbackType, PulseSettings } from '../shared/types';

// ── Route ──────────────────────────────────────────────────────────────────

const App = () => {
  const hash = window.location.hash;
  if (hash.includes('toast')) return <NudgeOverlay />;
  return <SettingsWindow />;
};

// ── Nudge Overlay (toast window) ───────────────────────────────────────────

const NudgeOverlay = () => {
  const [text, setText] = useState('');
  const [citations, setCitations] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudgeId, setNudgeId] = useState('');
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [opacity, setOpacity] = useState(0.92);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Read saved opacity from localStorage
    try {
      const saved = localStorage.getItem('pulse-opacity');
      if (saved) setOpacity(parseFloat(saved));
    } catch {}

    ipcRenderer.on('nudge-update', (_, d: NudgeUpdateMessage) => {
      if (d.error) {
        setError(d.error);
        setText('');
      } else {
        setText(d.text);
        setError(null);
      }
      setCitations(d.citations ?? []);
      setDone(d.done);
      setNudgeId(d.nudgeId);
      setVisible(true);
      setExiting(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (d.done || d.error) {
        timerRef.current = setTimeout(() => dismiss('ignored'), 30_000);
      }
    });
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const dismiss = (f: NudgeFeedbackType) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (nudgeId) ipcRenderer.send('nudge-feedback', { nudgeId, feedback: f });
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
      setText('');
      setError(null);
      setDone(false);
    }, 200);
  };

  if (!visible) return null;

  return (
    <div
      className={`
        fixed inset-0 flex items-end justify-end p-3
        transition-all duration-200
        ${exiting ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
      `}
    >
      <div
        className="
          w-[380px] max-h-[420px] overflow-hidden
          rounded-2xl border border-white/10
          shadow-2xl shadow-black/40
          backdrop-blur-2xl
          flex flex-col
        "
        style={{ background: `rgba(10, 10, 10, ${opacity})` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                error ? 'bg-red-400' : done ? 'bg-emerald-400' : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="text-white/40 text-[11px] font-medium tracking-wide uppercase">
              {error ? 'Error' : done ? 'Pulse' : 'Thinking…'}
            </span>
          </div>
          <button
            onClick={() => dismiss('dismissed')}
            className="text-white/30 hover:text-white/70 transition-colors text-sm leading-none p-1 -mr-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pb-3 flex-1 overflow-y-auto">
          {error ? (
            <p className="text-red-400/90 text-[13px] leading-relaxed">{error}</p>
          ) : (
            <p className="text-white/85 text-[13px] leading-relaxed whitespace-pre-wrap">
              {text}
              {!done && (
                <span className="inline-block w-[2px] h-[14px] bg-white/60 ml-0.5 align-middle animate-pulse" />
              )}
            </p>
          )}
        </div>

        {/* Citations footer */}
        {done && !error && citations.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1">
            {citations.slice(0, 3).map((c, i) => {
              let h = c;
              try { h = new URL(c).hostname; } catch {}
              return (
                <a
                  key={i}
                  href={c}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/30 hover:text-white/60 text-[11px] transition-colors"
                >
                  {h}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Settings Window ─────────────────────────────────────────────────────────

const SettingsWindow = () => {
  const [settings, setSettings] = useState<PulseSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tinkerVisible, setTinkerVisible] = useState(false);
  const [perpVisible, setPerpVisible] = useState(false);

  useEffect(() => {
    ipcRenderer.on('settings-data', (_, s: PulseSettings) => {
      setSettings(s);
      // Sync opacity to localStorage for the overlay window
      try { localStorage.setItem('pulse-opacity', String(s.overlayOpacity ?? 0.92)); } catch {}
    });
    ipcRenderer.send('request-settings');
  }, []);

  if (!settings) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-950">
        <span className="text-white/30 text-sm">Loading…</span>
      </div>
    );
  }

  const update = <K extends keyof PulseSettings>(k: K, v: PulseSettings[K]) => {
    setSettings(prev => prev ? { ...prev, [k]: v } : prev);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    try {
      localStorage.setItem('pulse-opacity', String(settings.overlayOpacity));
      localStorage.setItem('pulse-theme', settings.theme);
      applyTheme(settings.theme);
    } catch {}
    await ipcRenderer.invoke('save-settings', settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const applyTheme = (theme: 'system' | 'light' | 'dark') => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
      if (window.matchMedia('(prefers-color-scheme: dark)').matches)
        document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.dataset.theme = theme;
    }
  };

  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const bg = isDark ? 'bg-neutral-950 text-white' : 'bg-white text-neutral-900';
  const card = isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-50 border-neutral-200';
  const input = isDark
    ? 'bg-neutral-800 border-neutral-700 text-white placeholder-neutral-500 focus:border-neutral-500'
    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-neutral-400';
  const label = isDark ? 'text-neutral-400' : 'text-neutral-500';
  const muted = isDark ? 'text-neutral-500' : 'text-neutral-400';

  return (
    <div className={`min-h-screen ${bg} p-6 overflow-y-auto`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className={`text-base font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>Pulse Settings</span>
        </div>
        <button
          onClick={save}
          className={`
            px-4 py-1.5 rounded-lg text-sm font-medium transition-all
            ${saved
              ? 'bg-emerald-600 text-white'
              : isDark
                ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                : 'bg-neutral-900 text-white hover:bg-neutral-700'
            }
          `}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {/* Tinker */}
      <section className={`rounded-xl border ${card} p-4 mb-3`}>
        <h2 className="text-sm font-semibold mb-3">Tinker (Intent Model)</h2>
        <FieldLabel label="API Key" className={label} />
        <div className="flex gap-2 mb-3">
          <input
            type={tinkerVisible ? 'text' : 'password'}
            value={settings.tinkerApiKey}
            onChange={e => update('tinkerApiKey', e.target.value)}
            placeholder="tk-…"
            className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${input}`}
          />
          <EyeBtn visible={tinkerVisible} toggle={() => setTinkerVisible(v => !v)} isDark={isDark} />
        </div>
        <FieldLabel label="Model" className={label} />
        <input
          type="text"
          value={settings.tinkerModel}
          onChange={e => update('tinkerModel', e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors mb-3 ${input}`}
        />
        <FieldLabel label="Endpoint" className={label} />
        <input
          type="text"
          value={settings.tinkerEndpoint}
          onChange={e => update('tinkerEndpoint', e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${input}`}
        />
        <p className={`text-[11px] mt-1 ${muted}`}>Override only if Thinking Machines' endpoint differs from the default.</p>
      </section>

      {/* Perplexity */}
      <section className={`rounded-xl border ${card} p-4 mb-3`}>
        <h2 className="text-sm font-semibold mb-3">Perplexity (Response Model)</h2>
        <FieldLabel label="API Key" className={label} />
        <div className="flex gap-2 mb-3">
          <input
            type={perpVisible ? 'text' : 'password'}
            value={settings.perplexityApiKey}
            onChange={e => update('perplexityApiKey', e.target.value)}
            placeholder="pplx-…"
            className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${input}`}
          />
          <EyeBtn visible={perpVisible} toggle={() => setPerpVisible(v => !v)} isDark={isDark} />
        </div>
        <FieldLabel label="Model" className={label} />
        <select
          value={settings.perplexityModel}
          onChange={e => update('perplexityModel', e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${input}`}
        >
          <option value="sonar">Sonar</option>
          <option value="sonar-pro">Sonar Pro</option>
          <option value="sonar-reasoning">Sonar Reasoning</option>
        </select>
      </section>

      {/* Appearance */}
      <section className={`rounded-xl border ${card} p-4 mb-3`}>
        <h2 className="text-sm font-semibold mb-3">Appearance</h2>

        <FieldLabel label="Theme" className={label} />
        <div className="flex gap-1 mb-4">
          {(['system', 'light', 'dark'] as const).map(t => (
            <button
              key={t}
              onClick={() => { update('theme', t); applyTheme(t); }}
              className={`
                flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-all
                ${settings.theme === t
                  ? isDark ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white'
                  : isDark ? 'bg-neutral-800 text-neutral-400 hover:text-white' : 'bg-neutral-100 text-neutral-500 hover:text-neutral-800'
                }
              `}
            >
              {t}
            </button>
          ))}
        </div>

        <FieldLabel label={`Overlay opacity — ${Math.round((settings.overlayOpacity ?? 0.92) * 100)}%`} className={label} />
        <input
          type="range"
          min={0.5}
          max={1}
          step={0.01}
          value={settings.overlayOpacity ?? 0.92}
          onChange={e => update('overlayOpacity', parseFloat(e.target.value))}
          className="w-full accent-neutral-400"
        />
      </section>

      {/* Advanced */}
      <section className={`rounded-xl border ${card} p-4 mb-3`}>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className={`flex items-center gap-2 text-sm font-semibold w-full text-left ${isDark ? 'text-white' : 'text-neutral-900'}`}
        >
          <span className={`text-xs transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
          Advanced
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <div>
              <FieldLabel label={`Signal interval — ${settings.signalIntervalMs}ms`} className={label} />
              <input type="range" min={500} max={5000} step={100} value={settings.signalIntervalMs}
                onChange={e => update('signalIntervalMs', parseInt(e.target.value))}
                className="w-full accent-neutral-400" />
            </div>
            <div>
              <FieldLabel label={`Nudge cooldown — ${Math.round(settings.nudgeCooldownMs / 1000)}s`} className={label} />
              <input type="range" min={10000} max={120000} step={5000} value={settings.nudgeCooldownMs}
                onChange={e => update('nudgeCooldownMs', parseInt(e.target.value))}
                className="w-full accent-neutral-400" />
            </div>
            <div>
              <FieldLabel label="App allowlist (comma-separated, empty = all)" className={label} />
              <input
                type="text"
                value={settings.captureAllowlist.join(', ')}
                onChange={e => update('captureAllowlist', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="Code, Chrome, Firefox…"
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${input}`}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

// ── Small components ────────────────────────────────────────────────────────

const FieldLabel = ({ label, className }: { label: string; className: string }) => (
  <label className={`block text-[11px] font-medium mb-1 ${className}`}>{label}</label>
);

const EyeBtn = ({ visible, toggle, isDark }: { visible: boolean; toggle: () => void; isDark: boolean }) => (
  <button
    onClick={toggle}
    className={`
      px-3 rounded-lg border text-sm transition-colors
      ${isDark ? 'border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white' : 'border-neutral-300 bg-white text-neutral-500 hover:text-neutral-800'}
    `}
  >
    {visible ? '○' : '◉'}
  </button>
);

// ── Mount ───────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

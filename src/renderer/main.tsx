import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ipcRenderer } from 'electron';
import './styles.css';
import type { NudgeUpdateMessage, NudgeFeedbackType, NudgeTier, PulseSettings, SignalWeights } from '../shared/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Route by hash
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const App = () => {
  const hash = window.location.hash;
  if (hash.includes('toast')) return <NudgeOverlay />;
  return <MainWindow />;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Window: Dashboard + Settings in one
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DashData {
  trust: { score: number; totalNudges: number; engagedCount: number; expandedCount: number; dismissedCount: number; ignoredCount: number };
  friction: number;
  graph: { nodes: number; edges: number; nudges: number };
}

const MainWindow = () => {
  const [tab, setTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [data, setData] = useState<DashData | null>(null);
  const [settings, setSettings] = useState<PulseSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [apiVisible, setApiVisible] = useState(false);

  useEffect(() => {
    ipcRenderer.on('dashboard-data', (_, d) => setData(d));
    ipcRenderer.on('settings-data', (_, s) => setSettings(s));
    ipcRenderer.send('request-dashboard-data');
    ipcRenderer.send('request-settings');
    const poll = setInterval(() => ipcRenderer.send('request-dashboard-data'), 4000);
    return () => clearInterval(poll);
  }, []);

  const updateSetting = (k: keyof PulseSettings, v: any) => {
    if (!settings) return;
    setSettings({ ...settings, [k]: v });
    setSaved(false);
  };
  const updateWeight = (k: keyof SignalWeights, v: number) => {
    if (!settings) return;
    setSettings({ ...settings, signalWeights: { ...settings.signalWeights, [k]: v } });
    setSaved(false);
  };
  const save = () => {
    if (!settings) return;
    ipcRenderer.send('save-settings', settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const trustPct = data ? Math.round(data.trust.score * 100) : 0;
  const frictionPct = data ? Math.round(data.friction * 100) : 0;
  const total = data ? Math.max(data.trust.totalNudges, 1) : 1;

  return (
    <div className="app">
      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#a78bfa" strokeWidth="2" />
            <path d="M6 12 Q9 6 12 12 Q15 18 18 12" stroke="#a78bfa" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
          <span>Pulse</span>
        </div>
        <button className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
          <span className="nav-icon">◉</span> Dashboard
        </button>
        <button className={`nav-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          <span className="nav-icon">⚙</span> Settings
        </button>
        <div className="sidebar-footer">
          <div className="live-dot" />
          <span className="live-text">Engine running</span>
        </div>
      </nav>

      {/* Content */}
      <main className="content">
        {tab === 'dashboard' && (
          <>
            <h1 className="page-title">Dashboard</h1>

            {/* Gauges */}
            <div className="card-row">
              <div className="card gauge-card">
                <div className="gauge-label">Trust Score</div>
                <div className="gauge-ring-wrap">
                  <svg viewBox="0 0 100 100" className="gauge-ring">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#1e1e24" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none"
                      stroke={trustPct > 60 ? '#4ade80' : trustPct > 30 ? '#facc15' : '#ef4444'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${trustPct * 2.64} 264`}
                      transform="rotate(-90 50 50)"
                      style={{ transition: 'stroke-dasharray 0.8s ease' }} />
                  </svg>
                  <div className="gauge-center">
                    <span className="gauge-value">{trustPct}</span>
                    <span className="gauge-unit">%</span>
                  </div>
                </div>
                <div className="gauge-desc">
                  {trustPct > 60 ? 'High — detailed nudges' : trustPct > 30 ? 'Moderate — standard nudges' : 'Low — minimal nudges'}
                </div>
              </div>

              <div className="card gauge-card">
                <div className="gauge-label">Current Friction</div>
                <div className="gauge-ring-wrap">
                  <svg viewBox="0 0 100 100" className="gauge-ring">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#1e1e24" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none"
                      stroke={frictionPct > 70 ? '#ef4444' : frictionPct > 40 ? '#facc15' : '#4ade80'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${frictionPct * 2.64} 264`}
                      transform="rotate(-90 50 50)"
                      style={{ transition: 'stroke-dasharray 0.8s ease' }} />
                  </svg>
                  <div className="gauge-center">
                    <span className="gauge-value">{frictionPct}</span>
                    <span className="gauge-unit">%</span>
                  </div>
                </div>
                <div className="gauge-desc">
                  {frictionPct > 70 ? 'High — nudge incoming' : frictionPct > 40 ? 'Some resistance' : 'Smooth workflow'}
                </div>
              </div>
            </div>

            {/* Context Graph */}
            <div className="card">
              <h2 className="card-title">Context Graph</h2>
              <div className="stat-row">
                <StatBox icon="◆" value={data?.graph.nodes ?? 0} label="Nodes" color="#a78bfa" />
                <StatBox icon="━" value={data?.graph.edges ?? 0} label="Edges" color="#7eb8da" />
                <StatBox icon="▸" value={data?.graph.nudges ?? 0} label="Nudges" color="#f0a05a" />
              </div>
            </div>

            {/* Engagement */}
            <div className="card">
              <h2 className="card-title">Nudge Engagement <span className="muted">({data?.trust.totalNudges ?? 0} total)</span></h2>
              <Bar label="Helpful" count={data?.trust.engagedCount ?? 0} total={total} color="#4ade80" />
              <Bar label="Expanded" count={data?.trust.expandedCount ?? 0} total={total} color="#a78bfa" />
              <Bar label="Dismissed" count={data?.trust.dismissedCount ?? 0} total={total} color="#f87171" />
              <Bar label="Ignored" count={data?.trust.ignoredCount ?? 0} total={total} color="#52525b" />
            </div>
          </>
        )}

        {tab === 'settings' && settings && (
          <>
            <div className="page-header">
              <h1 className="page-title">Settings</h1>
              <button className={`save-btn ${saved ? 'saved' : ''}`} onClick={save}>
                {saved ? '✓ Saved' : 'Save Changes'}
              </button>
            </div>

            <div className="card">
              <h2 className="card-title">API</h2>
              <label className="field-label">Perplexity API Key</label>
              <div className="input-row">
                <input type={apiVisible ? 'text' : 'password'} value={settings.perplexityApiKey}
                  onChange={e => updateSetting('perplexityApiKey', e.target.value)}
                  className="text-input" placeholder="pplx-..." />
                <button className="icon-btn" onClick={() => setApiVisible(!apiVisible)}>
                  {apiVisible ? '🙈' : '👁'}
                </button>
              </div>
              <label className="field-label">Model</label>
              <select value={settings.perplexityModel} onChange={e => updateSetting('perplexityModel', e.target.value)} className="text-input">
                <option value="sonar">Sonar</option>
                <option value="sonar-pro">Sonar Pro</option>
                <option value="sonar-reasoning">Sonar Reasoning</option>
              </select>
            </div>

            <div className="card">
              <h2 className="card-title">Timing</h2>
              <Slider label="Signal Interval" value={settings.signalIntervalMs} min={500} max={5000} step={100}
                format={v => `${v}ms`} onChange={v => updateSetting('signalIntervalMs', v)} />
              <Slider label="Nudge Cooldown" value={settings.nudgeCooldownMs} min={10000} max={120000} step={5000}
                format={v => `${(v / 1000).toFixed(0)}s`} onChange={v => updateSetting('nudgeCooldownMs', v)} />
            </div>

            <div className="card">
              <h2 className="card-title">Signal Weights</h2>
              <p className="hint">Adjust how each signal influences friction detection.</p>
              {(Object.entries(settings.signalWeights) as [keyof SignalWeights, number][]).map(([k, v]) => (
                <Slider key={k} label={formatKey(k)} value={v} min={0} max={0.5} step={0.01}
                  format={v => v.toFixed(2)} onChange={val => updateWeight(k, val)} />
              ))}
            </div>

            <div className="card">
              <h2 className="card-title">App Allowlist</h2>
              <p className="hint">Comma-separated. Empty = capture all apps.</p>
              <input type="text" value={settings.captureAllowlist.join(', ')}
                onChange={e => updateSetting('captureAllowlist', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className="text-input" placeholder="Code, Chrome, Firefox..." />
            </div>
          </>
        )}
      </main>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Nudge Overlay (toast window)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TIER_ACCENT: Record<NudgeTier, string> = { hint: '#7eb8da', detail: '#a78bfa', deep_dive: '#f0a05a' };
const TIER_LABEL: Record<NudgeTier, string> = { hint: 'Quick Hint', detail: 'Suggestion', deep_dive: 'Deep Dive' };

const NudgeOverlay = () => {
  const [text, setText] = useState('');
  const [citations, setCitations] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [nudgeId, setNudgeId] = useState('');
  const [tier, setTier] = useState<NudgeTier>('detail');
  const [friction, setFriction] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    ipcRenderer.on('nudge-update', (_, d: NudgeUpdateMessage) => {
      setText(d.text);
      setCitations(d.citations);
      setDone(d.done);
      setNudgeId(d.nudgeId);
      setTier(d.tier);
      setFriction(d.frictionScore);
      setVisible(true);
      setExiting(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (d.done) timerRef.current = setTimeout(() => fb('ignored'), 30000);
    });
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const fb = (f: NudgeFeedbackType) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (nudgeId) ipcRenderer.send('nudge-feedback', { nudgeId, feedback: f });
    setExiting(true);
    setTimeout(() => { setVisible(false); setExiting(false); setText(''); setDone(false); }, 280);
  };

  if (!visible) return null;
  const accent = TIER_ACCENT[tier];
  const pct = Math.round(friction * 100);

  return (
    <div className={`nudge-card ${exiting ? 'exit' : 'enter'}`} style={{ '--accent': accent } as any}>
      <div className="nudge-header">
        <div className="nudge-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="nudge-tier" style={{ color: accent }}>{TIER_LABEL[tier]}</span>
        <button className="nudge-close" onClick={() => fb('dismissed')}>✕</button>
      </div>
      <div className="nudge-friction">
        <span className="nudge-friction-label">Friction</span>
        <div className="nudge-friction-track">
          <div className="nudge-friction-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="nudge-friction-pct">{pct}%</span>
      </div>
      <div className="nudge-body">
        {text}
        {!done && <span className="nudge-cursor" style={{ background: accent }} />}
      </div>
      {citations.length > 0 && done && (
        <div className="nudge-sources">
          {citations.map((c, i) => {
            let h = c; try { h = new URL(c).hostname; } catch {}
            return <a key={i} href={c} target="_blank" rel="noreferrer" className="source-chip" style={{ color: accent, borderColor: `${accent}33` }}>{h}</a>;
          })}
        </div>
      )}
      {done && (
        <div className="nudge-actions">
          <button className="nudge-btn helpful" onClick={() => fb('engaged')}>👍 Helpful</button>
          <button className="nudge-btn more" onClick={() => fb('expanded')}>📖 More</button>
          <button className="nudge-btn dismiss" onClick={() => fb('dismissed')}>Not now</button>
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Small components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const StatBox = ({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) => (
  <div className="stat-box">
    <span className="stat-icon" style={{ color }}>{icon}</span>
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </div>
);

const Bar = ({ label, count, total, color }: { label: string; count: number; total: number; color: string }) => (
  <div className="bar-row">
    <span className="bar-label">{label}</span>
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${Math.max((count / total) * 100, 2)}%`, background: color }} />
    </div>
    <span className="bar-count">{count}</span>
  </div>
);

const Slider = ({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) => (
  <div className="slider-field">
    <div className="slider-header"><span>{label}</span><span className="slider-val">{format(value)}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="range-input" />
  </div>
);

const formatKey = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mount
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

import React, { useEffect, useState } from 'react';
import { ipcRenderer } from 'electron';
import { PulseSettings, SignalWeights } from '../shared/types';

/**
 * Settings panel for configuring Pulse behavior.
 * Allows tuning signal weights, cooldowns, allowlist, and API keys.
 */
export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<PulseSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  useEffect(() => {
    const handleSettings = (_: any, s: PulseSettings) => setSettings(s);
    ipcRenderer.on('settings-data', handleSettings);
    ipcRenderer.send('request-settings');
    return () => { ipcRenderer.removeListener('settings-data', handleSettings); };
  }, []);

  const update = (key: keyof PulseSettings, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setSaved(false);
  };

  const updateWeight = (key: keyof SignalWeights, value: number) => {
    if (!settings) return;
    setSettings({
      ...settings,
      signalWeights: { ...settings.signalWeights, [key]: value },
    });
    setSaved(false);
  };

  const save = () => {
    if (!settings) return;
    ipcRenderer.send('save-settings', settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) {
    return <div style={s.container}><div style={s.loading}>Loading settings...</div></div>;
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h2 style={s.title}>⚙ Settings</h2>
        <button onClick={save} style={{
          ...s.saveBtn,
          background: saved ? '#4ade80' : '#a78bfa',
        }}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* API Configuration */}
      <Section title="API Configuration">
        <Field label="Perplexity API Key">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={apiKeyVisible ? 'text' : 'password'}
              value={settings.perplexityApiKey}
              onChange={e => update('perplexityApiKey', e.target.value)}
              style={s.input}
              placeholder="pplx-..."
            />
            <button onClick={() => setApiKeyVisible(!apiKeyVisible)} style={s.toggleBtn}>
              {apiKeyVisible ? '🙈' : '👁'}
            </button>
          </div>
        </Field>
        <Field label="Model">
          <select value={settings.perplexityModel} onChange={e => update('perplexityModel', e.target.value)} style={s.select}>
            <option value="sonar">Sonar</option>
            <option value="sonar-pro">Sonar Pro</option>
            <option value="sonar-reasoning">Sonar Reasoning</option>
          </select>
        </Field>
      </Section>

      {/* Timing */}
      <Section title="Timing">
        <Field label={`Signal Interval: ${settings.signalIntervalMs}ms`}>
          <input type="range" min={500} max={5000} step={100}
            value={settings.signalIntervalMs}
            onChange={e => update('signalIntervalMs', Number(e.target.value))}
            style={s.slider}
          />
        </Field>
        <Field label={`Nudge Cooldown: ${(settings.nudgeCooldownMs / 1000).toFixed(0)}s`}>
          <input type="range" min={10000} max={120000} step={5000}
            value={settings.nudgeCooldownMs}
            onChange={e => update('nudgeCooldownMs', Number(e.target.value))}
            style={s.slider}
          />
        </Field>
      </Section>

      {/* Signal Weights */}
      <Section title="Signal Weights">
        <p style={s.hint}>How much each behavioral signal contributes to friction detection. Should sum to ~1.0.</p>
        {Object.entries(settings.signalWeights).map(([key, val]) => (
          <Field key={key} label={`${formatWeightName(key)}: ${(val as number).toFixed(2)}`}>
            <input type="range" min={0} max={0.5} step={0.01}
              value={val as number}
              onChange={e => updateWeight(key as keyof SignalWeights, Number(e.target.value))}
              style={s.slider}
            />
          </Field>
        ))}
      </Section>

      {/* App Allowlist */}
      <Section title="App Allowlist">
        <p style={s.hint}>Only capture context from these apps. Leave empty to allow all.</p>
        <input
          type="text"
          value={settings.captureAllowlist.join(', ')}
          onChange={e => update('captureAllowlist', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          style={s.input}
          placeholder="Code, Chrome, Firefox..."
        />
      </Section>

      {/* Memory */}
      <Section title="Context Graph">
        <Field label={`Edge Decay Rate: ${settings.edgeDecayRate}`}>
          <input type="range" min={0.98} max={1.0} step={0.001}
            value={settings.edgeDecayRate}
            onChange={e => update('edgeDecayRate', Number(e.target.value))}
            style={s.slider}
          />
        </Field>
        <Field label="Screenshot Retention">
          <label style={s.checkboxLabel}>
            <input type="checkbox" checked={settings.screenshotRetention}
              onChange={e => update('screenshotRetention', e.target.checked)}
            />
            <span>Keep screenshots on disk</span>
          </label>
        </Field>
      </Section>
    </div>
  );
};

// ── Helpers ──

function formatWeightName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={s.section}>
    <h3 style={s.sectionTitle}>{title}</h3>
    {children}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={s.field}>
    <label style={s.label}>{label}</label>
    {children}
  </div>
);

// ── Styles ──

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    background: '#0f0f13',
    color: '#e4e4e7',
    minHeight: '100vh',
    padding: '28px 32px',
  },
  loading: { color: '#71717a', textAlign: 'center', marginTop: '40vh' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
  },
  title: { fontSize: '20px', fontWeight: 700, margin: 0 },
  saveBtn: {
    padding: '8px 20px',
    borderRadius: '8px',
    border: 'none',
    color: '#000',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background 0.3s',
  },
  section: {
    background: '#18181b',
    borderRadius: '12px',
    padding: '18px',
    border: '1px solid #27272a',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#a1a1aa',
    marginBottom: '14px',
    marginTop: 0,
  },
  field: { marginBottom: '12px' },
  label: {
    display: 'block',
    fontSize: '12px',
    color: '#a1a1aa',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    background: '#0f0f13',
    color: '#e4e4e7',
    fontSize: '13px',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    background: '#0f0f13',
    color: '#e4e4e7',
    fontSize: '13px',
    outline: 'none',
  },
  slider: {
    width: '100%',
    accentColor: '#a78bfa',
  },
  toggleBtn: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    background: '#0f0f13',
    color: '#e4e4e7',
    cursor: 'pointer',
    fontSize: '14px',
  },
  hint: {
    fontSize: '11px',
    color: '#52525b',
    marginBottom: '12px',
    marginTop: 0,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#a1a1aa',
    cursor: 'pointer',
  },
};

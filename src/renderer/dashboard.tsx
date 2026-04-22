import React, { useEffect, useState, useCallback } from 'react';
import { ipcRenderer } from 'electron';

interface DashboardData {
  trust: {
    score: number;
    totalNudges: number;
    engagedCount: number;
    expandedCount: number;
    dismissedCount: number;
    ignoredCount: number;
  };
  friction: number;
  graph: { nodes: number; edges: number; nudges: number };
}

/**
 * Dashboard — Live insights into Pulse's behavior.
 * Shows trust score, friction level, context graph stats,
 * and nudge engagement history.
 */
export const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    const handleData = (_: any, d: DashboardData) => setData(d);
    ipcRenderer.on('dashboard-data', handleData);

    // Request initial data
    ipcRenderer.send('request-dashboard-data');

    // Poll every 5s
    const interval = setInterval(() => {
      ipcRenderer.send('request-dashboard-data');
    }, 5000);

    return () => {
      ipcRenderer.removeListener('dashboard-data', handleData);
      clearInterval(interval);
    };
  }, []);

  if (!data) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Connecting to Pulse engine...</div>
      </div>
    );
  }

  const trustPct = Math.round(data.trust.score * 100);
  const frictionPct = Math.round(data.friction * 100);
  const total = data.trust.totalNudges || 1;
  const engagedPct = Math.round((data.trust.engagedCount / total) * 100);
  const expandedPct = Math.round((data.trust.expandedCount / total) * 100);
  const dismissedPct = Math.round((data.trust.dismissedCount / total) * 100);
  const ignoredPct = Math.round((data.trust.ignoredCount / total) * 100);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>◉</span>
          <span style={styles.logoText}>Pulse</span>
        </div>
        <span style={styles.subtitle}>Friction-Aware Desktop Intelligence</span>
      </div>

      {/* Live Meters */}
      <div style={styles.metersRow}>
        <MeterCard
          label="Trust Score"
          value={trustPct}
          unit="%"
          color={trustPct > 60 ? '#4ade80' : trustPct > 30 ? '#facc15' : '#ef4444'}
          description={trustPct > 60 ? 'High — showing detailed nudges' : trustPct > 30 ? 'Moderate — standard nudges' : 'Low — minimal nudges'}
        />
        <MeterCard
          label="Current Friction"
          value={frictionPct}
          unit="%"
          color={frictionPct > 70 ? '#ef4444' : frictionPct > 40 ? '#facc15' : '#4ade80'}
          description={frictionPct > 70 ? 'High friction detected' : frictionPct > 40 ? 'Some friction' : 'Smooth workflow'}
        />
      </div>

      {/* Graph Stats */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Context Graph</h3>
        <div style={styles.statsRow}>
          <StatBadge label="Nodes" value={data.graph.nodes} icon="◆" />
          <StatBadge label="Edges" value={data.graph.edges} icon="━" />
          <StatBadge label="Nudges" value={data.graph.nudges} icon="▸" />
        </div>
      </div>

      {/* Engagement Breakdown */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Nudge Engagement ({data.trust.totalNudges} total)</h3>
        <div style={styles.barContainer}>
          <EngagementBar label="Helpful" pct={engagedPct} color="#4ade80" count={data.trust.engagedCount} />
          <EngagementBar label="Expanded" pct={expandedPct} color="#a78bfa" count={data.trust.expandedCount} />
          <EngagementBar label="Dismissed" pct={dismissedPct} color="#f87171" count={data.trust.dismissedCount} />
          <EngagementBar label="Ignored" pct={ignoredPct} color="#52525b" count={data.trust.ignoredCount} />
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ──

const MeterCard: React.FC<{
  label: string; value: number; unit: string; color: string; description: string;
}> = ({ label, value, unit, color, description }) => (
  <div style={styles.meterCard}>
    <div style={styles.meterLabel}>{label}</div>
    <div style={{ ...styles.meterValue, color }}>{value}<span style={styles.meterUnit}>{unit}</span></div>
    <div style={styles.meterBar}>
      <div style={{ ...styles.meterFill, width: `${value}%`, background: color }} />
    </div>
    <div style={styles.meterDesc}>{description}</div>
  </div>
);

const StatBadge: React.FC<{ label: string; value: number; icon: string }> = ({ label, value, icon }) => (
  <div style={styles.statBadge}>
    <span style={styles.statIcon}>{icon}</span>
    <span style={styles.statValue}>{value}</span>
    <span style={styles.statLabel}>{label}</span>
  </div>
);

const EngagementBar: React.FC<{
  label: string; pct: number; color: string; count: number;
}> = ({ label, pct, color, count }) => (
  <div style={styles.engagementRow}>
    <span style={styles.engagementLabel}>{label}</span>
    <div style={styles.engagementBarBg}>
      <div style={{
        height: '100%',
        width: `${Math.max(pct, 2)}%`,
        background: color,
        borderRadius: '3px',
        transition: 'width 0.5s ease',
      }} />
    </div>
    <span style={styles.engagementCount}>{count}</span>
  </div>
);

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    background: '#0f0f13',
    color: '#e4e4e7',
    minHeight: '100vh',
    padding: '28px 32px',
  },
  loading: {
    color: '#71717a',
    textAlign: 'center',
    marginTop: '40vh',
  },
  header: {
    marginBottom: '28px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '4px',
  },
  logoIcon: {
    fontSize: '22px',
    color: '#a78bfa',
  },
  logoText: {
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '13px',
    color: '#71717a',
    marginLeft: '32px',
  },
  metersRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
  },
  meterCard: {
    flex: 1,
    background: '#18181b',
    borderRadius: '12px',
    padding: '18px',
    border: '1px solid #27272a',
  },
  meterLabel: {
    fontSize: '11px',
    color: '#71717a',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: '8px',
  },
  meterValue: {
    fontSize: '36px',
    fontWeight: 700,
    letterSpacing: '-1px',
    lineHeight: 1,
  },
  meterUnit: {
    fontSize: '16px',
    fontWeight: 400,
    opacity: 0.6,
    marginLeft: '2px',
  },
  meterBar: {
    height: '4px',
    background: '#27272a',
    borderRadius: '2px',
    marginTop: '12px',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.5s ease',
  },
  meterDesc: {
    fontSize: '11px',
    color: '#52525b',
    marginTop: '8px',
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
  },
  statsRow: {
    display: 'flex',
    gap: '12px',
  },
  statBadge: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    padding: '12px',
    background: '#0f0f13',
    borderRadius: '8px',
  },
  statIcon: {
    fontSize: '16px',
    color: '#a78bfa',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
  },
  statLabel: {
    fontSize: '10px',
    color: '#71717a',
    textTransform: 'uppercase' as const,
  },
  barContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  engagementRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  engagementLabel: {
    fontSize: '12px',
    color: '#a1a1aa',
    width: '70px',
    flexShrink: 0,
  },
  engagementBarBg: {
    flex: 1,
    height: '6px',
    background: '#27272a',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  engagementCount: {
    fontSize: '12px',
    color: '#52525b',
    width: '30px',
    textAlign: 'right' as const,
  },
};

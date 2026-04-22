import React, { useEffect, useState, useRef } from 'react';
import { ipcRenderer } from 'electron';
import { NudgeUpdateMessage, NudgeFeedbackType, NudgeTier } from '../shared/types';

// ── Colors by tier ──
const TIER_COLORS: Record<NudgeTier, { accent: string; bg: string; glow: string }> = {
  hint:      { accent: '#7eb8da', bg: 'rgba(25, 35, 50, 0.96)', glow: 'rgba(126, 184, 218, 0.15)' },
  detail:    { accent: '#a78bfa', bg: 'rgba(30, 25, 50, 0.96)', glow: 'rgba(167, 139, 250, 0.15)' },
  deep_dive: { accent: '#f0a05a', bg: 'rgba(45, 30, 20, 0.96)', glow: 'rgba(240, 160, 90, 0.15)' },
};

const TIER_LABELS: Record<NudgeTier, string> = {
  hint: 'Quick Hint',
  detail: 'Suggestion',
  deep_dive: 'Deep Dive',
};

/**
 * NudgeCard — Trust-informed ambient nudge UI.
 *
 * Features:
 * - Friction indicator bar
 * - Tiered content display (hint → detail → deep dive)
 * - 4 feedback actions: Helpful, Tell me more, Not now, Close
 * - Smooth enter/exit animations
 * - Trust-informed styling (warmer accent at higher trust)
 */
export const NudgeCard: React.FC = () => {
  const [text, setText] = useState('');
  const [citations, setCitations] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [nudgeId, setNudgeId] = useState<string | null>(null);
  const [tier, setTier] = useState<NudgeTier>('detail');
  const [frictionScore, setFrictionScore] = useState(0);
  const [trustScore, setTrustScore] = useState(0.5);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const autoHideRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleUpdate = (_event: any, data: NudgeUpdateMessage) => {
      setText(data.text);
      setCitations(data.citations);
      setDone(data.done);
      setNudgeId(data.nudgeId);
      setTier(data.tier);
      setFrictionScore(data.frictionScore);
      setTrustScore(data.trustScore);
      setVisible(true);
      setExiting(false);

      // Reset auto-hide timer
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
      if (data.done) {
        // Auto-hide after 30 seconds if no interaction
        autoHideRef.current = setTimeout(() => {
          handleFeedback('ignored');
        }, 30_000);
      }
    };

    ipcRenderer.on('nudge-update', handleUpdate);
    return () => {
      ipcRenderer.removeListener('nudge-update', handleUpdate);
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
    };
  }, []);

  const handleFeedback = (feedback: NudgeFeedbackType) => {
    if (autoHideRef.current) clearTimeout(autoHideRef.current);

    if (nudgeId) {
      ipcRenderer.send('nudge-feedback', { nudgeId, feedback });
    }

    // Animate out
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
      setText('');
      setCitations([]);
      setDone(false);
    }, 300);
  };

  if (!visible) return null;

  const colors = TIER_COLORS[tier];
  const frictionPct = Math.round(frictionScore * 100);
  const trustPct = Math.round(trustScore * 100);

  return (
    <div style={{
      fontFamily: "'Segoe UI', -apple-system, sans-serif",
      padding: '18px',
      background: colors.bg,
      color: '#e4e4e7',
      borderRadius: '14px',
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), inset 0 0 40px ${colors.glow}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      border: `1px solid ${colors.accent}33`,
      backdropFilter: 'blur(12px)',
      opacity: exiting ? 0 : 1,
      transform: exiting ? 'translateY(20px)' : 'translateY(0)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      ...({ WebkitAppRegion: 'drag' } as any),
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '10px',
        borderBottom: `1px solid ${colors.accent}22`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: colors.accent,
            boxShadow: `0 0 8px ${colors.accent}`,
            animation: done ? 'none' : 'pulse-dot 1.5s ease infinite',
          }} />
          <span style={{
            fontWeight: 600,
            fontSize: '13px',
            color: colors.accent,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}>
            {TIER_LABELS[tier]}
          </span>
        </div>

        <button
          onClick={() => handleFeedback('dismissed')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '2px 6px',
            borderRadius: '4px',
            ...({ WebkitAppRegion: 'no-drag' } as any),
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
          onMouseLeave={e => (e.currentTarget.style.color = '#666')}
        >
          ✕
        </button>
      </div>

      {/* ── Friction bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '10px', color: '#888', minWidth: '50px' }}>
          Friction
        </span>
        <div style={{
          flex: 1,
          height: '3px',
          background: '#333',
          borderRadius: '2px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${frictionPct}%`,
            height: '100%',
            background: `linear-gradient(90deg, #4ade80, #facc15, #ef4444)`,
            borderRadius: '2px',
            transition: 'width 0.5s ease',
          }} />
        </div>
        <span style={{ fontSize: '10px', color: '#888', minWidth: '30px', textAlign: 'right' }}>
          {frictionPct}%
        </span>
      </div>

      {/* ── Content ── */}
      <div style={{
        fontSize: '13px',
        lineHeight: '1.55',
        maxHeight: '180px',
        overflowY: 'auto',
        color: '#d4d4d8',
      }}>
        {text}
        {!done && (
          <span style={{
            display: 'inline-block',
            width: '4px',
            height: '14px',
            background: colors.accent,
            marginLeft: '2px',
            animation: 'cursor-blink 0.8s step-end infinite',
            verticalAlign: 'text-bottom',
          }} />
        )}
      </div>

      {/* ── Citations ── */}
      {citations.length > 0 && done && (
        <div style={{ fontSize: '11px', color: '#71717a' }}>
          <div style={{ marginBottom: '4px', fontWeight: 500 }}>Sources</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {citations.map((c, i) => {
              let hostname = c;
              try { hostname = new URL(c).hostname; } catch {}
              return (
                <a
                  key={i}
                  href={c}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: colors.accent,
                    textDecoration: 'none',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    border: `1px solid ${colors.accent}33`,
                    fontSize: '10px',
                    ...({ WebkitAppRegion: 'no-drag' } as any),
                  }}
                >
                  {hostname}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      {done && (
        <div style={{
          display: 'flex',
          gap: '6px',
          marginTop: '4px',
          ...({ WebkitAppRegion: 'no-drag' } as any),
        }}>
          <NudgeButton
            label="👍 Helpful"
            bg={colors.accent}
            textColor="#000"
            onClick={() => handleFeedback('engaged')}
          />
          <NudgeButton
            label="📖 More"
            bg="#3f3f46"
            textColor="#e4e4e7"
            onClick={() => handleFeedback('expanded')}
          />
          <NudgeButton
            label="Not now"
            bg="transparent"
            textColor="#71717a"
            border="#3f3f46"
            onClick={() => handleFeedback('dismissed')}
          />
        </div>
      )}

      {/* ── CSS Animations ── */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// ── Reusable button ──
const NudgeButton: React.FC<{
  label: string;
  bg: string;
  textColor: string;
  border?: string;
  onClick: () => void;
}> = ({ label, bg, textColor, border, onClick }) => {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        padding: '7px 0',
        background: bg,
        color: textColor,
        border: border ? `1px solid ${border}` : 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 500,
        opacity: hover ? 0.85 : 1,
        transform: hover ? 'scale(0.98)' : 'scale(1)',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
};

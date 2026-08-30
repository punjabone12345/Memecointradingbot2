import { useState, useEffect } from 'react';
import { Settings } from '../lib/types.js';
import { api } from '../lib/api.js';

/** Returns current IST time using Intl.DateTimeFormat (correct across all host timezones). */
function getISTNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
  const h = get('hour') % 24; // normalise hour=24 (midnight) to 0
  const m = get('minute');
  const s = get('second');
  const pad = (n: number) => String(n).padStart(2, '0');
  return { hours: h, minutes: m, label: `${pad(h)}:${pad(m)}:${pad(s)} IST` };
}

function checkInWindow(enabled: boolean, start: string, end: string): boolean {
  if (!enabled) return true;
  const { hours, minutes } = getISTNow();
  const currentMin = hours * 60 + minutes;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + (sm || 0);
  // "00:00" end → end of calendar day (just before midnight)
  const endMin   = (eh === 0 && (em || 0) === 0) ? 1440 : eh * 60 + (em || 0);
  if (startMin < endMin) return currentMin >= startMin && currentMin < endMin;
  return currentMin >= startMin || currentMin < endMin;
}

interface Props { settings: Settings; onUpdate: (s: Settings) => void }

function NumberInput({ label, value, onChange, min, max, step, suffix, sublabel }: {
  label: string; value: number; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string; sublabel?: string;
}) {
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontSize: 11, color: '#3a5070', fontWeight: 700, marginBottom: 4, letterSpacing: '0.04em' }}>{label}</div>
      {sublabel && <div style={{ fontSize: 10, color: '#2a3a50', marginBottom: 6, lineHeight: 1.4 }}>{sublabel}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value)}
          className="input-premium" style={{ flex: 1 }} />
        {suffix && <span style={{ fontSize: 12, color: '#3a5070', fontWeight: 600, flexShrink: 0 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Section({ title, color = '#00d4ff', children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d4e0f0' }}>{title}</span>
      </div>
      <div style={{ padding: '4px 16px 14px' }}>{children}</div>
    </div>
  );
}

export default function SettingsPage({ settings: init, onUpdate }: Props) {
  const [settings, setSettings] = useState(init);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [istClock, setIstClock] = useState(getISTNow().label);

  // Live IST clock
  useEffect(() => {
    const t = setInterval(() => setIstClock(getISTNow().label), 1000);
    return () => clearInterval(t);
  }, []);

  function update(key: keyof Settings, value: string) {
    const strKeys = ['rpcEndpoint', 'walletPublicKey', 'tradingWindowStart', 'tradingWindowEnd'];
    const boolKeys = ['tradingWindowEnabled', 'botEnabled'];
    const updated = { ...settings } as Record<string, unknown>;
    if (strKeys.includes(key)) updated[key] = value;
    else if (boolKeys.includes(key)) updated[key] = value === 'true';
    else updated[key] = parseFloat(value) || 0;
    setSettings((updated as unknown) as Settings);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      onUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  async function handleReset() {
    if (resetInput !== 'RESET') return;
    await api.resetAll();
    setShowReset(false);
    setResetInput('');
    window.location.reload();
  }

  const n = (k: keyof Settings) => settings[k] as number;

  return (
    <div style={{ maxWidth: 520, paddingBottom: 20 }}>

      {/* ── Master Bot On/Off Switch ────────────────────────────────────── */}
      {(() => {
        const on = settings.botEnabled;
        const winEnabled = settings.tradingWindowEnabled;
        const inWindow = checkInWindow(winEnabled, settings.tradingWindowStart, settings.tradingWindowEnd);

        // Effective running state (mirrors session-manager logic)
        const effectivelyRunning = on && (!winEnabled || inWindow);

        let statusLine: string;
        if (!on) {
          statusLine = 'Manually paused — zero Helius or Render credits consumed.';
        } else if (!winEnabled) {
          statusLine = 'Running 24/7 — no trading window restriction.';
        } else if (inWindow) {
          statusLine = `Active inside trading window (${settings.tradingWindowStart}–${settings.tradingWindowEnd} IST). Will auto-pause when window closes.`;
        } else {
          statusLine = `Waiting for trading window (${settings.tradingWindowStart} IST). Will auto-start when window opens.`;
        }

        const accentColor = effectivelyRunning ? '#00ff88' : on ? '#ffaa00' : '#ff4466';
        const borderColor = effectivelyRunning ? 'rgba(0,255,136,0.3)' : on ? 'rgba(255,170,0,0.3)' : 'rgba(255,68,102,0.3)';
        const bgColor     = effectivelyRunning ? 'rgba(0,255,136,0.04)' : on ? 'rgba(255,170,0,0.04)' : 'rgba(255,68,102,0.04)';
        const statusEmoji = effectivelyRunning ? '🟢' : on ? '🟡' : '🔴';
        const statusLabel = effectivelyRunning ? 'RUNNING' : on ? 'SCHEDULED' : 'PAUSED';

        return (
          <div className="card" style={{ marginBottom: 14, overflow: 'hidden', border: `1px solid ${borderColor}`, background: bgColor }}>
            <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 15 }}>{statusEmoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: accentColor, letterSpacing: '0.04em' }}>
                    Bot {statusLabel}
                  </span>
                  <span style={{ fontSize: 10, color: '#3a5070', marginLeft: 2 }}>· {istClock}</span>
                </div>
                <div style={{ fontSize: 11, color: '#4a6080', lineHeight: 1.6 }}>{statusLine}</div>
              </div>
              <button
                onClick={async () => {
                  const next = !on;
                  update('botEnabled', String(next));
                  try {
                    const updated = await api.updateSettings({ ...settings, botEnabled: next });
                    onUpdate(updated);
                  } catch { /* non-fatal */ }
                }}
                style={{
                  flexShrink: 0,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: `1px solid ${on ? 'rgba(255,68,102,0.4)' : 'rgba(0,255,136,0.4)'}`,
                  background: on ? 'rgba(255,68,102,0.15)' : 'rgba(0,255,136,0.15)',
                  color: on ? '#ff4466' : '#00ff88',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  letterSpacing: '0.06em',
                }}
              >
                {on ? 'PAUSE BOT' : 'START BOT'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Trading Mode Toggle ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: '#00ff88' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d4e0f0' }}>Trading Mode</span>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Sniper Engine — always on */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00bfff' }}>🎯 Smart Wallet Consensus</div>
              <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>Follows pump.fun graduations · triggers on 10s volume ≥$750</div>
            </div>
            <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(0,191,255,0.15)', border: '1px solid rgba(0,191,255,0.3)', fontSize: 11, fontWeight: 800, color: '#00bfff', letterSpacing: '0.04em' }}>
              ALWAYS ON
            </div>
          </div>

        </div>
      </div>

      {/* ── Trading Window ──────────────────────────────────────────────── */}
      {(() => {
        const enabled = settings.tradingWindowEnabled;
        const inWindow = checkInWindow(enabled, settings.tradingWindowStart, settings.tradingWindowEnd);
        const statusColor = !enabled ? '#7090b0' : inWindow ? '#00ff88' : '#ff4466';
        const statusLabel = !enabled ? 'UNRESTRICTED' : inWindow ? 'ACTIVE — TRADING' : 'PAUSED';
        return (
          <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 3, height: 14, borderRadius: 2, background: '#ffaa00' }} />
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d4e0f0' }}>Trading Window (IST)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#3a5070' }}>{istClock}</span>
                <div style={{ padding: '3px 8px', borderRadius: 6, background: `${statusColor}22`, border: `1px solid ${statusColor}55`, fontSize: 10, fontWeight: 800, color: statusColor, letterSpacing: '0.06em' }}>
                  {statusLabel}
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Enable toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#d4e0f0' }}>Enable trading window</div>
                  <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>Restrict entries to a set IST time range. Open positions continue to be tracked 24/7.</div>
                </div>
                <button
                  onClick={() => update('tradingWindowEnabled', String(!settings.tradingWindowEnabled))}
                  style={{
                    flexShrink: 0, width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: enabled ? '#00ff88' : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.2s', position: 'relative',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 3, left: enabled ? 23 : 3, width: 18, height: 18,
                    borderRadius: '50%', background: enabled ? '#001a0a' : '#3a5070', transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* Time inputs */}
              {enabled && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#3a5070', fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em' }}>Start Time (IST)</div>
                    <input
                      type="time"
                      value={settings.tradingWindowStart}
                      onChange={e => update('tradingWindowStart', e.target.value)}
                      className="input-premium"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#3a5070', fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em' }}>End Time (IST)</div>
                    <input
                      type="time"
                      value={settings.tradingWindowEnd}
                      onChange={e => update('tradingWindowEnd', e.target.value)}
                      className="input-premium"
                      style={{ width: '100%' }}
                    />
                    <div style={{ fontSize: 10, color: '#2a3a50', marginTop: 4 }}>00:00 = midnight (end of day)</div>
                  </div>
                </div>
              )}

              {enabled && (
                <div style={{ padding: '10px 12px', borderRadius: 10, background: inWindow ? 'rgba(0,255,136,0.05)' : 'rgba(255,68,102,0.05)', border: `1px solid ${inWindow ? 'rgba(0,255,136,0.15)' : 'rgba(255,68,102,0.15)'}` }}>
                  <div style={{ fontSize: 11, color: inWindow ? '#00ff88' : '#ff4466', fontWeight: 700, marginBottom: 2 }}>
                    {inWindow ? '✅ Bot is active — new entries allowed' : '⏸ Bot is paused — no new entries until window opens'}
                  </div>
                  <div style={{ fontSize: 11, color: '#3a5070' }}>
                    Window: {settings.tradingWindowStart} → {settings.tradingWindowEnd === '00:00' ? '00:00 (midnight)' : settings.tradingWindowEnd} IST
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 20 EMA Strategy Overview Banner */}
      <div className="card" style={{ marginBottom: 14, padding: '16px', background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(0,212,255,0.08))', border: '1px solid rgba(168,85,247,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 16 }}>📈</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#a855f7', letterSpacing: '0.04em' }}>
            20 EMA Retrace Strategy Overview
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#d4e0f0', lineHeight: 1.6 }}>
          • <b>Tracking</b>: Tracks every Pump.fun migration for <b>120 minutes</b> before expiring.<br/>
          • <b>Safety Checks</b>: Auto Rugcheck (retry after <b>5m</b> if failed) + Instant Fake Setup Spike filter (&gt;$200k mcap in 5s).<br/>
          • <b>20 EMA &amp; +50% Pump</b>: Calculates 20 EMA on 1-min candles after 20m. Price must first pump <b>+50%</b> above EMA start price.<br/>
          • <b>Entry &amp; SL</b>: Buys <b>0.10 SOL</b> immediately when price retraces to 20 EMA. Stop Loss is set to the <b>recent 20-min low</b>.<br/>
          • <b>Exits</b>: <b>TP1 +100%</b> (30% exit, breakeven SL), <b>TP2 +250%</b> (40% exit, -30% trailing SL), <b>TP3 +400%</b> (30% exit).
        </div>
      </div>

      {/* 20 EMA Strategy Parameters */}
      <Section title="20 EMA Strategy Parameters" color="#a855f7">
        <NumberInput
          label="Position Size (SOL)"
          value={n('positionSizeSol') || 0.10}
          onChange={(v) => update('positionSizeSol', v)}
          min={0.01} max={10} step={0.01} suffix="SOL"
          sublabel="SOL amount bought on 20 EMA retrace buy trigger (Default: 0.10 SOL)"
        />
        <NumberInput
          label="Required Pump Target (%)"
          value={n('pumpTargetPct') || 50}
          onChange={(v) => update('pumpTargetPct', v)}
          min={10} max={500} step={5} suffix="%"
          sublabel="Price/MCAP must increase by at least this % above 20 EMA start point before retrace buy unlocks (Default: 50%)"
        />
        <NumberInput
          label="EMA Period (Minutes / Candles)"
          value={n('emaPeriodMinutes') || 20}
          onChange={(v) => update('emaPeriodMinutes', v)}
          min={5} max={60} step={1} suffix="MIN"
          sublabel="Number of 1-minute candles required to plot EMA (Default: 20 minutes)"
        />
        <NumberInput
          label="Max Tracking Window (Minutes)"
          value={n('maxTrackingDurationMin') || 120}
          onChange={(v) => update('maxTrackingDurationMin', v)}
          min={15} max={1440} step={15} suffix="MIN"
          sublabel="Maximum duration a token is tracked after migration before expiring (Default: 120m / 2 hours)"
        />
        <NumberInput
          label="Rugcheck Retry Delay (Minutes)"
          value={n('rugcheckRetryDelayMin') || 5}
          onChange={(v) => update('rugcheckRetryDelayMin', v)}
          min={1} max={30} step={1} suffix="MIN"
          sublabel="Wait delay before retrying a failed initial Rugcheck (Default: 5 minutes)"
        />
        <NumberInput
          label="Fake Setup Spike Cap ($ USD)"
          value={n('fakeSetupSpikeCapUsd') || 200000}
          onChange={(v) => update('fakeSetupSpikeCapUsd', v)}
          min={50000} max={2000000} step={10000} suffix="USD"
          sublabel="Tokens spiking above this MCAP within 5s of migration are rejected as fake bot setups (Default: $200,000)"
        />
      </Section>

      <Section title="Position Sizing & Portfolio" color="#00ff88">
        <NumberInput
          label="Starting Balance (SOL)"
          value={n('startingBalanceSol')}
          onChange={(v) => update('startingBalanceSol', v)}
          min={0.1} step={1} suffix="SOL"
          sublabel="The starting capital for paper portfolio value"
        />
        <NumberInput
          label="Current Balance (SOL)"
          value={n('currentBalanceSol')}
          onChange={(v) => update('currentBalanceSol', v)}
          min={0} step={0.1} suffix="SOL"
          sublabel="Updates automatically when positions open/close"
        />
      </Section>

      {/* Target (TP) and Trailing SL Settings */}
      <Section title="3-Phase Target (TP) & Trailing SL" color="#ff9900">
        <div style={{ fontSize: 11, color: '#3a5070', marginBottom: 14, lineHeight: 1.6 }}>
          Target exits position in 3 phases. TP1 moves SL to breakeven; TP2 activates a trailing SL from peak.
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr', gap: 6, marginBottom: 6 }}>
          {['Target Phase', 'Gain %', 'Exit %', 'SL Behavior'].map(h => (
            <div key={h} style={{ fontSize: 10, color: '#2a3a50', fontWeight: 700, letterSpacing: '0.05em' }}>{h}</div>
          ))}
        </div>

        {/* TP1 row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#00d4ff', fontWeight: 700 }}>TP1 (+100%)</div>
          <input type="number" value={n('tp1Pct') || 100} min={10} max={500} step={5}
            onChange={e => update('tp1Pct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <input type="number" value={n('tp1ExitPct') || 30} min={5} max={100} step={5}
            onChange={e => update('tp1ExitPct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <div style={{ fontSize: 10, color: '#00ff88', fontWeight: 700 }}>Breakeven SL</div>
        </div>

        {/* TP2 row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#9b59ff', fontWeight: 700 }}>TP2 (+250%)</div>
          <input type="number" value={n('tp2Pct') || 250} min={20} max={1000} step={10}
            onChange={e => update('tp2Pct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <input type="number" value={n('tp2ExitPct') || 40} min={5} max={100} step={5}
            onChange={e => update('tp2ExitPct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <div style={{ fontSize: 10, color: '#9b59ff', fontWeight: 700 }}>Trail -30% Peak</div>
        </div>

        {/* TP3 row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#ff9900', fontWeight: 700 }}>TP3 (+400%)</div>
          <input type="number" value={n('tp3Pct') || 400} min={50} max={2000} step={25}
            onChange={e => update('tp3Pct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <input type="number" value={n('tp3ExitPct') || 30} min={5} max={100} step={5}
            onChange={e => update('tp3ExitPct', e.target.value)}
            className="input-premium" style={{ padding: '6px 8px', fontSize: 12 }} />
          <div style={{ fontSize: 10, color: '#ff9900', fontWeight: 700 }}>Close Position</div>
        </div>

        <NumberInput
          label="Trailing Stop Loss (%)"
          value={n('trailingSLPct') || 30}
          onChange={(v) => update('trailingSLPct', v)}
          min={5} max={50} step={1} suffix="%"
          sublabel="Distance from peak price to trigger trailing SL exit after TP2 (Default: 30%)"
        />
      </Section>

      <Section title="Stagnation Exit" color="#ff6600">
        <NumberInput
          label="Max Flat Move in 1h"
          value={n('sniperStagnationPct')}
          onChange={(v) => update('sniperStagnationPct', v)}
          min={1} max={30} step={1} suffix="%"
          sublabel="Close a sniper position if the absolute 1h price change is below this % and the position has been open for at least 1 hour. Keeps capital moving; no time-based exit otherwise."
        />
      </Section>

      <Section title="Entry Slippage" color="#ffaa00">
        <NumberInput
          label="Max Slippage vs Detected Price"
          value={n('sniperSlippagePct')}
          onChange={(v) => update('sniperSlippagePct', v)}
          min={1} max={100} step={1} suffix="%"
          sublabel="Skip a trade if the current price has pumped more than this % above the detected buyer price. Default: 20%. Telegram alert is sent on every skip."
        />
      </Section>

      {/* Save */}
      <button onClick={save} disabled={saving} className="btn-solid-cyan"
        style={{ width: '100%', padding: '16px', fontSize: 15, marginBottom: 16, opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Saving…' : saved ? '✅ Saved!' : 'Save Settings'}
      </button>

      {/* Danger zone */}
      <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,68,102,0.05)', border: '1px solid rgba(255,68,102,0.18)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#ff4466', letterSpacing: '0.08em', marginBottom: 6 }}>⚠️ DANGER ZONE</div>
        <p style={{ fontSize: 12, color: '#3a5070', marginBottom: 12, lineHeight: 1.5 }}>
          Closes all open positions and resets balance back to starting balance. All trade history is cleared.
        </p>
        {!showReset ? (
          <button onClick={() => setShowReset(true)} className="btn-red" style={{ padding: '10px 20px', fontSize: 13 }}>
            Reset All Data
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#ff4466', fontWeight: 700 }}>Type RESET to confirm:</div>
            <input
              type="text" value={resetInput} onChange={(e) => setResetInput(e.target.value)} placeholder="RESET"
              className="input-premium" style={{ borderColor: 'rgba(255,68,102,0.3)' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setShowReset(false); setResetInput(''); }}
                style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#7090b0', cursor: 'pointer', fontWeight: 700 }}
              >Cancel</button>
              <button
                onClick={handleReset} disabled={resetInput !== 'RESET'} className="btn-solid-red"
                style={{ flex: 1, padding: '10px', fontSize: 13, opacity: resetInput === 'RESET' ? 1 : 0.4 }}
              >Confirm Reset</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

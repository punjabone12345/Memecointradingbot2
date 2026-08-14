import { useState, useEffect } from 'react';
import { SniperStatus, TrackedToken, BuyerActivityLog, PendingSignal, DiagTransaction } from '../lib/types.js';
import { api } from '../lib/api.js';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  sniperStatus?: SniperStatus | null;
  wsConnected?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function countdown(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function countdownPct(migrationTime: number, expiresAt: number): number {
  const total   = expiresAt - migrationTime;
  const elapsed = Date.now() - migrationTime;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function fmtCompact(n?: number): string {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n.toFixed(2)}`;
}

function fmtPrice(p?: number): string {
  if (!p) return '—';
  if (p < 0.000001) return `${p.toExponential(2)}`;
  if (p < 0.01) return `${p.toFixed(6)}`;
  if (p < 1) return `${p.toFixed(4)}`;
  return `${p.toFixed(2)}`;
}

// ── Sniper status hook ────────────────────────────────────────────────────────

function useSniperStatusFallback(skip: boolean) {
  const [status, setStatus] = useState<SniperStatus | null>(null);
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.getSniperStatus();
        if (!cancelled) setStatus(data);
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [skip]);
  return status;
}

// ── Discovery data types ──────────────────────────────────────────────────────

interface MigrationEvent {
  mint:             string;
  ts:               number;
  name?:            string;
  symbol?:          string;
  isMigration:      boolean;
  reserveUsd?:      number;
  discoverySource?: string;
  txSignature?:     string;
  instructionType?: string;
}

interface PumpfunTrackerData {
  total:               number;
  recent:              MigrationEvent[];
  walletAddress?:      string;
  pollCount?:          number;
  lastPollAgoSec?:     number | null;
  consecutiveFailures?: number;
  lastError?:          string | null;
  heliusApiKeySet?:    boolean;
  rpcEndpoint?:        string;
  tokensPerHour?:      number | null;
  txFetchErrorRate?:   number;
}

interface SourcesResponse {
  pumpfun?: PumpfunTrackerData;
  // legacy fallback
  gmgn?: {
    total: number;
    recent: MigrationEvent[];
    pollers?: { migrated?: { pollCount: number; lastSuccessAgoSec: number | null; consecutiveFailures: number; firedTotal?: number; intervalMs: number; lastError: string | null } };
  };
}

function useTrackerData(): { data: PumpfunTrackerData | null; loading: boolean } {
  const [data, setData] = useState<PumpfunTrackerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const json = (await api.getScannerSources()) as unknown as SourcesResponse;
        if (!cancelled) {
          // Prefer new pumpfun shape; fall back to legacy gmgn
          const pf = json.pumpfun;
          const gm = json.gmgn;
          setData(pf ?? {
            total:    gm?.total ?? 0,
            recent:   gm?.recent ?? [],
            pollCount: gm?.pollers?.migrated?.pollCount,
            lastPollAgoSec: gm?.pollers?.migrated?.lastSuccessAgoSec,
            consecutiveFailures: gm?.pollers?.migrated?.consecutiveFailures,
          } as PumpfunTrackerData);
          setLoading(false);
        }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 2_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { data, loading };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  card:   { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 } as React.CSSProperties,
  label:  { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#3a5070' } as React.CSSProperties,
  accent: '#00bfff',
  green:  '#00ff88',
  red:    '#ff4466',
  yellow: '#ffd700',
  orange: '#ff8c00',
  gray:   '#4a6080',
  pump:   '#a855f7',  // purple brand colour for pump.fun migrations
};

function dexUrl(mint: string): string {
  return `https://dexscreener.com/solana/${mint}`;
}

function DexLink({ mint }: { mint: string }) {
  return (
    <a
      href={dexUrl(mint)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 8, fontWeight: 800, letterSpacing: '0.05em',
        padding: '2px 6px', borderRadius: 4,
        background: 'rgba(255,196,0,0.08)', color: '#ffc400',
        border: '1px solid rgba(255,196,0,0.25)',
        textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
      }}
    >
      ↗ DEX
    </a>
  );
}

function PumpLink({ mint }: { mint: string }) {
  return (
    <a
      href={`https://pump.fun/${mint}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 8, fontWeight: 800, letterSpacing: '0.05em',
        padding: '2px 6px', borderRadius: 4,
        background: 'rgba(168,85,247,0.10)', color: C.pump,
        border: '1px solid rgba(168,85,247,0.25)',
        textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
      }}
    >
      🚀 PUMP
    </a>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 54 }}>
      <span style={{ fontSize: 18, fontWeight: 900, color: color ?? C.accent, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', color: C.gray, textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

function PctBadge({ value, label }: { value?: number; label: string }) {
  if (value == null) return null;
  const pos = value >= 0;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: pos ? C.green : C.red }}>
        {pos ? '+' : ''}{value.toFixed(1)}%
      </div>
      <div style={{ fontSize: 8, color: C.gray }}>{label}</div>
    </div>
  );
}

// ── TrackedCard ───────────────────────────────────────────────────────────────

function countdownSustain(sustainStartedAt?: number | null, sustainDurationSec = 600): { text: string; pct: number } {
  if (!sustainStartedAt) return { text: '0:00 / 10:00', pct: 0 };
  const elapsedSec = Math.floor((Date.now() - sustainStartedAt) / 1000);
  const curMin = Math.floor(elapsedSec / 60);
  const curSec = elapsedSec % 60;
  const targetMin = Math.floor(sustainDurationSec / 60);
  const text = `${curMin}:${String(curSec).padStart(2, '0')} / ${targetMin}:00`;
  const pct = Math.min(100, (elapsedSec / sustainDurationSec) * 100);
  return { text, pct };
}

function TrackedCard({ tok, tick }: { tok: TrackedToken; tick: number }) {
  void tick;
  const firstSeen   = tok.firstDiscoveredAt || tok.migrationTime || Date.now();
  const expiresAt   = tok.expiresAt || (firstSeen + 2 * 3600 * 1000);
  const pctTracking = countdownPct(firstSeen, expiresAt);
  const remaining   = countdown(expiresAt);
  const expired     = expiresAt <= Date.now();
  const hasMarket   = (tok.price ?? 0) > 0;

  const currentMc   = tok.mcap ?? 0;
  const currentLiq  = tok.liquidity ?? 0;
  const mcOk        = currentMc >= 30000;
  const liqOk       = currentLiq >= 15000;
  const bothMet     = mcOk && liqOk;

  const status      = tok.status ?? (tok.entryTriggered ? 'TRADED' : bothMet ? 'SUSTAINING' : 'WAITING_FOR_THRESHOLDS');
  const sustain     = countdownSustain(tok.sustainStartedAt);

  const statusColor = status === 'TRADED' || status === 'TRADE_ELIGIBLE' || status === 'SUSTAIN_COMPLETED' ? C.green
    : status === 'SUSTAINING' ? C.yellow
    : status === 'SUSTAIN_RESET' ? C.orange
    : status === 'REJECTED' ? C.red
    : status === 'EXPIRED' ? C.gray
    : C.accent;

  return (
    <div style={{
      ...C.card, marginBottom: 10,
      borderColor: status === 'TRADED' || status === 'TRADE_ELIGIBLE' ? 'rgba(0,255,136,0.3)' : status === 'SUSTAINING' ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.07)',
    }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#e0e8ff' }}>{tok.symbol}</span>
            <span style={{ fontSize: 9, color: C.gray }}>{tok.name}</span>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}44` }}>
              {status}
            </span>
            {tok.rugcheckPassed != null && (
              <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: tok.rugcheckPassed ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,102,0.1)', color: tok.rugcheckPassed ? C.green : C.red, border: `1px solid ${tok.rugcheckPassed ? 'rgba(0,255,136,0.25)' : 'rgba(255,68,102,0.25)'}` }}>
                RugCheck: {tok.rugcheckPassed ? 'PASSED ✅' : 'FAILED ❌'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 9, color: C.gray, fontFamily: 'monospace' }}>{shortAddr(tok.mint)}</span>
            <DexLink mint={tok.mint} />
            <PumpLink mint={tok.mint} />
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: expired ? C.red : pctTracking > 80 ? C.yellow : '#00d4ff' }}>
            {remaining}
          </div>
          <div style={{ fontSize: 8, color: C.gray }}>2h window remaining</div>
        </div>
      </div>

      {/* Threshold Status Bar */}
      <div style={{ margin: '10px 0 8px', padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
            <span style={{ fontWeight: 800, color: mcOk ? C.green : C.red }}>
              {mcOk ? '✓' : '✗'} MC: ${fmtCompact(currentMc)} <span style={{ color: C.gray, fontWeight: 400 }}>(min $30K)</span>
            </span>
            <span style={{ fontWeight: 800, color: liqOk ? C.green : C.red }}>
              {liqOk ? '✓' : '✗'} Liq: ${fmtCompact(currentLiq)} <span style={{ color: C.gray, fontWeight: 400 }}>(min $15K)</span>
            </span>
          </div>
          {tok.sustainAttempts ? (
            <span style={{ fontSize: 8, color: C.gray }}>Attempts: {tok.sustainAttempts}×</span>
          ) : null}
        </div>

        {/* Sustain Progress Bar */}
        {status === 'SUSTAINING' || tok.sustainStartedAt ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 3 }}>
              <span style={{ color: C.yellow, fontWeight: 800 }}>⏱ 10-Minute Sustain Timer Running</span>
              <span style={{ color: '#e0e8ff', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{sustain.text}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${sustain.pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #ffd700, #00ff88)', transition: 'width 1s linear' }} />
            </div>
          </div>
        ) : status === 'SUSTAIN_RESET' ? (
          <div style={{ fontSize: 9, color: C.orange, fontStyle: 'italic' }}>
            🔄 Sustain timer reset: {tok.lastResetReason ?? 'Threshold dropped below minimum'}
          </div>
        ) : status === 'TRADE_ELIGIBLE' || status === 'SUSTAIN_COMPLETED' ? (
          <div style={{ fontSize: 9, color: C.green, fontWeight: 800 }}>
            ✅ Sustained $30K MC + $15K Liq for 10 continuous mins — Trade Eligible!
          </div>
        ) : status === 'REJECTED' ? (
          <div style={{ fontSize: 9, color: C.red }}>
            ❌ Rejected by safety filters — tracking stopped.
          </div>
        ) : status === 'EXPIRED' ? (
          <div style={{ fontSize: 9, color: C.gray }}>
            ⏰ 2-hour tracking window exceeded without trade eligibility.
          </div>
        ) : (
          <div style={{ fontSize: 9, color: C.gray }}>
            ⏳ Waiting for both $30K MC and $15K Liquidity to be reached simultaneously…
          </div>
        )}
      </div>

      {/* Market metrics */}
      {hasMarket && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#e0e8ff' }}>{fmtPrice(tok.price)}</div>
            <div style={{ fontSize: 8, color: C.gray }}>price</div>
          </div>
          <PctBadge value={tok.priceChange5m} label="5m chg" />
          <PctBadge value={tok.priceChange1h} label="1h chg" />
          <PctBadge value={tok.priceChange24h} label="24h chg" />
        </div>
      )}
    </div>
  );
}

// ── Migration event row ───────────────────────────────────────────────────────

function MigrationRow({ ev, last }: { ev: MigrationEvent; last: boolean }) {
  const instrLabel = ev.instructionType ?? 'migrate';
  const instrColor = instrLabel === 'pool_create' || instrLabel === 'create_pool'
    ? C.orange
    : instrLabel.includes('v2')
    ? C.pump
    : '#a0b8d8';

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'rgba(168,85,247,0.12)', color: instrColor, border: `1px solid ${instrColor}44` }}>
            {instrLabel.toUpperCase()}
          </span>
          {ev.symbol && <span style={{ fontSize: 10, fontWeight: 800, color: '#e0e8ff' }}>{ev.symbol}</span>}
          {ev.name && <span style={{ fontSize: 8, color: C.gray }}>{ev.name.slice(0, 16)}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 8, color: '#3a5070', fontFamily: 'monospace' }}>
            {ev.mint.slice(0, 8)}…{ev.mint.slice(-5)}
          </span>
          <DexLink mint={ev.mint} />
          <PumpLink mint={ev.mint} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0, marginLeft: 10 }}>
        {ev.reserveUsd != null && ev.reserveUsd > 0 && (
          <span style={{ fontSize: 8, color: C.green, fontWeight: 700 }}>
            ${ev.reserveUsd >= 1000 ? (ev.reserveUsd / 1000).toFixed(1) + 'k' : ev.reserveUsd.toFixed(0)} liq
          </span>
        )}
        <span style={{ fontSize: 8, color: C.gray }}>{timeAgo(ev.ts)}</span>
      </div>
    </div>
  );
}

// ── Migration Tracker panel ───────────────────────────────────────────────────

function MigrationFeed() {
  const { data, loading } = useTrackerData();

  const total              = data?.total ?? 0;
  const events             = data?.recent ?? [];
  const pollCount          = data?.pollCount ?? 0;
  const lastAgoSec         = data?.lastPollAgoSec;
  const failures           = data?.consecutiveFailures ?? 0;
  const lastError          = data?.lastError ?? null;
  const heliusSet          = data?.heliusApiKeySet ?? false;
  const rpc                = data?.rpcEndpoint ?? 'unknown';
  const tokensPerHour      = data?.tokensPerHour;
  const txErrRate          = data?.txFetchErrorRate ?? 0;
  const walletAddr         = data?.walletAddress ?? '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

  const isLive  = failures === 0 && pollCount > 0;
  const dotColor = loading ? C.gray : failures > 3 ? C.red : failures > 0 ? C.yellow : isLive ? C.green : C.gray;
  const statusLabel = loading ? 'INIT' : failures > 3 ? 'ERROR' : failures > 0 ? 'WARN' : isLive ? 'LIVE' : 'STARTING';

  return (
    <div>
      {/* ── Section header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#5a4080' }}>
          🚀 PUMP.FUN MIGRATION TRACKER
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: dotColor, fontWeight: 700 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
          {statusLabel}
        </span>
        <span style={{ fontSize: 9, color: C.gray, marginLeft: 'auto' }}>
          {total} total
        </span>
      </div>

      {/* ── Tracker info card ── */}
      <div style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 8, color: C.gray, marginBottom: 2 }}>MIGRATION WALLET</div>
            <a
              href={`https://solscan.io/account/${walletAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 9, fontFamily: 'monospace', color: C.pump, textDecoration: 'none' }}
            >
              {walletAddr.slice(0, 8)}…{walletAddr.slice(-6)}
            </a>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', alignSelf: 'stretch' }} />
          <div>
            <div style={{ fontSize: 8, color: C.gray, marginBottom: 2 }}>RPC</div>
            <span style={{ fontSize: 9, color: heliusSet ? C.green : C.yellow, fontWeight: 700 }}>
              {heliusSet ? '⚡ HELIUS' : '🌐 PUBLIC'}
            </span>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', alignSelf: 'stretch' }} />
          <div>
            <div style={{ fontSize: 8, color: C.gray, marginBottom: 2 }}>POLLS</div>
            <span style={{ fontSize: 9, color: '#e0e8ff', fontVariantNumeric: 'tabular-nums' }}>{pollCount}</span>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', alignSelf: 'stretch' }} />
          <div>
            <div style={{ fontSize: 8, color: C.gray, marginBottom: 2 }}>LAST POLL</div>
            <span style={{ fontSize: 9, color: lastAgoSec == null ? C.gray : lastAgoSec < 5 ? C.green : lastAgoSec < 15 ? C.yellow : C.red, fontVariantNumeric: 'tabular-nums' }}>
              {lastAgoSec == null ? 'never' : `${lastAgoSec}s ago`}
            </span>
          </div>
        </div>

        {failures > 0 && lastError && (
          <div style={{ marginTop: 8, fontSize: 9, color: failures > 3 ? C.red : C.yellow, padding: '5px 8px', borderRadius: 6, background: failures > 3 ? 'rgba(255,68,68,0.07)' : 'rgba(255,200,0,0.07)', border: `1px solid ${failures > 3 ? 'rgba(255,68,68,0.2)' : 'rgba(255,200,0,0.2)'}` }}>
            {failures > 3 ? '⛔' : '⚠'} {lastError} ({failures} consecutive failures)
          </div>
        )}
      </div>

      {/* ── Migration event list ── */}
      <div style={{ background: 'rgba(168,85,247,0.03)', border: '1px solid rgba(168,85,247,0.12)', borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', color: C.pump }}>
            GRADUATED TOKENS ({total})
          </span>
          <span style={{ fontSize: 8, color: C.gray }}>polling every 1s</span>
        </div>

        {events.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: C.gray, fontSize: 11 }}>
            {loading
              ? 'Initialising tracker…'
              : pollCount === 0
              ? 'Waiting for first poll…'
              : 'No migrations detected yet — watching wallet'}
          </div>
        ) : (
          events.slice(0, 15).map((ev, i) => (
            <MigrationRow key={ev.mint + i} ev={ev} last={i === Math.min(events.length, 15) - 1} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DiscoverPage({ sniperStatus: wsProp, wsConnected = false }: Props) {
  const polled = useSniperStatusFallback(wsConnected);
  const status = wsConnected ? (wsProp ?? polled) : (polled ?? wsProp);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const now      = Date.now();
  const tracked  = (status?.trackedTokens ?? []).filter(t => (t.expiresAt ?? 0) > now || t.entryTriggered || t.sustainStartedAt);
  const stats    = status?.stats as any ?? {};

  return (
    <div>
      {/* ── Strategy Header ── */}
      <div style={{ ...C.card, marginBottom: 16, background: 'linear-gradient(135deg,rgba(0,191,255,0.06),rgba(123,94,167,0.06))', borderColor: 'rgba(0,191,255,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.accent, letterSpacing: '0.04em' }}>🚀 MIGRATED TOKEN STRATEGY</div>
            <div style={{ fontSize: 9, color: C.gray, marginTop: 2 }}>Pump.fun Migrations · $30K MC + $15K Liquidity · 10-Min Sustain Gate</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 9, color: C.gray }}>
            SOL<br />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#e0e8ff' }}>${status?.solPriceUsd?.toFixed(0) ?? '—'}</span>
          </div>
        </div>

        {/* Primary Strategy Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 4 }}>
          <StatPill label="Discovered"  value={stats.discovered ?? stats.pending ?? 0} color={C.accent} />
          <StatPill label="Tracking"    value={stats.tracking ?? tracked.length} />
          <StatPill label="Sustaining"  value={stats.sustaining ?? 0}                  color={C.yellow} />
          <StatPill label="Eligible"    value={stats.tradeEligible ?? 0}               color={C.green} />
          <StatPill label="Traded"      value={stats.tradesExecuted ?? 0}              color="#00ff88" />
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { label: 'Pump.fun Migrations',    color: 'rgba(168,85,247,0.18)' },
            { label: 'RugCheck Filter',        color: 'rgba(0,255,136,0.15)' },
            { label: 'MC ≥ $30,000',           color: 'rgba(0,191,255,0.18)' },
            { label: 'Liq ≥ $15,000',          color: 'rgba(0,191,255,0.18)' },
            { label: '10-Min Continuous Gate', color: 'rgba(255,215,0,0.18)' },
            { label: '2-Hour Window Cap',      color: 'rgba(255,255,255,0.08)' },
          ].map(({ label, color }) => (
            <span key={label} style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: color, color: '#c0c8e0', border: '1px solid rgba(255,255,255,0.08)' }}>{label}</span>
          ))}
        </div>
      </div>

      {/* ── Tracked Tokens ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...C.label, marginBottom: 8 }}>
          TRACKED TOKENS — 1HR WATCH WINDOW {tracked.length > 0 && `(${tracked.length})`}
        </div>
        {tracked.length === 0 ? (
          <div style={{ ...C.card, color: C.gray, fontSize: 11, textAlign: 'center', padding: '24px 16px' }}>
            Watching for qualified wallet consensus…<br />
            <span style={{ fontSize: 9, color: '#2a3a50', marginTop: 6, display: 'block' }}>
              Each graduated token tracked 1 hour for buyer wallet scoring
            </span>
          </div>
        ) : (
          tracked
            .slice()
            .sort((a, b) => b.buyerActivity.length - a.buyerActivity.length || b.migrationTime - a.migrationTime)
            .map(tok => <TrackedCard key={tok.mint} tok={tok} tick={tick} />)
        )}
      </div>

      {/* ── Migration tracker feed ── */}
      <MigrationFeed />
    </div>
  );
}

/**
 * Token Discovery Service — Pump.fun Migration Wallet Tracker
 *
 * Single source of truth: poll getSignaturesForAddress on the official
 * Pump.fun liquidity/migration wallet every 1 second.
 *
 * Wallet: 39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg
 *
 * For each new signature:
 *   1. Fetch the full transaction.
 *   2. Validate it is a migrate / migrate_v2 / pool_create (not AMM buy/sell).
 *   3. Extract the graduated token mint from postTokenBalances.
 *   4. Fire the onGraduation callback and persist to DB.
 *
 * No GMGN, no 1h ranking, no DexScreener polling.
 */

import { logger } from '../lib/logger.js';
import { query } from '../lib/db.js';
import { withHeliusLimit, isRateLimitedError, isHeliusCoolingDown } from '../lib/helius-limiter.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MIGRATION_WALLET = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
const WSOL_MINT              = 'So11111111111111111111111111111111111111112';
const POLL_INTERVAL_MS       = 1_000;   // poll every 1 second
const PAGE_SIZE              = 20;      // sigs per pagination page
const MAX_CATCHUP_PAGES      = 10;      // safety ceiling: max 200 sigs fetched per poll cycle
const MAX_FEED               = 50;
const SUPPRESSION_MS         = 60 * 60_000;  // 1 hour — don't re-fire same mint

/** Infrastructure mints to never fire */
const IGNORE_MINTS = new Set([
  WSOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',  // wETH
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',  // BONK
]);

/**
 * Log patterns that STRICTLY identify a pump.fun migration instruction.
 * A TX must match at least one of these — no other evidence is accepted.
 * The migration wallet appearing in accountKeys alone is NOT sufficient.
 */
const MIGRATE_PATTERNS: RegExp[] = [
  /instruction:\s*migrate$/i,
  /instruction:\s*migratev2$/i,
  /instruction:\s*migrate_v2$/i,
  /instruction:\s*pool_create$/i,
  /instruction:\s*create_pool$/i,
];

// ── RPC helpers ───────────────────────────────────────────────────────────────

const RPC_ENDPOINTS = [
  process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null,
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean) as string[];

async function rpcPost(url: string, method: string, params: unknown[]): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = (await resp.json()) as { result?: any; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

type SigInfo = { signature: string; slot: number; err: any };

/** Single-page getSignaturesForAddress — raw RPC call with multi-RPC pool fallback */
async function fetchSigPage(
  wallet: string,
  opts: { limit: number; until?: string; before?: string },
): Promise<SigInfo[] | null> {
  const config: Record<string, any> = { limit: opts.limit, commitment: 'confirmed' };
  if (opts.until)  config.until  = opts.until;
  if (opts.before) config.before = opts.before;

  // Try Helius first if available, then fallback to public RPC pool
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const isHelius = endpoint.includes('helius');
      if (isHelius && isHeliusCoolingDown()) continue;
      const call = () => rpcPost(endpoint, 'getSignaturesForAddress', [wallet, config]);
      const result = isHelius ? await withHeliusLimit(call, { priority: false }) : await call();
      if (Array.isArray(result)) return result;
    } catch {
      // Try next endpoint in pool
      continue;
    }
  }
  return null;
}

/**
 * Collect ALL signatures for `wallet` that are newer than `sinceExclusive`
 * (i.e. the last signature we have already processed).
 *
 * Strategy: page backwards (newest → oldest) using `before` until we either
 * see `sinceExclusive` in a batch or reach the safety ceiling.
 * Results are returned in CHRONOLOGICAL order (oldest first) ready to process.
 *
 * On the very first call (sinceExclusive === undefined) we return just the
 * first page so we can anchor without replaying history.
 */
async function getAllNewSigs(
  wallet: string,
  sinceExclusive: string | undefined,
): Promise<SigInfo[] | null> {
  // First-ever call: just anchor to current tip, no processing needed
  if (!sinceExclusive) {
    return fetchSigPage(wallet, { limit: PAGE_SIZE });
  }

  const collected: SigInfo[] = [];
  let beforeCursor: string | undefined;

  for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
    const batch = await fetchSigPage(wallet, {
      limit:  PAGE_SIZE,
      before: beforeCursor,
      until:  sinceExclusive, // stop when we reach the sig we already processed
    });

    if (batch === null) return null;   // RPC error — abort this cycle
    if (batch.length === 0) break;     // nothing new

    collected.push(...batch);

    // If we got fewer than a full page, we've reached the boundary
    if (batch.length < PAGE_SIZE) break;

    // Full page returned — there might be more; continue from the oldest in this batch
    beforeCursor = batch[batch.length - 1].signature;
  }

  // Reverse: collected is newest-first from RPC; we want chronological (oldest first)
  return collected.reverse();
}

/** getTransaction with v0 support and multi-RPC pool fallback */
async function getTransaction(sig: string): Promise<any | null> {
  const config = { maxSupportedTransactionVersion: 0, commitment: 'confirmed', encoding: 'jsonParsed' };
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const isHelius = endpoint.includes('helius');
      if (isHelius && isHeliusCoolingDown()) continue;
      const call = () => rpcPost(endpoint, 'getTransaction', [sig, config]);
      const result = isHelius ? await withHeliusLimit(call, { priority: false }) : await call();
      if (result) return result;
    } catch {
      continue;
    }
  }
  return null;
}

// ── Mint extraction ───────────────────────────────────────────────────────────

interface TxMeta {
  logMessages?: string[];
  postTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount: { amount: string } }>;
  loadedAddresses?: { writable?: string[]; readonly?: string[] };
  err?: any;
}

interface TxResult {
  transaction?: {
    message?: {
      accountKeys?: Array<{ pubkey: string } | string>;
    };
  };
  meta?: TxMeta;
}

/**
 * Strictly validates and extracts the graduated token mint from a transaction.
 *
 * Returns non-null ONLY when ALL of the following hold:
 *   1. meta.err is null  (TX succeeded)
 *   2. logMessages contains at least one explicit migrate/pool_create pattern
 *      (the migration wallet appearing in accountKeys alone is NOT sufficient —
 *       that wallet also appears in pool-swap TXes)
 *   3. postTokenBalances contains a non-WSOL, non-infrastructure mint
 *
 * Any deviation returns null without firing discovery.
 */
function extractMintFromTx(tx: TxResult): { mint: string; instructionType: string } | null {
  const meta = tx.meta;

  // 1. Skip failed transactions
  if (meta?.err) return null;

  const logs: string[] = meta?.logMessages ?? [];

  // 2. STRICT: require explicit migrate/pool_create instruction in log messages.
  //    Do NOT fall through on "wallet in accountKeys" — the migration wallet
  //    appears in many non-graduation TXes (liquidity events, etc.).
  const hasMigrate = MIGRATE_PATTERNS.some(p => logs.some(l => p.test(l)));
  if (!hasMigrate) return null;

  // Identify instruction type for logging / DB label
  let instructionType = 'migrate';
  for (const log of logs) {
    if (/instruction:\s*migratev2$/i.test(log) || /instruction:\s*migrate_v2$/i.test(log)) {
      instructionType = 'migrate_v2';
      break;
    }
    if (/instruction:\s*pool_create$/i.test(log) || /instruction:\s*create_pool$/i.test(log)) {
      instructionType = 'pool_create';
      break;
    }
  }

  // 3. Extract mint from postTokenBalances — first non-infrastructure mint wins.
  //    With jsonParsed encoding the `mint` field is present directly;
  //    no accountIndex lookup needed.
  const postBalances = meta?.postTokenBalances ?? [];
  for (const bal of postBalances) {
    if (!bal.mint) continue;
    if (IGNORE_MINTS.has(bal.mint)) continue;
    return { mint: bal.mint, instructionType };
  }

  return null;
}

// ── Discovery event ────────────────────────────────────────────────────────────

export interface DiscoveryEvent {
  mint:            string;
  poolAddress?:    string;
  ts:              number;
  name?:           string;
  symbol?:         string;
  isMigration:     boolean;
  reserveUsd?:     number;
  discoverySource: 'pumpfun_wallet';
  txSignature?:    string;
  instructionType?: string;
}

// ── In-memory state ───────────────────────────────────────────────────────────

const suppressedUntil = new Map<string, number>();
const discoveryFeed: DiscoveryEvent[] = [];
let totalDiscovered   = 0;

// Diagnostics
let pollCount              = 0;
let lastPollSuccessMs      = 0;
let consecutiveFailures    = 0;
let lastPollError: string | null = null;
let sessionStartMs         = 0;
let lastSeenSig: string | undefined;
let txFetchErrors          = 0;
let txFetchTotal           = 0;

// ── Graduation callback ───────────────────────────────────────────────────────

let onGraduation: ((ev: {
  mint: string;
  poolAddress?: string;
  ts: number;
  openTimestamp?: number;
  reserveUsd?: number;
}) => void) | null = null;

export function setOnGraduation(
  cb: (ev: { mint: string; poolAddress?: string; ts: number; openTimestamp?: number; reserveUsd?: number }) => void,
): void {
  onGraduation = cb;
}

/** Allow sniper engine to shorten suppression on transient failures */
export function releaseForRediscovery(mint: string, delayMs: number): void {
  suppressedUntil.set(mint, Date.now() + delayMs);
}

// ── Public accessors ──────────────────────────────────────────────────────────

export function getDiscoveryFeed(): DiscoveryEvent[] {
  return discoveryFeed.slice(0, MAX_FEED);
}

export function getDiscoveryTotal(): number {
  return totalDiscovered;
}

/** Legacy compat — single source now */
export function getFiredBySource(): Record<string, number> {
  return { pumpfun_wallet: totalDiscovered };
}

export function getSourceActivity() {
  return { gmgn: { total: totalDiscovered, recent: discoveryFeed.slice(0, 20) } };
}

// ── Core processing ───────────────────────────────────────────────────────────

async function processSig(sig: string): Promise<boolean> {
  txFetchTotal++;
  const tx = await getTransaction(sig);
  if (!tx) {
    txFetchErrors++;
    return false;
  }

  const extracted = extractMintFromTx(tx as TxResult);
  if (!extracted) return false;

  const { mint, instructionType } = extracted;
  const now = Date.now();

  // Suppression check
  const suppressExpiry = suppressedUntil.get(mint);
  if (suppressExpiry !== undefined && now < suppressExpiry) {
    logger.debug({ mint: mint.slice(0, 12) }, 'Migration wallet: mint suppressed, skipping');
    return false;
  }

  // Mark suppressed
  suppressedUntil.set(mint, now + SUPPRESSION_MS);
  totalDiscovered++;

  const ev: DiscoveryEvent = {
    mint,
    ts:              now,
    isMigration:     false,
    discoverySource: 'pumpfun_wallet',
    txSignature:     sig,
    instructionType,
  };

  discoveryFeed.unshift(ev);
  if (discoveryFeed.length > MAX_FEED) discoveryFeed.pop();

  logger.info(
    { mint: mint.slice(0, 16), sig: sig.slice(0, 16), instructionType, total: totalDiscovered },
    'Migration wallet: new graduation detected',
  );

  // Fire graduation callback (feeds sniper engine)
  if (onGraduation) {
    onGraduation({ mint, ts: now });
  }

  // Persist to DB
  query(
    `INSERT INTO detected_migrations
       (source, instruction_type, tx_signature, pool_address, mint, creator_wallet)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_signature) DO NOTHING`,
    ['pumpfun_wallet', instructionType, sig, null, mint, MIGRATION_WALLET],
  ).catch(() => {});

  return true;
}

// ── Pump.fun Direct API Fallback ─────────────────────────────────────────────

async function fetchPumpfunDirectApi(): Promise<void> {
  try {
    const resp = await fetch('https://frontend-api-v2.pump.fun/coins/migrated?limit=15&offset=0&includeNsfw=false', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return;
    const coins = (await resp.json()) as Array<{ mint: string; symbol?: string; name?: string; created_timestamp?: number }>;
    if (!Array.isArray(coins)) return;

    const now = Date.now();
    for (const coin of coins) {
      if (!coin.mint || IGNORE_MINTS.has(coin.mint)) continue;
      const suppressExpiry = suppressedUntil.get(coin.mint);
      if (suppressExpiry !== undefined && now < suppressExpiry) continue;

      suppressedUntil.set(coin.mint, now + SUPPRESSION_MS);
      totalDiscovered++;

      const ev: DiscoveryEvent = {
        mint: coin.mint,
        ts: now,
        name: coin.name,
        symbol: coin.symbol,
        isMigration: true,
        discoverySource: 'pumpfun_wallet',
        instructionType: 'migrate_v2',
      };

      discoveryFeed.unshift(ev);
      if (discoveryFeed.length > MAX_FEED) discoveryFeed.pop();

      logger.info(
        { mint: coin.mint.slice(0, 16), symbol: coin.symbol, total: totalDiscovered },
        'Pump.fun API: new graduation detected via direct API fallback',
      );

      if (onGraduation) {
        onGraduation({ mint: coin.mint, ts: now });
      }

      query(
        `INSERT INTO detected_migrations
           (source, instruction_type, tx_signature, pool_address, mint, creator_wallet)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (mint) DO NOTHING`,
        ['pumpfun_api', 'migrate_v2', `pf-${coin.mint}`, null, coin.mint, MIGRATION_WALLET],
      ).catch(() => {});
    }
  } catch {
    /* non-fatal fallback */
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

let started  = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;

async function poll(): Promise<void> {
  // Always trigger Pump.fun direct API fallback check in parallel
  void fetchPumpfunDirectApi().catch(() => {});

  const sigs = await getAllNewSigs(MIGRATION_WALLET, lastSeenSig);

  if (sigs === null) {
    consecutiveFailures++;
    lastPollError = 'getSignaturesForAddress returned null (RPC rate limit)';
    logger.debug({ consecutiveFailures }, 'Migration wallet: poll failed, using Pump.fun API fallback');
    lastPollSuccessMs = Date.now();
    return;
  }

  consecutiveFailures = 0;
  lastPollError       = null;
  lastPollSuccessMs   = Date.now();
  pollCount++;

  if (sigs.length === 0) return;

  // First ever poll: anchor to the newest sig in the batch, do not process history
  if (!lastSeenSig) {
    lastSeenSig = sigs[0].signature;
    logger.info(
      { anchor: lastSeenSig.slice(0, 16), total: sigs.length },
      'Migration wallet: anchored to current tip — tracking from here',
    );
    return;
  }

  // Subsequent polls: sigs is already chronological (oldest-first) from getAllNewSigs.
  const toProcess = sigs.filter(s => !s.err);
  if (toProcess.length > 0) {
    logger.debug({ count: toProcess.length }, 'Migration wallet: processing new signatures');
    // Process signature details in parallel batches of 5 for speed
    for (let i = 0; i < toProcess.length; i += 5) {
      const chunk = toProcess.slice(i, i + 5);
      await Promise.allSettled(chunk.map(s => processSig(s.signature)));
    }
  }

  // Advance cursor: sigs is oldest-first, so newest is last
  const newestSig = sigs[sigs.length - 1]?.signature;
  if (newestSig) lastSeenSig = newestSig;
}

function scheduleNext(): void {
  if (!started) return;
  const delay = consecutiveFailures > 0
    ? Math.min(1_000 * 2 ** (consecutiveFailures - 1), 5_000)
    : POLL_INTERVAL_MS;
  loopTimer = setTimeout(async () => {
    try {
      await poll();
    } catch (err) {
      logger.error({ err }, 'Migration wallet: unhandled poll error');
      consecutiveFailures++;
    } finally {
      lastPollSuccessMs = Date.now();
      scheduleNext();
    }
  }, delay);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function startTrenchesScanner(): void {
  if (started) return;
  started        = true;
  sessionStartMs = Date.now();

  const heliusSet = !!process.env.HELIUS_API_KEY;
  logger.info(
    { wallet: MIGRATION_WALLET, pollIntervalMs: POLL_INTERVAL_MS, heliusApiKeySet: heliusSet },
    'Migration wallet tracker: starting',
  );

  if (!heliusSet) {
    logger.warn(
      'HELIUS_API_KEY not set — using public RPC (mainnet-beta). Higher latency and rate limits apply.',
    );
  }

  // Kick off immediately
  loopTimer = setTimeout(async () => {
    try { await poll(); } catch { /* already logged */ }
    scheduleNext();
  }, 500);
}

export function stopTrenchesScanner(): void {
  if (!started) return;
  started = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  logger.info('Migration wallet tracker: stopped');
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export function getTrenchesDiagnostics() {
  const elapsedMs    = sessionStartMs ? Date.now() - sessionStartMs : 0;
  const elapsedHours = elapsedMs / 3_600_000;
  const tokensPerHour = elapsedHours > 0.05 ? Math.round(totalDiscovered / elapsedHours) : null;

  const nowMs = Date.now();
  let suppressedCount = 0;
  for (const expiry of suppressedUntil.values()) {
    if (nowMs < expiry) suppressedCount++;
  }

  return {
    source:              'pumpfun_migration_wallet',
    walletAddress:       MIGRATION_WALLET,
    sessionStartMs,
    pollCount,
    lastPollSuccessMs,
    lastPollAgoSec:      lastPollSuccessMs ? Math.round((Date.now() - lastPollSuccessMs) / 1_000) : null,
    consecutiveFailures,
    lastPollError,
    pollIntervalMs:      POLL_INTERVAL_MS,
    totalDiscovered,
    tokensPerHour,
    txFetchTotal,
    txFetchErrors,
    txFetchErrorRate:    txFetchTotal > 0 ? Math.round((txFetchErrors / txFetchTotal) * 100) : 0,
    suppressedCount,
    lastSeenSig:         lastSeenSig?.slice(0, 20) ?? null,
    heliusApiKeySet:     !!process.env.HELIUS_API_KEY,
    rpcEndpoint:         process.env.HELIUS_API_KEY ? 'helius' : 'public-mainnet',
    recentFeed:          discoveryFeed.slice(0, 5).map(e => ({
      mint:            e.mint.slice(0, 12),
      instructionType: e.instructionType,
      txSignature:     e.txSignature?.slice(0, 16),
      ts:              e.ts,
    })),

    // Legacy fields kept for route/frontend compatibility
    activeMints:              suppressedUntil.size,
    isBootstrap:              pollCount === 0,
    consecutivePollFailures:  consecutiveFailures,
    pollDelayMs:              POLL_INTERVAL_MS,
    heliusWsConfigured:       false,
    gmgnApiKeySet:            false,
    gmgnBanned:               false,
    gmgnBannedUntilMs:        0,
    pumpfunMintsTotal:        totalDiscovered,
  };
}

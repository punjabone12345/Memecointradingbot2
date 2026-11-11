import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../lib/db.js';
import { Settings } from '../types/index.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSettingsBackupPath(): string {
  const candidates = [
    path.join(process.cwd(), 'artifacts', 'api-server', 'data', 'settings_backup.json'),
    path.join(process.cwd(), 'data', 'settings_backup.json'),
    path.join(__dirname, '..', '..', 'data', 'settings_backup.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const fallback = path.join(process.cwd(), 'artifacts', 'api-server', 'data');
  try { fs.mkdirSync(fallback, { recursive: true }); } catch { /* ignore */ }
  return path.join(fallback, 'settings_backup.json');
}

function loadSettingsFromDisk(): Settings | null {
  try {
    const p = getSettingsBackupPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    logger.debug({ err }, 'Could not read settings from disk backup');
  }
  return null;
}

function saveSettingsToDisk(settings: Settings): void {
  try {
    const p = getSettingsBackupPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.debug({ err }, 'Could not save settings to disk backup');
  }
}

let settingsCache: Settings | null = null;
let settingsCacheAt = 0;
const SETTINGS_CACHE_TTL = 8_000;

let balanceCache: number | null = null;
let balanceCacheAt = 0;
const BALANCE_CACHE_TTL = 5_000;

export function invalidateSettingsCache(): void {
  settingsCache = null;
  settingsCacheAt = 0;
  balanceCache = null;
  balanceCacheAt = 0;
}

export async function getSettings(): Promise<Settings> {
  const now = Date.now();
  if (settingsCache && now - settingsCacheAt < SETTINGS_CACHE_TTL) {
    return settingsCache;
  }

  try {
    const rows = await query<{ key: string; value: string }>('SELECT key, value FROM settings');
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const num = (k: string, def: number) => parseFloat(map[k] ?? String(def));
    const bool = (k: string, def: boolean) => (map[k] ?? String(def)) === 'true';

    // If DB returned rows, build settings from DB
    if (rows && rows.length > 0) {
      const settings: Settings = {
        botEnabled: bool('botEnabled', true),
        startingBalanceUsd: num('startingBalanceUsd', 1000),
        currentBalanceUsd: num('currentBalanceUsd', 1000),
        riskPerTradePct: num('riskPerTradePct', 0.1),
        maxOpenPositions: num('maxOpenPositions', 4),
        minAiScore: num('minAiScore', 91),
        minRiskRewardRatio: num('minRiskRewardRatio', 2.0),
        universeSize: num('universeSize', 100),
        paperTradingOnly: bool('paperTradingOnly', true),
        liveTradingEnabled: false,

        startingBalanceSol: num('startingBalanceSol', 10),
        currentBalanceSol: num('currentBalanceSol', 10),
        positionSizeSol: num('positionSizeSol', 0.10),
        sniperSlippagePct: num('sniperSlippagePct', 20),
        sniperStagnationPct: num('sniperStagnationPct', 5),
        tradingWindowEnabled: bool('tradingWindowEnabled', false),
        tradingWindowStart: map['tradingWindowStart'] ?? '17:00',
        tradingWindowEnd: map['tradingWindowEnd'] ?? '00:00',
        emaPeriodMinutes: num('emaPeriodMinutes', 20),
        pumpTargetPct: num('pumpTargetPct', 50),
        rugcheckRetryDelayMin: num('rugcheckRetryDelayMin', 5),
        fakeSetupSpikeCapUsd: num('fakeSetupSpikeCapUsd', 200000),
        maxTrackingDurationMin: num('maxTrackingDurationMin', 120),
        rpcEndpoint: map['rpcEndpoint'] ?? 'https://api.mainnet-beta.solana.com',
        slippagePct: num('slippagePct', 1),
        priorityFeeSol: num('priorityFeeSol', 0.001),
        walletPublicKey: map['walletPublicKey'] ?? '',
        tp1Pct: num('tp1Pct', 70),
        tp1ExitPct: num('tp1ExitPct', 30),
        tp2Pct: num('tp2Pct', 150),
        tp2ExitPct: num('tp2ExitPct', 40),
        tp3Pct: num('tp3Pct', 300),
        tp3ExitPct: num('tp3ExitPct', 30),
        trailingSLPct: num('trailingSLPct', 20),
        wt1Tp1Pct: num('wt1Tp1Pct', 50),
        wt1Tp1Exit: num('wt1Tp1Exit', 30),
        wt1Tp2Pct: num('wt1Tp2Pct', 125),
        wt1Tp2Exit: num('wt1Tp2Exit', 30),
        wt1Tp2Trail: num('wt1Tp2Trail', 30),
        wt1Tp3Pct: num('wt1Tp3Pct', 200),
        wt1Tp3Exit: num('wt1Tp3Exit', 30),
        wt1Tp3Trail: num('wt1Tp3Trail', 20),
        wt2Tp1Pct: num('wt2Tp1Pct', 100),
        wt2Tp1Exit: num('wt2Tp1Exit', 30),
        wt2Tp2Pct: num('wt2Tp2Pct', 250),
        wt2Tp2Exit: num('wt2Tp2Exit', 30),
        wt2Tp2Trail: num('wt2Tp2Trail', 25),
        wt2Tp3Pct: num('wt2Tp3Pct', 400),
        wt2Tp3Exit: num('wt2Tp3Exit', 30),
        wt2Tp3Trail: num('wt2Tp3Trail', 15),
        wt3Tp1Pct: num('wt3Tp1Pct', 150),
        wt3Tp1Exit: num('wt3Tp1Exit', 30),
        wt3Tp2Pct: num('wt3Tp2Pct', 350),
        wt3Tp2Exit: num('wt3Tp2Exit', 30),
        wt3Tp2Trail: num('wt3Tp2Trail', 20),
        wt3Tp3Pct: num('wt3Tp3Pct', 550),
        wt3Tp3Exit: num('wt3Tp3Exit', 30),
        wt3Tp3Trail: num('wt3Tp3Trail', 10),
        minLiquidity: num('minLiquidity', 15000),
        minMc: num('minMc', 30000),
        sustainDurationSec: num('sustainDurationSec', 600),
        telegramBotToken: map['telegramBotToken'] ?? '',
        telegramChatId: map['telegramChatId'] ?? '',
        deltaEnabled: bool('deltaEnabled', false),
        deltaEnvironment: (map['deltaEnvironment'] as Settings['deltaEnvironment']) || 'INDIA_DEMO',
        deltaApiKey: map['deltaApiKey'] ?? '',
        deltaApiSecret: map['deltaApiSecret'] ?? '',
        deltaRiskScale: num('deltaRiskScale', 1.0),
        deltaLeverage: num('deltaLeverage', 10),
        deltaMaxRiskUsd: num('deltaMaxRiskUsd', 0),
      };

      settingsCache = settings;
      settingsCacheAt = Date.now();
      saveSettingsToDisk(settings);
      return settings;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to query settings from DB - checking disk backup');
  }

  // Fallback 1: Disk backup
  const disk = loadSettingsFromDisk();
  if (disk) {
    settingsCache = {
      ...disk,
      botEnabled: disk.botEnabled ?? true,
      startingBalanceUsd: disk.startingBalanceUsd || 1000,
      riskPerTradePct: disk.riskPerTradePct || 0.1,
      maxOpenPositions: disk.maxOpenPositions || 4,
      minAiScore: disk.minAiScore || 91,
      minRiskRewardRatio: disk.minRiskRewardRatio || 2.0,
      deltaEnabled: disk.deltaEnabled ?? false,
      deltaEnvironment: disk.deltaEnvironment || 'INDIA_DEMO',
      deltaApiKey: disk.deltaApiKey ?? '',
      deltaApiSecret: disk.deltaApiSecret ?? '',
      deltaRiskScale: disk.deltaRiskScale ?? 1.0,
      deltaLeverage: disk.deltaLeverage ?? 10,
      deltaMaxRiskUsd: disk.deltaMaxRiskUsd ?? 0,
    };
    settingsCacheAt = Date.now();
    return settingsCache;
  }

  // Fallback 2: Hardcoded institutional defaults
  const fallbackSettings: Settings = {
    botEnabled: true,
    startingBalanceUsd: 1000,
    currentBalanceUsd: 1000,
    riskPerTradePct: 0.1,
    maxOpenPositions: 4,
    minAiScore: 91,
    minRiskRewardRatio: 2.0,
    universeSize: 100,
    paperTradingOnly: true,
    liveTradingEnabled: false,
    startingBalanceSol: 10,
    currentBalanceSol: 10,
    positionSizeSol: 0.10,
    sniperSlippagePct: 20,
    sniperStagnationPct: 5,
    tradingWindowEnabled: false,
    tradingWindowStart: '17:00',
    tradingWindowEnd: '00:00',
    emaPeriodMinutes: 20,
    pumpTargetPct: 50,
    rugcheckRetryDelayMin: 5,
    fakeSetupSpikeCapUsd: 200000,
    maxTrackingDurationMin: 120,
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    slippagePct: 1,
    priorityFeeSol: 0.001,
    walletPublicKey: '',
    tp1Pct: 70,
    tp1ExitPct: 30,
    tp2Pct: 150,
    tp2ExitPct: 40,
    tp3Pct: 300,
    tp3ExitPct: 30,
    trailingSLPct: 20,
    wt1Tp1Pct: 50,
    wt1Tp1Exit: 30,
    wt1Tp2Pct: 125,
    wt1Tp2Exit: 30,
    wt1Tp2Trail: 30,
    wt1Tp3Pct: 200,
    wt1Tp3Exit: 30,
    wt1Tp3Trail: 20,
    wt2Tp1Pct: 100,
    wt2Tp1Exit: 30,
    wt2Tp2Pct: 250,
    wt2Tp2Exit: 30,
    wt2Tp2Trail: 25,
    wt2Tp3Pct: 400,
    wt2Tp3Exit: 30,
    wt2Tp3Trail: 15,
    wt3Tp1Pct: 150,
    wt3Tp1Exit: 30,
    wt3Tp2Pct: 350,
    wt3Tp2Exit: 30,
    wt3Tp2Trail: 20,
    wt3Tp3Pct: 550,
    wt3Tp3Exit: 30,
    wt3Tp3Trail: 10,
    minLiquidity: 15000,
    minMc: 30000,
    sustainDurationSec: 600,
    telegramBotToken: '',
    telegramChatId: '',
    deltaEnabled: false,
    deltaEnvironment: 'INDIA_DEMO',
    deltaApiKey: '',
    deltaApiSecret: '',
    deltaRiskScale: 1.0,
    deltaLeverage: 10,
    deltaMaxRiskUsd: 0,
  };

  settingsCache = fallbackSettings;
  settingsCacheAt = Date.now();
  saveSettingsToDisk(fallbackSettings);
  return fallbackSettings;
}

const STRING_SETTING_KEYS = new Set([
  'tradingWindowStart',
  'tradingWindowEnd',
  'rpcEndpoint',
  'walletPublicKey',
  'telegramBotToken',
  'telegramChatId',
  'deltaEnvironment',
  'deltaApiKey',
  'deltaApiSecret',
]);

export async function updateSetting(key: string, value: string): Promise<void> {
  const target = settingsCache ?? loadSettingsFromDisk();
  if (target) {
    if (STRING_SETTING_KEYS.has(key)) {
      (target as any)[key] = value;
    } else if (value === 'true' || value === 'false') {
      (target as any)[key] = value === 'true';
    } else if (value.trim() !== '' && !isNaN(Number(value))) {
      (target as any)[key] = Number(value);
    } else {
      (target as any)[key] = value;
    }
    saveSettingsToDisk(target);
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  ).catch(err => logger.debug({ err }, `Could not persist setting ${key} to DB (saved to memory/disk)`));
  invalidateSettingsCache();
}

export async function updateSettings(updates: Partial<Record<string, string>>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) await updateSetting(key, value);
  }
  invalidateSettingsCache();
}

export async function getBalance(): Promise<number> {
  const now = Date.now();
  if (balanceCache !== null && now - balanceCacheAt < BALANCE_CACHE_TTL) {
    return balanceCache;
  }
  try {
    const rows = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'currentBalanceUsd'`);
    if (rows && rows.length > 0 && rows[0]?.value) {
      const balance = parseFloat(rows[0].value);
      balanceCache = balance;
      balanceCacheAt = now;
      return balance;
    }
  } catch (err) {
    logger.debug({ err }, 'Could not read balance from DB');
  }
  const s = await getSettings();
  const balance = s.currentBalanceUsd || 1000;
  balanceCache = balance;
  balanceCacheAt = now;
  return balance;
}

export async function setBalance(usd: number): Promise<void> {
  balanceCache = usd;
  balanceCacheAt = Date.now();
  await updateSetting('currentBalanceUsd', String(usd));
}

let balanceMutex: Promise<unknown> = Promise.resolve();

function withBalanceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = balanceMutex.then(fn, fn);
  balanceMutex = run.catch(() => undefined);
  return run;
}

export async function adjustBalance(deltaUsd: number, floorAtZero = true): Promise<number> {
  return withBalanceLock(async () => {
    let current = balanceCache;
    if (current === null) {
      current = await getBalance();
    }
    let next = current + deltaUsd;
    if (floorAtZero) next = Math.max(0, next);
    balanceCache = next;
    balanceCacheAt = Date.now();
    await updateSetting('currentBalanceUsd', String(next));
    return next;
  });
}

export async function resetAllData(): Promise<void> {
  await query(`DELETE FROM paper_positions`).catch(() => {});
  balanceCache = 1000;
  balanceCacheAt = Date.now();
  await updateSetting('currentBalanceUsd', '1000');
  await updateSetting('startingBalanceUsd', '1000');
}

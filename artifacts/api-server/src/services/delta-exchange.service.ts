import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios, { AxiosRequestConfig } from 'axios';
import { ClosedPaperPosition, PaperPosition, Settings } from '../types/index.js';
import { getSettings } from './settings.service.js';
import { logger } from '../lib/logger.js';
import { notifyDeltaReplication } from '../lib/telegram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DeltaEnvironment = 'INDIA_DEMO' | 'GLOBAL_DEMO' | 'INDIA_LIVE' | 'GLOBAL_LIVE';

const DELTA_BASE_URLS: Record<DeltaEnvironment, string> = {
  INDIA_DEMO: 'https://cdn-ind.testnet.deltaex.org',
  GLOBAL_DEMO: 'https://testnet-api.delta.exchange',
  INDIA_LIVE: 'https://api.india.delta.exchange',
  GLOBAL_LIVE: 'https://api.delta.exchange',
};

const DELTA_HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (compatible; AltcoinTradingBot/1.0)',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

interface DeltaProduct {
  id: number;
  symbol: string;
  contract_type: string;
  state: string;
  contract_value: string;
  tick_size: string;
  quoting_asset?: { symbol?: string };
  settling_asset?: { symbol?: string };
}

interface ResolvedProduct {
  product: DeltaProduct;
  priceMultiplier: number; // e.g. 1000 for 1000SHIBUSD
}

interface ReplicatedOrderRecord {
  paperId: string;
  symbol: string;
  deltaSymbol: string;
  productId: number;
  side: 'LONG' | 'SHORT';
  contracts: number;
  tickSize: string;
  priceMultiplier: number;
  environment: DeltaEnvironment;
  entryOrderId?: number | string;
  createdAt: number;
}

const productsCache = new Map<DeltaEnvironment, { products: DeltaProduct[]; fetchedAt: number }>();
const PRODUCTS_CACHE_TTL_MS = 30 * 60 * 1000;
const replicatedOrders = new Map<string, ReplicatedOrderRecord>();
let mappingLoaded = false;

function getMappingBackupPath(): string {
  const candidates = [
    path.join(process.cwd(), 'artifacts', 'api-server', 'data', 'delta_orders_backup.json'),
    path.join(process.cwd(), 'data', 'delta_orders_backup.json'),
    path.join(__dirname, '..', '..', 'data', 'delta_orders_backup.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const fallback = path.join(process.cwd(), 'artifacts', 'api-server', 'data');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(fallback, 'delta_orders_backup.json');
}

function loadMappingBackup(): void {
  if (mappingLoaded) return;
  mappingLoaded = true;
  try {
    const p = getMappingBackupPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) {
        for (const rec of raw) {
          if (rec?.paperId) replicatedOrders.set(rec.paperId, rec);
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Could not load Delta order mapping backup');
  }
}

function saveMappingBackup(): void {
  try {
    const p = getMappingBackupPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(Array.from(replicatedOrders.values()), null, 2));
  } catch (err) {
    logger.debug({ err }, 'Could not save Delta order mapping backup');
  }
}

interface DeltaConfig {
  enabled: boolean;
  environment: DeltaEnvironment;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  riskScale: number;
  leverage: number;
}

async function resolveDeltaConfig(override?: Partial<Settings>): Promise<DeltaConfig> {
  const s = await getSettings();
  const envRaw = (override?.deltaEnvironment || s.deltaEnvironment || process.env.DELTA_ENV || 'INDIA_DEMO') as string;
  const environment: DeltaEnvironment = envRaw in DELTA_BASE_URLS ? (envRaw as DeltaEnvironment) : 'INDIA_DEMO';
  const apiKey = (override?.deltaApiKey ?? s.deltaApiKey ?? process.env.DELTA_API_KEY ?? '').trim();
  const apiSecret = (override?.deltaApiSecret ?? s.deltaApiSecret ?? process.env.DELTA_API_SECRET ?? '').trim();
  const enabled = Boolean(override?.deltaEnabled ?? s.deltaEnabled ?? (process.env.DELTA_ENABLED === 'true'));
  const riskScale = Number(override?.deltaRiskScale ?? s.deltaRiskScale ?? 1.0) || 1.0;
  const leverage = Math.max(1, Math.min(100, Math.round(Number(override?.deltaLeverage ?? s.deltaLeverage ?? 10) || 10)));

  return {
    enabled,
    environment,
    baseUrl: DELTA_BASE_URLS[environment],
    apiKey,
    apiSecret,
    riskScale,
    leverage,
  };
}

/**
 * Signs and sends an authenticated or public request to Delta Exchange v2 REST API.
 */
async function deltaRequest<T = any>(
  cfg: Pick<DeltaConfig, 'baseUrl' | 'apiKey' | 'apiSecret'>,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  pathWithQuery: string,
  body?: Record<string, unknown> | null,
  authenticated = true
): Promise<T> {
  const payloadStr = body ? JSON.stringify(body) : '';
  const headers: Record<string, string> = { ...DELTA_HEADERS_BASE };

  if (authenticated) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sigData = `${method}${timestamp}${pathWithQuery}${payloadStr}`;
    const signature = crypto.createHmac('sha256', cfg.apiSecret).update(sigData).digest('hex');
    headers['api-key'] = cfg.apiKey;
    headers['timestamp'] = timestamp;
    headers['signature'] = signature;
  }

  const reqConfig: AxiosRequestConfig = {
    method,
    url: `${cfg.baseUrl}${pathWithQuery}`,
    headers,
    timeout: 12000,
    ...(payloadStr ? { data: payloadStr } : {}),
  };

  const response = await axios(reqConfig);
  return response.data as T;
}

async function fetchLivePerpetuals(environment: DeltaEnvironment): Promise<DeltaProduct[]> {
  const cached = productsCache.get(environment);
  if (cached && Date.now() - cached.fetchedAt < PRODUCTS_CACHE_TTL_MS) {
    return cached.products;
  }

  const data = await deltaRequest<{ result?: DeltaProduct[] }>(
    { baseUrl: DELTA_BASE_URLS[environment], apiKey: '', apiSecret: '' },
    'GET',
    '/v2/products',
    null,
    false
  );

  const perps = (data?.result || []).filter(
    p => p.contract_type === 'perpetual_futures' && p.state === 'live'
  );
  if (perps.length > 0) {
    productsCache.set(environment, { products: perps, fetchedAt: Date.now() });
  }
  return perps;
}

/**
 * Matches an internal coin symbol (e.g. BTC, SOL, SHIB) to Delta's live perpetual contract.
 */
async function resolveDeltaProduct(environment: DeltaEnvironment, coinSymbol: string): Promise<ResolvedProduct | null> {
  const perps = await fetchLivePerpetuals(environment);
  const sym = coinSymbol.toUpperCase();
  const isIndia = environment.startsWith('INDIA');
  const preferredQuotes = isIndia ? ['USD', 'USDT'] : ['USDT', 'USD'];

  const candidates: Array<{ target: string; multiplier: number }> = [];
  for (const q of preferredQuotes) {
    candidates.push({ target: `${sym}${q}`, multiplier: 1 });
    candidates.push({ target: `1000${sym}${q}`, multiplier: 1000 });
    candidates.push({ target: `1M${sym}${q}`, multiplier: 1_000_000 });
  }

  for (const c of candidates) {
    const match = perps.find(p => p.symbol.toUpperCase() === c.target);
    if (match) {
      return { product: match, priceMultiplier: c.multiplier };
    }
  }
  return null;
}

/**
 * Aligns a price strictly to Delta Exchange's contract tick_size precision.
 */
function formatToTickSize(price: number, tickSizeStr: string): string {
  const tick = parseFloat(tickSizeStr);
  if (!Number.isFinite(tick) || tick <= 0) return price.toFixed(4);

  let decimals = 0;
  if (tickSizeStr.includes('e-')) {
    decimals = parseInt(tickSizeStr.split('e-')[1] || '4', 10);
  } else if (tickSizeStr.includes('.')) {
    decimals = tickSizeStr.split('.')[1].replace(/0+$/, '').length;
  }

  const rounded = Math.round(price / tick) * tick;
  return rounded.toFixed(Math.max(0, decimals));
}

async function fetchProductMarkPrice(cfg: DeltaConfig, productSymbol: string): Promise<number | null> {
  try {
    const res = await deltaRequest<{ result?: { mark_price?: string; spot_price?: string } }>(
      cfg,
      'GET',
      `/v2/tickers/${encodeURIComponent(productSymbol)}`,
      null,
      false
    );
    const mp = parseFloat(res?.result?.mark_price || res?.result?.spot_price || '0');
    return mp > 0 ? mp : null;
  } catch {
    return null;
  }
}

/**
 * Verifies API credentials, retrieves Delta Exchange demo/live wallet balances,
 * and reports which tracked altcoin symbols are listed on the selected environment.
 */
export async function testDeltaConnection(override?: Partial<Settings>): Promise<{
  success: boolean;
  environment: DeltaEnvironment;
  baseUrl: string;
  balances?: Array<{ asset: string; balance: string; available: string }>;
  livePerpsCount?: number;
  supportedSample?: string[];
  error?: string;
}> {
  const cfg = await resolveDeltaConfig(override);
  if (!cfg.apiKey || !cfg.apiSecret) {
    return {
      success: false,
      environment: cfg.environment,
      baseUrl: cfg.baseUrl,
      error: 'Delta API Key and API Secret are required.',
    };
  }

  try {
    const [walletRes, perps] = await Promise.all([
      deltaRequest<{ success?: boolean; result?: any[]; error?: any }>(cfg, 'GET', '/v2/wallet/balances'),
      fetchLivePerpetuals(cfg.environment),
    ]);

    const balances = (walletRes?.result || []).map((b: any) => ({
      asset: b.asset_symbol || String(b.asset_id),
      balance: String(b.balance ?? '0'),
      available: String(b.available_balance ?? b.balance ?? '0'),
    }));

    const supportedSample = perps
      .map(p => p.symbol)
      .filter(s => /^(1000)?(BTC|ETH|SOL|XRP|ADA|DOGE|BNB|AVAX|LINK|DOT|SUI|UNI|ARB|OP|NEAR|AAVE|APT|LTC|HYPE)USD/.test(s))
      .slice(0, 20);

    return {
      success: true,
      environment: cfg.environment,
      baseUrl: cfg.baseUrl,
      balances,
      livePerpsCount: perps.length,
      supportedSample,
    };
  } catch (err: any) {
    const apiErr = err?.response?.data?.error?.code || err?.response?.data?.message || err?.message || 'Connection failed';
    return {
      success: false,
      environment: cfg.environment,
      baseUrl: cfg.baseUrl,
      error: String(apiErr),
    };
  }
}

/**
 * Replicates a newly opened paper trade 1:1 onto Delta Exchange with identical direction,
 * proportional contract sizing, and bracket SL/TP orders. Non-fatal on error.
 */
export async function replicateEntryToDelta(pos: PaperPosition): Promise<void> {
  loadMappingBackup();
  const cfg = await resolveDeltaConfig();
  if (!cfg.enabled || !cfg.apiKey || !cfg.apiSecret) return;

  try {
    const resolved = await resolveDeltaProduct(cfg.environment, pos.symbol);
    if (!resolved) {
      logger.info({ symbol: pos.symbol, env: cfg.environment }, 'Delta replication skipped: contract not listed on selected environment');
      void notifyDeltaReplication(
        `SKIPPED ${pos.symbol}`,
        `Contract not listed on <b>${cfg.environment}</b> (Paper trade remains active).`
      ).catch(() => {});
      return;
    }

    const { product, priceMultiplier } = resolved;
    const contractValue = parseFloat(product.contract_value) || 1;
    const rawContracts = (pos.quantity * cfg.riskScale) / (contractValue * priceMultiplier);
    const contracts = Math.max(1, Math.round(rawContracts));

    // Align leverage before entry (best-effort)
    await deltaRequest(
      cfg,
      'POST',
      `/v2/products/${product.id}/orders/leverage`,
      { leverage: String(cfg.leverage) }
    ).catch(err => logger.debug({ err: err?.response?.data || err?.message, symbol: product.symbol }, 'Delta leverage set skipped'));

    // Validate SL/TP relative to Delta live mark_price so thin testnet books don't reject brackets
    let slPrice = pos.stopLoss * priceMultiplier;
    let tpPrice = pos.takeProfit * priceMultiplier;
    const deltaMark = await fetchProductMarkPrice(cfg, product.symbol);
    if (deltaMark && deltaMark > 0) {
      const isLong = pos.side === 'LONG';
      const invalidSide = isLong ? (slPrice >= deltaMark || tpPrice <= deltaMark) : (slPrice <= deltaMark || tpPrice >= deltaMark);
      if (invalidSide) {
        const slPct = Math.abs(pos.entryPrice - pos.stopLoss) / pos.entryPrice;
        const tpPct = Math.abs(pos.takeProfit - pos.entryPrice) / pos.entryPrice;
        slPrice = isLong ? deltaMark * (1 - slPct) : deltaMark * (1 + slPct);
        tpPrice = isLong ? deltaMark * (1 + tpPct) : deltaMark * (1 - tpPct);
      }
    }

    const slStr = formatToTickSize(slPrice, product.tick_size);
    const tpStr = formatToTickSize(tpPrice, product.tick_size);

    const orderPayload = {
      product_id: product.id,
      size: contracts,
      side: pos.side === 'LONG' ? 'buy' : 'sell',
      order_type: 'market_order',
      bracket_stop_loss_price: slStr,
      bracket_take_profit_price: tpStr,
      bracket_stop_trigger_method: 'mark_price',
      client_order_id: pos.id.slice(0, 32),
    };

    const res = await deltaRequest<{ success?: boolean; result?: { id?: number | string } }>(
      cfg,
      'POST',
      '/v2/orders',
      orderPayload
    );

    const rec: ReplicatedOrderRecord = {
      paperId: pos.id,
      symbol: pos.symbol,
      deltaSymbol: product.symbol,
      productId: product.id,
      side: pos.side,
      contracts,
      tickSize: product.tick_size,
      priceMultiplier,
      environment: cfg.environment,
      entryOrderId: res?.result?.id,
      createdAt: Date.now(),
    };

    replicatedOrders.set(pos.id, rec);
    saveMappingBackup();

    logger.info({ paperId: pos.id, deltaSymbol: product.symbol, contracts, slStr, tpStr, orderId: rec.entryOrderId }, 'Replicated entry order to Delta Exchange');
    void notifyDeltaReplication(
      `ENTRY OPENED — ${product.symbol}`,
      `<b>Side:</b> ${pos.side} | <b>Contracts:</b> ${contracts}\n` +
      `<b>Bracket SL:</b> $${slStr} | <b>Bracket TP:</b> $${tpStr}\n` +
      `<b>Environment:</b> ${cfg.environment}`
    ).catch(() => {});
  } catch (err: any) {
    const errMsg = err?.response?.data?.error?.code || err?.response?.data?.message || err?.message;
    logger.warn({ symbol: pos.symbol, err: errMsg }, 'Delta entry replication failed (non-fatal to paper engine)');
    void notifyDeltaReplication(
      `ENTRY FAILED — ${pos.symbol}`,
      `Error: <code>${String(errMsg)}</code> (Paper trade unaffected).`
    ).catch(() => {});
  }
}

/**
 * Replicates the +1.5R Break-Even stop-loss ratchet to Delta's resting stop-loss order.
 */
export async function replicateStopMoveToDelta(pos: PaperPosition): Promise<void> {
  loadMappingBackup();
  const cfg = await resolveDeltaConfig();
  if (!cfg.enabled || !cfg.apiKey || !cfg.apiSecret) return;

  const rec = replicatedOrders.get(pos.id);
  if (!rec) return;

  try {
    const openOrders = await deltaRequest<{ result?: any[] }>(
      cfg,
      'GET',
      `/v2/orders?state=open&product_id=${rec.productId}`
    );

    const slOrder = (openOrders?.result || []).find(
      o => o.stop_order_type === 'stop_loss_order' && Number(o.product_id) === rec.productId
    );
    if (!slOrder) return;

    const newStopStr = formatToTickSize(pos.stopLoss * rec.priceMultiplier, rec.tickSize);
    await deltaRequest(cfg, 'PUT', '/v2/orders', {
      id: slOrder.id,
      product_id: rec.productId,
      stop_price: newStopStr,
    });

    logger.info({ deltaSymbol: rec.deltaSymbol, orderId: slOrder.id, newStopStr }, 'Updated Delta bracket SL to Break-Even');
    void notifyDeltaReplication(
      `BREAK-EVEN SYNCED — ${rec.deltaSymbol}`,
      `Resting Delta Stop-Loss moved to $${newStopStr}.`
    ).catch(() => {});
  } catch (err: any) {
    logger.warn({ symbol: pos.symbol, err: err?.response?.data || err?.message }, 'Delta SL break-even update failed');
  }
}

/**
 * Ensures any remaining open position or resting bracket orders on Delta are cleanly closed
 * when the paper engine closes a position (TP, SL, or Manual Close).
 */
export async function replicateCloseToDelta(pos: ClosedPaperPosition): Promise<void> {
  loadMappingBackup();
  const cfg = await resolveDeltaConfig();
  if (!cfg.enabled || !cfg.apiKey || !cfg.apiSecret) return;

  const rec = replicatedOrders.get(pos.id);
  if (!rec) return;

  try {
    const posRes = await deltaRequest<{ result?: { size?: number } }>(
      cfg,
      'GET',
      `/v2/positions?product_id=${rec.productId}`
    ).catch(() => ({ result: { size: 0 } }));

    const deltaSize = Number(posRes?.result?.size || 0);
    const stillOpenSameSide = (rec.side === 'LONG' && deltaSize > 0) || (rec.side === 'SHORT' && deltaSize < 0);

    if (stillOpenSameSide) {
      await deltaRequest(cfg, 'POST', '/v2/orders', {
        product_id: rec.productId,
        size: Math.abs(deltaSize),
        side: rec.side === 'LONG' ? 'sell' : 'buy',
        order_type: 'market_order',
        reduce_only: true,
      });
    }

    // Always clean up remaining OCO/bracket orders for this product so nothing stays orphaned
    await deltaRequest(cfg, 'DELETE', '/v2/orders/all', { product_id: rec.productId }).catch(() => {});

    replicatedOrders.delete(pos.id);
    saveMappingBackup();

    logger.info({ deltaSymbol: rec.deltaSymbol, reason: pos.closeReason, closedMarketRemaining: stillOpenSameSide }, 'Synced trade close to Delta Exchange');
    void notifyDeltaReplication(
      `CLOSED — ${rec.deltaSymbol}`,
      `<b>Reason:</b> ${pos.closeReason}\n` +
      `<b>Position Synced & Bracket Orders Cleaned</b>`
    ).catch(() => {});
  } catch (err: any) {
    logger.warn({ symbol: pos.symbol, err: err?.response?.data || err?.message }, 'Delta close sync failed');
  }
}

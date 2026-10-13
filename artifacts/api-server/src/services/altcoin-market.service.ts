import axios from 'axios';
import { logger } from '../lib/logger.js';
import { AltcoinAsset, AltcoinSignal, SignalStatus, SetupType, TradeThesis, AltcoinStatusResponse } from '../types/index.js';
import { processPaperTradingEngine } from './altcoin-paper.service.js';
import { calculateEMA, calculateRSI, calculateATR, Kline } from './smc.js';

const klinesCache = new Map<string, { data: Kline[], timestamp: number }>();

async function fetchBinanceKlines(symbol: string, interval: string = '1h', limit: number = 200): Promise<Kline[]> {
  const now = Date.now();
  const cacheKey = `${symbol}_${interval}`;
  const cached = klinesCache.get(cacheKey);
  
  // Cache TTL based on interval
  let ttl = 300_000; // 5 mins default (for 15m)
  if (interval === '1h') ttl = 900_000; // 15 mins for 1H
  if (interval === '4h') ttl = 3600_000; // 1 hr for 4H

  if (cached && now - cached.timestamp < ttl) {
    return cached.data;
  }

  const endpoints = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  ];

  for (const url of endpoints) {
    try {
      const response = await axios.get(url, { timeout: 6000 }); 
      const data = response.data.map((d: any[]) => ({
        timestamp: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
      }));
      
      if (data.length > 0) {
        klinesCache.set(cacheKey, { data, timestamp: now });
        return data;
      }
    } catch (err: any) {
      logger.warn({ symbol, interval, err: err?.message }, 'Failed to fetch Klines from mirror');
    }
  }

  return cached ? cached.data : [];
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

// Top Liquid Altcoins Universe Seed List (65+ coins dynamically mapped to live Binance pairs)
const SEED_ALTCOINS = [
  { id: 'bitcoin', symbol: 'BTC', binanceSymbol: 'BTCUSDT', name: 'Bitcoin', category: 'Store of Value' },
  { id: 'ethereum', symbol: 'ETH', binanceSymbol: 'ETHUSDT', name: 'Ethereum', category: 'Layer 1' },
  { id: 'solana', symbol: 'SOL', binanceSymbol: 'SOLUSDT', name: 'Solana', category: 'Layer 1' },
  { id: 'binancecoin', symbol: 'BNB', binanceSymbol: 'BNBUSDT', name: 'BNB Chain', category: 'Layer 1' },
  { id: 'ripple', symbol: 'XRP', binanceSymbol: 'XRPUSDT', name: 'XRP', category: 'Layer 1' },
  { id: 'dogecoin', symbol: 'DOGE', binanceSymbol: 'DOGEUSDT', name: 'Dogecoin', category: 'High Beta / Top 10' },
  { id: 'chainlink', symbol: 'LINK', binanceSymbol: 'LINKUSDT', name: 'Chainlink', category: 'Oracle' },
  { id: 'avalanche-2', symbol: 'AVAX', binanceSymbol: 'AVAXUSDT', name: 'Avalanche', category: 'Layer 1' },
  { id: 'polkadot', symbol: 'DOT', binanceSymbol: 'DOTUSDT', name: 'Polkadot', category: 'Layer 1' },
  { id: 'cardano', symbol: 'ADA', binanceSymbol: 'ADAUSDT', name: 'Cardano', category: 'Layer 1' },
  { id: 'sui', symbol: 'SUI', binanceSymbol: 'SUIUSDT', name: 'Sui', category: 'Layer 1' },
  { id: 'near', symbol: 'NEAR', binanceSymbol: 'NEARUSDT', name: 'NEAR Protocol', category: 'Layer 1' },
  { id: 'aave', symbol: 'AAVE', binanceSymbol: 'AAVEUSDT', name: 'Aave', category: 'DeFi' },
  { id: 'arbitrum', symbol: 'ARB', binanceSymbol: 'ARBUSDT', name: 'Arbitrum', category: 'Layer 2' },
  { id: 'optimism', symbol: 'OP', binanceSymbol: 'OPUSDT', name: 'Optimism', category: 'Layer 2' },
  { id: 'injective-protocol', symbol: 'INJ', binanceSymbol: 'INJUSDT', name: 'Injective', category: 'DeFi' },
  { id: 'sei-network', symbol: 'SEI', binanceSymbol: 'SEIUSDT', name: 'Sei', category: 'Layer 1' },
  { id: 'celestia', symbol: 'TIA', binanceSymbol: 'TIAUSDT', name: 'Celestia', category: 'Infrastructure' },
  { id: 'uniswap', symbol: 'UNI', binanceSymbol: 'UNIUSDT', name: 'Uniswap', category: 'DeFi' },
  { id: 'polygon-ecosystem-token', symbol: 'POL', binanceSymbol: 'POLUSDT', name: 'Polygon', category: 'Layer 2' },
  { id: 'fetch-ai', symbol: 'FET', binanceSymbol: 'FETUSDT', name: 'Artificial Superintelligence', category: 'AI' },
  { id: 'render-token', symbol: 'RENDER', binanceSymbol: 'RENDERUSDT', name: 'Render', category: 'AI' },
  { id: 'cosmos', symbol: 'ATOM', binanceSymbol: 'ATOMUSDT', name: 'Cosmos', category: 'Layer 1' },
  { id: 'fantom', symbol: 'FTM', binanceSymbol: 'FTMUSDT', name: 'Fantom', category: 'Layer 1' },
  { id: 'algorand', symbol: 'ALGO', binanceSymbol: 'ALGOUSDT', name: 'Algorand', category: 'Layer 1' },
  { id: 'lido-dao', symbol: 'LDO', binanceSymbol: 'LDOUSDT', name: 'Lido DAO', category: 'DeFi' },
  { id: 'aptos', symbol: 'APT', binanceSymbol: 'APTUSDT', name: 'Aptos', category: 'Layer 1' },
  { id: 'quant-network', symbol: 'QNT', binanceSymbol: 'QNTUSDT', name: 'Quant', category: 'Infrastructure' },
  { id: 'filecoin', symbol: 'FIL', binanceSymbol: 'FILUSDT', name: 'Filecoin', category: 'Infrastructure' },
  { id: 'blockstack', symbol: 'STX', binanceSymbol: 'STXUSDT', name: 'Stacks', category: 'Layer 2' },
  { id: 'arweave', symbol: 'AR', binanceSymbol: 'ARUSDT', name: 'Arweave', category: 'Infrastructure' },
  { id: 'the-graph', symbol: 'GRT', binanceSymbol: 'GRTUSDT', name: 'The Graph', category: 'Infrastructure' },
  { id: 'maker', symbol: 'MKR', binanceSymbol: 'MKRUSDT', name: 'MakerDAO', category: 'DeFi' },
  { id: 'thorchain', symbol: 'RUNE', binanceSymbol: 'RUNEUSDT', name: 'THORChain', category: 'DeFi' },
  { id: 'kaspa', symbol: 'KAS', binanceSymbol: 'KASUSDT', name: 'Kaspa', category: 'Layer 1' },
  { id: 'bittensor', symbol: 'TAO', binanceSymbol: 'TAOUSDT', name: 'Bittensor', category: 'AI' },
  { id: 'worldcoin-wld', symbol: 'WLD', binanceSymbol: 'WLDUSDT', name: 'Worldcoin', category: 'AI' },
  { id: 'immutable-x', symbol: 'IMX', binanceSymbol: 'IMXUSDT', name: 'Immutable', category: 'Layer 2' },
  { id: 'pyth-network', symbol: 'PYTH', binanceSymbol: 'PYTHUSDT', name: 'Pyth Network', category: 'Oracle' },
  { id: 'ondo-finance', symbol: 'ONDO', binanceSymbol: 'ONDOUSDT', name: 'Ondo', category: 'RWA' },
  { id: 'jupiter-exchange-solana', symbol: 'JUP', binanceSymbol: 'JUPUSDT', name: 'Jupiter', category: 'DeFi' },
  { id: 'pendle', symbol: 'PENDLE', binanceSymbol: 'PENDLEUSDT', name: 'Pendle', category: 'DeFi' },
  { id: 'ethena', symbol: 'ENA', binanceSymbol: 'ENAUSDT', name: 'Ethena', category: 'DeFi' },
  { id: 'starknet', symbol: 'STRK', binanceSymbol: 'STRKUSDT', name: 'Starknet', category: 'Layer 2' },
  { id: 'wormhole', symbol: 'W', binanceSymbol: 'WUSDT', name: 'Wormhole', category: 'Interop' },
  { id: 'gala', symbol: 'GALA', binanceSymbol: 'GALAUSDT', name: 'GALA', category: 'Gaming' },
  { id: 'chiliz', symbol: 'CHZ', binanceSymbol: 'CHZUSDT', name: 'Chiliz', category: 'Gaming' },
  { id: 'flow', symbol: 'FLOW', binanceSymbol: 'FLOWUSDT', name: 'Flow', category: 'Layer 1' },
  { id: 'eos', symbol: 'EOS', binanceSymbol: 'EOSUSDT', name: 'EOS', category: 'Layer 1' },
  { id: 'tezos', symbol: 'XTZ', binanceSymbol: 'XTZUSDT', name: 'Tezos', category: 'Layer 1' },
  { id: 'the-sandbox', symbol: 'SAND', binanceSymbol: 'SANDUSDT', name: 'The Sandbox', category: 'Gaming' },
  { id: 'decentraland', symbol: 'MANA', binanceSymbol: 'MANAUSDT', name: 'Decentraland', category: 'Gaming' },
  { id: 'enjincoin', symbol: 'ENJ', binanceSymbol: 'ENJUSDT', name: 'Enjin', category: 'Gaming' },
  { id: 'blur', symbol: 'BLUR', binanceSymbol: 'BLURUSDT', name: 'Blur', category: 'DeFi' },
  { id: 'synthetix-network-token', symbol: 'SNX', binanceSymbol: 'SNXUSDT', name: 'Synthetix', category: 'DeFi' },
  { id: 'dydx-chain', symbol: 'DYDX', binanceSymbol: 'DYDXUSDT', name: 'dYdX', category: 'DeFi' },
  { id: '1inch', symbol: '1INCH', binanceSymbol: '1INCHUSDT', name: '1inch', category: 'DeFi' },
  { id: 'curve-dao-token', symbol: 'CRV', binanceSymbol: 'CRVUSDT', name: 'Curve DAO', category: 'DeFi' },
  { id: 'convex-finance', symbol: 'CVX', binanceSymbol: 'CVXUSDT', name: 'Convex', category: 'DeFi' },
  { id: 'compound-governance-token', symbol: 'COMP', binanceSymbol: 'COMPUSDT', name: 'Compound', category: 'DeFi' },
  { id: 'yearn-finance', symbol: 'YFI', binanceSymbol: 'YFIUSDT', name: 'yearn.finance', category: 'DeFi' },
  { id: 'loopring', symbol: 'LRC', binanceSymbol: 'LRCUSDT', name: 'Loopring', category: 'Layer 2' },
  { id: 'zcash', symbol: 'ZEC', binanceSymbol: 'ZECUSDT', name: 'Zcash', category: 'Layer 1' },
  { id: 'dash', symbol: 'DASH', binanceSymbol: 'DASHUSDT', name: 'Dash', category: 'Layer 1' },
  { id: 'oasis-network', symbol: 'ROSE', binanceSymbol: 'ROSEUSDT', name: 'Oasis Network', category: 'Layer 1' },
  { id: 'mina-protocol', symbol: 'MINA', binanceSymbol: 'MINAUSDT', name: 'Mina Protocol', category: 'Layer 1' },
  { id: 'kava', symbol: 'KAVA', binanceSymbol: 'KAVAUSDT', name: 'Kava', category: 'DeFi' },
  { id: 'celo', symbol: 'CELO', binanceSymbol: 'CELOUSDT', name: 'Celo', category: 'Layer 1' },
  { id: 'harmony', symbol: 'ONE', binanceSymbol: 'ONEUSDT', name: 'Harmony', category: 'Layer 1' },
  { id: 'flare-networks', symbol: 'FLR', binanceSymbol: 'FLRUSDT', name: 'Flare', category: 'Infrastructure' },
  { id: 'hyperliquid', symbol: 'HYPE', binanceSymbol: 'HYPEUSDT', name: 'Hyperliquid', category: 'DeFi' }
];

let signalsCache: AltcoinSignal[] = [];
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 10_000;
let isScanning = false;
let scanTimer: ReturnType<typeof setInterval> | null = null;

async function fetchBinanceTickers(): Promise<Map<string, BinanceTicker>> {
  const tickerMap = new Map<string, BinanceTicker>();
  const endpoints = [
    'https://data-api.binance.vision/api/v3/ticker/24hr',
    'https://api.binance.com/api/v3/ticker/24hr'
  ];

  for (const url of endpoints) {
    try {
      const response = await axios.get<BinanceTicker[]>(url, { timeout: 7000 });
      if (Array.isArray(response.data) && response.data.length > 0) {
        for (const item of response.data) {
          if (item.symbol) {
            tickerMap.set(item.symbol, item);
          }
        }
        return tickerMap;
      }
    } catch (err: any) {
      logger.warn({ url, err: err?.message }, 'Failed fetching Binance tickers, trying next mirror');
    }
  }

  return tickerMap;
}

export async function fetchAltcoinMarketSignals(): Promise<AltcoinSignal[]> {
  const now = Date.now();
  if (signalsCache.length > 0 && now - lastFetchTimestamp < CACHE_TTL_MS) {
    return signalsCache;
  }

  const tickerMap = await fetchBinanceTickers();

  if (tickerMap.size > 0) {
    const computedSignals: AltcoinSignal[] = [];

      for (let i = 0; i < SEED_ALTCOINS.length; i++) {
        const seed = SEED_ALTCOINS[i];
        let ticker = tickerMap.get(seed.binanceSymbol);
        if (!ticker && seed.symbol === 'POL') ticker = tickerMap.get('MATICUSDT');

        if (ticker) {
          const lastPrice = parseFloat(ticker.lastPrice) || 1;
          const change24h = parseFloat(ticker.priceChangePercent) || 0;
          const volume24h = parseFloat(ticker.quoteVolume) || 10_000_000;
          const high24h = parseFloat(ticker.highPrice) || lastPrice * 1.05;
          const low24h = parseFloat(ticker.lowPrice) || lastPrice * 0.95;
          const result = await computeRealSignal(seed, lastPrice, change24h, volume24h, high24h, low24h, i + 1);
          computedSignals.push(result);
        } else if (seed.symbol === 'HYPE') {
          const result = await computeRealSignal(seed, 24.85, 3.45, 85_000_000, 26.10, 23.40, i + 1);
          computedSignals.push(result);
        }
      }

      if (computedSignals.length > 0) {
        // â”€â”€ Quality over Quantity Gate â”€â”€
      // Sort candidates by AI score. Grant ENTRY_READY to all top-tier setups
      // meeting institutional price action criteria (up to 8 candidates across the universe).
      const readyCandidates = computedSignals
        .filter((s) => s.status === 'ENTRY_READY')
        .sort((a, b) => b.aiScore - a.aiScore);

      const MAX_ENTRY_READY = 10;
      const topSymbols = new Set(readyCandidates.slice(0, MAX_ENTRY_READY).map((s) => s.symbol));

      for (const sig of computedSignals) {
        if (sig.status === 'ENTRY_READY' && !topSymbols.has(sig.symbol)) {
          sig.status = 'NEAR_ENTRY';
          sig.missingCondition = 'High quality setup queued in top tier â€” waiting for primary entry trigger or open execution slot.';
        }
      }

      signalsCache = computedSignals;
      lastFetchTimestamp = now;
      return signalsCache;
    }
  }

  // If both Binance endpoints failed, maintain cached signals with real baseline
  if (signalsCache.length > 0) {
    return signalsCache;
  }

  return signalsCache;
}

export function getAltcoinAssets(): AltcoinAsset[] {
  return signalsCache.map((sig, idx) => ({
    id: sig.assetId,
    symbol: sig.symbol,
    name: sig.name,
    category: sig.category,
    price: sig.price,
    priceChange24h: sig.priceChange24h,
    volume24h: sig.volume24h,
    marketCap: sig.marketCap,
    high24h: parseFloat((sig.price * 1.05).toFixed(4)),
    low24h: parseFloat((sig.price * 0.94).toFixed(4)),
    isMemecoin: false,
    isStablecoin: false,
    liquidityScore: 90,
    tradabilityScore: 95,
    universeRank: idx + 1,
    lastUpdated: sig.lastUpdated
  }));
}

export async function getAltcoinStatus(): Promise<AltcoinStatusResponse> {
  const signals = await fetchAltcoinMarketSignals();
  return processPaperTradingEngine(signals);
}

export async function startAltcoinScanner(): Promise<void> {
  if (isScanning) return;
  isScanning = true;
  logger.info('Starting Altcoin Market Scanner Service...');

  // Initial run
  try {
    const signals = await fetchAltcoinMarketSignals();
    await processPaperTradingEngine(signals);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Initial altcoin scanner run failed');
  }

  // Polling loop
  scanTimer = setInterval(async () => {
    try {
      const signals = await fetchAltcoinMarketSignals();
      await processPaperTradingEngine(signals);
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Altcoin scanner interval error');
    }
  }, 30_000);
}

let cachedBtcRegime: { regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL', timestamp: number } | null = null;

async function getBitcoinMacroRegime(): Promise<'BULLISH' | 'BEARISH' | 'NEUTRAL'> {
  const now = Date.now();
  if (cachedBtcRegime && (now - cachedBtcRegime.timestamp < 300_000)) {
    return cachedBtcRegime.regime;
  }
  try {
    const btc4h = await fetchBinanceKlines('BTCUSDT', '4h', 250);
    const btc1h = await fetchBinanceKlines('BTCUSDT', '1h', 250);
    if (btc4h.length < 50 || btc1h.length < 50) return 'NEUTRAL';
    const ema50_4h = calculateEMA(btc4h, 50);
    const ema200_4h = calculateEMA(btc4h, 200);
    const last4h = btc4h[btc4h.length - 2] || btc4h[btc4h.length - 1];
    const ema50_1h = calculateEMA(btc1h, 50);
    const last1h = btc1h[btc1h.length - 2] || btc1h[btc1h.length - 1];

    const idx4h = btc4h.length - 2;
    const btc4hBull = last4h.close > ema50_4h[idx4h] && ema50_4h[idx4h] > ema200_4h[idx4h];
    const btc4hBear = last4h.close < ema50_4h[idx4h] && ema50_4h[idx4h] < ema200_4h[idx4h];

    const idx1h = btc1h.length - 2;
    const btc1hBull = last1h.close > ema50_1h[idx1h];
    const btc1hBear = last1h.close < ema50_1h[idx1h];

    let regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (btc4hBull && btc1hBull) regime = 'BULLISH';
    else if (btc4hBear && btc1hBear) regime = 'BEARISH';

    cachedBtcRegime = { regime, timestamp: now };
    return regime;
  } catch {
    return 'NEUTRAL';
  }
}

async function computeRealSignal(
  seed: { id: string; symbol: string; binanceSymbol: string; name: string; category: string },
  price: number,
  change24h: number,
  volume24h: number,
  high24h: number,
  low24h: number,
  rank: number
): Promise<AltcoinSignal> {
  const marketCap = Math.round(volume24h * 12);
  let setupType: SetupType = 'NONE';
  let status: SignalStatus = 'WATCHING';
  let reason = 'Waiting for high-conviction Momentum Pullback & Reversal confirmation.';
  let missingCondition: string | null = 'Scanning 4H macro trend and 1H reversal trigger...';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.083).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  let deepExplanation: string[] = [];
  const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) + " IST";
  deepExplanation.push('[Generated: ' + istTime + ']');

  try {
    const [klines4h, klines1h, btcRegime] = await Promise.all([
      fetchBinanceKlines(seed.binanceSymbol, '4h', 250),
      fetchBinanceKlines(seed.binanceSymbol, '1h', 250),
      getBitcoinMacroRegime()
    ]);

    if (klines4h.length > 60 && klines1h.length > 60) {
      // 1. MACRO 4H TREND
      const ema50_4h = calculateEMA(klines4h, 50);
      const ema200_4h = calculateEMA(klines4h, 200);
      const idx4h = klines4h.length - 2; // Last COMPLETED 4H candle
      const candle4h = klines4h[idx4h];
      const is4hBull = candle4h.close > ema50_4h[idx4h] && ema50_4h[idx4h] > ema200_4h[idx4h];
      const is4hBear = candle4h.close < ema50_4h[idx4h] && ema50_4h[idx4h] < ema200_4h[idx4h];

      // 2. MICRO 1H STRUCTURE (Using LAST COMPLETED 1H candle - NEVER enter on unclosed bar!)
      const ema20_1h = calculateEMA(klines1h, 20);
      const ema50_1h = calculateEMA(klines1h, 50);
      const rsi1h = calculateRSI(klines1h, 14);
      const atr1h = calculateATR(klines1h, 14);

      const idx1h = klines1h.length - 2;
      const lastClosed = klines1h[idx1h];
      const prevClosed = klines1h[idx1h - 1];
      const currentAtr = atr1h[idx1h] || (price * 0.03);

      // 1H Volume SMA
      let volSum = 0;
      for (let v = idx1h - 20; v < idx1h; v++) {
        volSum += (klines1h[v]?.volume || 0);
      }
      const volSma = volSum / 20;
      const isVolumeValid = volSma > 0 ? (lastClosed.volume >= volSma * 1.05) : true;
      const isLiquid = volume24h > 5000000;

      side = is4hBull ? 'LONG' : (is4hBear ? 'SHORT' : (btcRegime === 'BULLISH' ? 'LONG' : 'SHORT'));

      // Check for Bullish Setup:
      if (is4hBull && btcRegime !== 'BEARISH') {
        deepExplanation.push('MACRO (4H): Bullish (EMA50 > EMA200 & Price > EMA50) | BTC Regime: ' + btcRegime);

        // Check if RSI pulled back to value zone (30 - 48) within last 4 candles
        const rsiHistory = [rsi1h[idx1h], rsi1h[idx1h - 1], rsi1h[idx1h - 2], rsi1h[idx1h - 3]];
        const hadRsiPullback = rsiHistory.some(r => r >= 30 && r <= 48);

        // Reversal confirmation: closed candle crossed back above 20-EMA, green candle, with volume
        const crossedAboveEma20 = lastClosed.close > ema20_1h[idx1h] && prevClosed.close <= ema20_1h[idx1h - 1];
        const isGreenCandle = lastClosed.close > lastClosed.open;

        if (hadRsiPullback && crossedAboveEma20 && isGreenCandle && isVolumeValid && isLiquid) {
          setupType = 'PULLBACK';
          status = 'ENTRY_READY';
          reason = 'Confirmed 4H Bullish Trend + 1H Reversal Cross above 20-EMA with Volume.';
          missingCondition = null;
          aiScore = 96;
          stopLoss = price - (currentAtr * 1.5);
          takeProfit = price + (currentAtr * 2.5); // 1 : 1.67 R:R
          deepExplanation.push('CONFIRMED REVERSAL (1H): Closed green bar crossed EMA20 ($' + ema20_1h[idx1h].toFixed(price < 1 ? 4 : 2) + ') with volume confirmation.');
        } else if (!hadRsiPullback) {
          missingCondition = 'Waiting for 1H RSI to pull back into value zone (30-48). Current RSI: ' + rsi1h[idx1h].toFixed(1);
          aiScore = 65;
        } else if (!crossedAboveEma20 || !isGreenCandle) {
          missingCondition = 'Waiting for 1H candle to close GREEN back above 20-EMA ($' + ema20_1h[idx1h].toFixed(price < 1 ? 4 : 2) + ').';
          aiScore = 70;
        } else {
          missingCondition = 'Waiting for volume breakout confirmation.';
          aiScore = 60;
        }
      }
      // Check for Bearish Setup:
      else if (is4hBear && btcRegime !== 'BULLISH') {
        deepExplanation.push('MACRO (4H): Bearish (EMA50 < EMA200 & Price < EMA50) | BTC Regime: ' + btcRegime);

        const rsiHistory = [rsi1h[idx1h], rsi1h[idx1h - 1], rsi1h[idx1h - 2], rsi1h[idx1h - 3]];
        const hadRsiRally = rsiHistory.some(r => r >= 52 && r <= 70);

        const crossedBelowEma20 = lastClosed.close < ema20_1h[idx1h] && prevClosed.close >= ema20_1h[idx1h - 1];
        const isRedCandle = lastClosed.close < lastClosed.open;

        if (hadRsiRally && crossedBelowEma20 && isRedCandle && isVolumeValid && isLiquid) {
          setupType = 'PULLBACK';
          status = 'ENTRY_READY';
          reason = 'Confirmed 4H Bearish Trend + 1H Reversal Cross below 20-EMA with Volume.';
          missingCondition = null;
          aiScore = 96;
          stopLoss = price + (currentAtr * 1.5);
          takeProfit = price - (currentAtr * 2.5); // 1 : 1.67 R:R
          deepExplanation.push('CONFIRMED REVERSAL (1H): Closed red bar crossed below EMA20 ($' + ema20_1h[idx1h].toFixed(price < 1 ? 4 : 2) + ') with volume confirmation.');
        } else if (!hadRsiRally) {
          missingCondition = 'Waiting for 1H RSI to rally into premium zone (52-70). Current RSI: ' + rsi1h[idx1h].toFixed(1);
          aiScore = 65;
        } else if (!crossedBelowEma20 || !isRedCandle) {
          missingCondition = 'Waiting for 1H candle to close RED back below 20-EMA ($' + ema20_1h[idx1h].toFixed(price < 1 ? 4 : 2) + ').';
          aiScore = 70;
        } else {
          missingCondition = 'Waiting for volume breakdown confirmation.';
          aiScore = 60;
        }
      } else {
        missingCondition = 'Market in consolidation / conflicting macro trend (BTC: ' + btcRegime + ').';
        aiScore = 40;
      }
    }
  } catch (err: any) {
    logger.warn({ symbol: seed.symbol, err: err?.message }, 'Failed to compute true technicals');
  }

  if (side === 'LONG' && stopLoss >= price) stopLoss = price * 0.96;
  if (side === 'SHORT' && stopLoss <= price) stopLoss = price * 1.04;

  const riskDist = Math.abs(price - stopLoss);
  if (side === 'LONG' && takeProfit < price + riskDist * 1.5) takeProfit = price + riskDist * 1.67;
  if (side === 'SHORT' && takeProfit > price - riskDist * 1.5) takeProfit = price - riskDist * 1.67;

  const riskDistPct = parseFloat(((riskDist / price) * 100).toFixed(2));
  const rewardDistPct = parseFloat(((Math.abs(takeProfit - price) / price) * 100).toFixed(2));
  const rrRatio = parseFloat((rewardDistPct / (riskDistPct || 1)).toFixed(2));

  if (deepExplanation.length === 0) {
    deepExplanation.push(reason);
    if (missingCondition) deepExplanation.push(missingCondition);
  }
  deepExplanation.push('SL: $' + parseFloat(stopLoss.toFixed(price < 1 ? 4 : 2)) + ' | TP: $' + parseFloat(takeProfit.toFixed(price < 1 ? 4 : 2)) + ' (1:' + rrRatio + ')');

  const mtfTrendBull = side === 'LONG';
  const isLiquid = volume24h > 5000000;

  return {
    assetId: seed.id, symbol: seed.symbol, name: seed.name, category: seed.category,
    price, priceChange24h: change24h, volume24h, marketCap, aiScore,
    scoreBreakdown: { trend: mtfTrendBull ? 20 : 10, momentum: aiScore > 75 ? 20 : 10, volume: isLiquid ? 20 : 10, structure: 20, volatility: 10, htfAlignment: 10 },
    status, setupType,
    mtfTrend: { tf4h: mtfTrendBull ? 'BULLISH' : 'BEARISH', tf1h: mtfTrendBull ? 'BULLISH' : 'BEARISH', tf15m: mtfTrendBull ? 'BULLISH' : 'BEARISH', tf5m: mtfTrendBull ? 'BULLISH' : 'BEARISH' },
    reason, missingCondition,
    tradeThesis: {
      side, entryPrice: price, stopLoss: parseFloat(stopLoss.toFixed(price < 1 ? 4 : 2)), takeProfit: parseFloat(takeProfit.toFixed(price < 1 ? 4 : 2)),
      riskDistancePct: riskDistPct, rewardDistancePct: rewardDistPct, riskRewardRatio: rrRatio,
      invalidationLevel: stopLoss, targetLevel: takeProfit,
      explanation: deepExplanation
    },
    lastUpdated: Date.now()
  };
}

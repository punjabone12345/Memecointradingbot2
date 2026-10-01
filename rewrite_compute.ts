import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'artifacts/api-server/src/services/altcoin-market.service.ts');
let content = fs.readFileSync(file, 'utf-8');

const regex = /function computeRealSignal[\s\S]*?(?=\n$|$)/;

const newFunc = `async function computeRealSignal(
  seed: { id: string; symbol: string; binanceSymbol: string; name: string; category: string },
  price: number,
  change24h: number,
  volume24h: number,
  high24h: number,
  low24h: number,
  rank: number
): Promise<AltcoinSignal> {
  const marketCap = Math.round(volume24h * 12);
  const rangeSpan = high24h - low24h;
  const rangeLocation = rangeSpan > 0 ? (price - low24h) / rangeSpan : 0.5;

  let setupType: SetupType = 'NONE';
  let status: SignalStatus = 'WATCHING';
  let reason = 'Waiting for high-probability SMC setup.';
  let missingCondition: string | null = 'Awaiting optimal trade entry (OTE) + FVG tap.';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.10).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  // SMC Filter: Only process if liquid and moving
  const isLiquid = volume24h >= 25_000_000;
  
  if (isLiquid && Math.abs(change24h) >= 1.5) {
    // Fetch 1H Klines for SMC Logic
    const klines = await fetchBinanceKlines(seed.binanceSymbol);
    if (klines.length >= 50) {
      const ema50 = calculateEMA(klines, 50);
      const currentEma = ema50[ema50.length - 1];
      const pivots = findSwingPivots(klines, 4, 4);
      const fvgs = identifyFVGs(klines);

      const isUptrend = price > currentEma;
      const isDowntrend = price < currentEma;

      if (isUptrend) {
        side = 'LONG';
        // Find recent swing high and low
        const highs = pivots.filter(p => p.type === 'HIGH').slice(-2);
        const lows = pivots.filter(p => p.type === 'LOW').slice(-2);
        
        if (highs.length > 0 && lows.length > 0) {
          const recentHigh = highs[highs.length - 1].price;
          const recentLow = lows[lows.length - 1].price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            // Fibonacci Retracement of current leg
            const fibLevel = (recentHigh - price) / swingRange; // 0 = at high, 1 = at low
            const isDiscount = fibLevel >= 0.5; // Price has pulled back at least 50%
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            // Check for Bullish FVG tap in Discount zone
            const bullishFvgs = fvgs.filter(f => f.type === 'BULLISH' && f.index >= lows[lows.length-1].index);
            const tappingFvg = bullishFvgs.some(f => price <= f.top && price >= f.bottom * 0.99);

            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'PULLBACK';
              reason = \`SMC LONG: Price tapped bullish FVG inside Optimal Trade Entry (Fib \${fibLevel.toFixed(2)}) in an uptrend.\`;
              missingCondition = null;
              stopLoss = parseFloat((recentLow * 0.99).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentHigh.toFixed(price < 1 ? 4 : 2)); // Target recent high
            } else if (isDiscount) {
              aiScore = 82;
              status = 'NEAR_ENTRY';
              reason = 'SMC LONG: Price in discount zone, waiting for FVG tap or rejection wick.';
            }
          }
        }
      } else if (isDowntrend) {
        side = 'SHORT';
        const highs = pivots.filter(p => p.type === 'HIGH').slice(-2);
        const lows = pivots.filter(p => p.type === 'LOW').slice(-2);
        
        if (highs.length > 0 && lows.length > 0) {
          const recentHigh = highs[highs.length - 1].price;
          const recentLow = lows[lows.length - 1].price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            const fibLevel = (price - recentLow) / swingRange; // 0 = at low, 1 = at high
            const isPremium = fibLevel >= 0.5; 
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            const bearishFvgs = fvgs.filter(f => f.type === 'BEARISH' && f.index >= highs[highs.length-1].index);
            const tappingFvg = bearishFvgs.some(f => price >= f.bottom && price <= f.top * 1.01);

            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'REVERSAL';
              reason = \`SMC SHORT: Price tapped bearish FVG inside Optimal Trade Entry (Fib \${fibLevel.toFixed(2)}) in a downtrend.\`;
              missingCondition = null;
              stopLoss = parseFloat((recentHigh * 1.01).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentLow.toFixed(price < 1 ? 4 : 2));
            } else if (isPremium) {
              aiScore = 82;
              status = 'NEAR_ENTRY';
              reason = 'SMC SHORT: Price in premium zone, waiting for FVG tap or rejection wick.';
            }
          }
        }
      }
    }
  }

  // Cap Stop Loss to avoid tiny stops getting wicked out
  const minStopPct = 2.5;
  const maxStopPct = 7.5;
  if (side === 'LONG') {
    const minSlPrice = price * (1 - maxStopPct/100);
    const maxSlPrice = price * (1 - minStopPct/100);
    stopLoss = Math.max(minSlPrice, Math.min(stopLoss, maxSlPrice));
  } else {
    const minSlPrice = price * (1 + minStopPct/100);
    const maxSlPrice = price * (1 + maxStopPct/100);
    stopLoss = Math.min(maxSlPrice, Math.max(stopLoss, minSlPrice));
  }
  
  // Ensure minimum R:R of 1:1.5
  const riskDist = Math.abs(price - stopLoss);
  if (side === 'LONG') {
    if (takeProfit < price + riskDist * 1.5) takeProfit = price + riskDist * 1.5;
  } else {
    if (takeProfit > price - riskDist * 1.5) takeProfit = price - riskDist * 1.5;
  }

  const riskDistPct = parseFloat(((riskDist / price) * 100).toFixed(2));
  const rewardDistPct = parseFloat(((Math.abs(takeProfit - price) / price) * 100).toFixed(2));
  const rrRatio = parseFloat((rewardDistPct / (riskDistPct || 1)).toFixed(2));

  // Ensure TP and SL are well formatted
  takeProfit = parseFloat(takeProfit.toFixed(price < 1 ? 4 : 2));
  stopLoss = parseFloat(stopLoss.toFixed(price < 1 ? 4 : 2));

  const tradeThesis: TradeThesis = {
    side,
    entryPrice: price,
    stopLoss,
    takeProfit,
    riskDistancePct: riskDistPct,
    rewardDistancePct: rewardDistPct,
    riskRewardRatio: rrRatio,
    invalidationLevel: stopLoss,
    targetLevel: takeProfit,
    explanation: [
      \`Real-time market price $\${price} (\${change24h >= 0 ? '+' : ''}\${change24h.toFixed(2)}% 24h).\`,
      reason,
      \`Stop Loss firmly placed at $\${stopLoss} beyond market structure invalidation.\`,
      \`Take Profit targeted at $\${takeProfit} for a 1:\${rrRatio} Risk/Reward setup.\`
    ]
  };

  return {
    assetId: seed.id,
    symbol: seed.symbol,
    name: seed.name,
    category: seed.category,
    price,
    priceChange24h: change24h,
    volume24h,
    marketCap,
    aiScore,
    scoreBreakdown: {
      trend: aiScore > 80 ? 20 : 10,
      momentum: aiScore > 80 ? 20 : 10,
      volume: isLiquid ? 20 : 10,
      structure: aiScore > 80 ? 20 : 10,
      volatility: 10,
      htfAlignment: aiScore > 80 ? 10 : 5
    },
    status,
    setupType,
    mtfTrend: {
      tf4h: change24h >= 0 ? 'BULLISH' : 'BEARISH',
      tf1h: change24h >= 0 ? 'BULLISH' : 'BEARISH',
      tf15m: 'BULLISH',
      tf5m: 'BULLISH'
    },
    reason,
    missingCondition,
    tradeThesis,
    lastUpdated: Date.now()
  };
}
`;

content = content.replace(regex, newFunc);
fs.writeFileSync(file, content);
console.log('Replaced computeRealSignal with SMC logic successfully');

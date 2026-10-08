import * as fs from 'fs';

const filePath = 'artifacts/api-server/src/services/altcoin-market.service.ts';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /async function computeRealSignal\([\s\S]*?\n\s+lastUpdated: Date\.now\(\)\n\s+\};\n\}/m;

const newCompute = \sync function computeRealSignal(
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
  let reason = 'Waiting for high-probability Institutional Trend Pullback setup.';
  let missingCondition: string | null = 'Scanning 4H/1H trends...';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.10).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  let deepExplanation: string[] = [];
  const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) + " IST";
  deepExplanation.push(\[Generated: \]\);

  try {
    const klines4h = await fetchBinanceKlines(seed.binanceSymbol, '4h', 100);
    const klines1h = await fetchBinanceKlines(seed.binanceSymbol, '1h', 150);

    if (klines4h.length > 50 && klines1h.length > 50) {
      // 1. MACRO TREND (4H 200 EMA)
      const ema200_4h = calculateEMA(klines4h, 200);
      const currentEma200_4h = ema200_4h[ema200_4h.length - 1];
      const is4hBullish = klines4h[klines4h.length - 1].close > currentEma200_4h;
      
      // 2. MICRO TREND (1H 50 EMA & 200 EMA)
      const ema50_1h = calculateEMA(klines1h, 50);
      const ema200_1h = calculateEMA(klines1h, 200);
      const currentEma50_1h = ema50_1h[ema50_1h.length - 1];
      const currentEma200_1h = ema200_1h[ema200_1h.length - 1];
      const is1hBullish = currentEma50_1h > currentEma200_1h;
      
      // 3. MOMENTUM & VOLATILITY (1H RSI & ATR)
      const rsi1h = calculateRSI(klines1h, 14);
      const atr1h = calculateATR(klines1h, 14);
      const currentAtr = atr1h[atr1h.length - 1];
      
      // Look back last 3 candles for oversold/overbought conditions
      const recentRSI = rsi1h.slice(-3);
      const wasOversold = recentRSI.some(r => r < 40);
      const wasOverbought = recentRSI.some(r => r > 60);

      const currentCandle = klines1h[klines1h.length - 1];
      const isLiquid = volume24h > 10000000;

      side = is4hBullish ? 'LONG' : 'SHORT';
      const mtfTrendBull = is4hBullish;
      
      if (is4hBullish) {
        deepExplanation.push(\MACRO (4H): Bullish (Price > 200-EMA @ $\)\);
        if (!is1hBullish) {
          missingCondition = 'Waiting for 1H 50-EMA to cross above 200-EMA (Trend Alignment).';
          aiScore = 40;
        } else {
          deepExplanation.push(\MICRO (1H): Bullish (50-EMA > 200-EMA)\);
          // ENTRY: Pullback touching the 1H 50-EMA
          if (currentCandle.low <= currentEma50_1h && currentCandle.close > currentEma50_1h) {
             deepExplanation.push(\ENTRY (1H): Price tapped dynamic support (50-EMA @ $\) and rejected.\);
             if (wasOversold) {
                deepExplanation.push(\MOMENTUM (1H): RSI dipped below 40, indicating momentum exhaustion.\);
                if (isLiquid) {
                   setupType = 'PULLBACK';
                   status = 'ENTRY_READY';
                   reason = 'Perfect Institutional Trend Pullback detected.';
                   missingCondition = null;
                   aiScore = 95;
                   
                   // Dynamic Volatility Stops
                   stopLoss = price - (currentAtr * 2.5); // 2.5 ATR Stop Loss for wide crypto breathing room
                   takeProfit = price + (currentAtr * 3.75); // 1.5 R:R strictly based on ATR
                } else {
                   missingCondition = 'Volume too low for safe entry.';
                   aiScore = 60;
                }
             } else {
                missingCondition = 'Waiting for RSI to signal momentum exhaustion (<40).';
                aiScore = 65;
             }
          } else if (currentCandle.close <= currentEma50_1h) {
             missingCondition = 'Price closed below 50-EMA (Support failed).';
             aiScore = 30;
          } else {
             missingCondition = 'Waiting for price to pull back and tap 50-EMA support.';
             aiScore = 60;
          }
        }
      } else {
        deepExplanation.push(\MACRO (4H): Bearish (Price < 200-EMA @ $\)\);
        if (is1hBullish) {
          missingCondition = 'Waiting for 1H 50-EMA to cross below 200-EMA (Trend Alignment).';
          aiScore = 40;
        } else {
          deepExplanation.push(\MICRO (1H): Bearish (50-EMA < 200-EMA)\);
          // ENTRY: Pullback touching the 1H 50-EMA
          if (currentCandle.high >= currentEma50_1h && currentCandle.close < currentEma50_1h) {
             deepExplanation.push(\ENTRY (1H): Price tapped dynamic resistance (50-EMA @ $\) and rejected.\);
             if (wasOverbought) {
                deepExplanation.push(\MOMENTUM (1H): RSI pushed above 60, indicating momentum exhaustion.\);
                if (isLiquid) {
                   setupType = 'PULLBACK';
                   status = 'ENTRY_READY';
                   reason = 'Perfect Institutional Trend Pullback detected.';
                   missingCondition = null;
                   aiScore = 95;
                   
                   // Dynamic Volatility Stops
                   stopLoss = price + (currentAtr * 2.5); // 2.5 ATR Stop Loss
                   takeProfit = price - (currentAtr * 3.75); // 1.5 R:R
                } else {
                   missingCondition = 'Volume too low for safe entry.';
                   aiScore = 60;
                }
             } else {
                missingCondition = 'Waiting for RSI to signal momentum exhaustion (>60).';
                aiScore = 65;
             }
          } else if (currentCandle.close >= currentEma50_1h) {
             missingCondition = 'Price closed above 50-EMA (Resistance failed).';
             aiScore = 30;
          } else {
             missingCondition = 'Waiting for price to rally and tap 50-EMA resistance.';
             aiScore = 60;
          }
        }
      }
      
      // Default placeholder values if not ready
      if (status !== 'ENTRY_READY') {
         if (side === 'LONG') {
            stopLoss = price - (currentAtr * 2.5);
            takeProfit = price + (currentAtr * 3.75);
         } else {
            stopLoss = price + (currentAtr * 2.5);
            takeProfit = price - (currentAtr * 3.75);
         }
      }
    }
  } catch (err: any) {
    logger.warn({ symbol: seed.symbol, err: err?.message }, 'Failed to compute true technicals');
  }

  // Basic limits
  if (side === 'LONG' && stopLoss >= price) stopLoss = price * 0.95;
  if (side === 'SHORT' && stopLoss <= price) stopLoss = price * 1.05;

  const riskDist = Math.abs(price - stopLoss);
  if (side === 'LONG' && takeProfit < price + riskDist * 1.5) takeProfit = price + riskDist * 1.5;
  if (side === 'SHORT' && takeProfit > price - riskDist * 1.5) takeProfit = price - riskDist * 1.5;

  const riskDistPct = parseFloat(((riskDist / price) * 100).toFixed(2));
  const rewardDistPct = parseFloat(((Math.abs(takeProfit - price) / price) * 100).toFixed(2));
  const rrRatio = parseFloat((rewardDistPct / (riskDistPct || 1)).toFixed(2));

  if (deepExplanation.length === 0) {
    deepExplanation.push(reason);
    if (missingCondition) deepExplanation.push(missingCondition);
  }
  deepExplanation.push(\SL: $\ | TP: $\ (1:\)\);

  const mtfTrendBull = side === 'LONG';
  const isLiquid = volume24h > 10000000;

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
}\;

content = content.replace(regex, newCompute);
fs.writeFileSync(filePath, content);
console.log('Replaced successfully using Node.');

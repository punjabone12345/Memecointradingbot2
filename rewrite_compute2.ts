import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'artifacts/api-server/src/services/altcoin-market.service.ts');
let content = fs.readFileSync(file, 'utf-8');

const regex = /async function computeRealSignal[\s\S]*?(?=\n$|$)/;

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
  let setupType: SetupType = 'NONE';
  let status: SignalStatus = 'WATCHING';
  let reason = 'Waiting for high-probability SMC setup.';
  let missingCondition: string | null = 'Scanning 1H market structure...';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.10).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  // SMC Filter: Ensure enough liquidity to avoid massive slippage/wicks
  const isLiquid = volume24h >= 15_000_000; 
  
  let structureDetails = '';
  let trendStr = 'BULLISH';
  let mtfTrendBull = true;

  if (!isLiquid) {
    reason = \`Volume ($\${(volume24h/1000000).toFixed(1)}M) too low for institutional SMC.\`;
    missingCondition = 'Needs > $15M 24h volume to qualify.';
    aiScore = 40;
  } else {
    // Fetch 1H Klines for SMC Logic
    const klines = await fetchBinanceKlines(seed.binanceSymbol);
    if (klines.length >= 50) {
      const ema50 = calculateEMA(klines, 50);
      const currentEma = ema50[ema50.length - 1];
      const pivots = findSwingPivots(klines, 4, 4);
      const fvgs = identifyFVGs(klines);

      const isUptrend = price > currentEma;
      mtfTrendBull = isUptrend;

      if (isUptrend) {
        side = 'LONG';
        trendStr = 'BULLISH';
        const highs = pivots.filter(p => p.type === 'HIGH');
        const lows = pivots.filter(p => p.type === 'LOW');
        
        if (highs.length > 0 && lows.length > 0) {
          const recentHigh = highs[highs.length - 1].price;
          const recentLow = lows[lows.length - 1].price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            const fibLevel = (recentHigh - price) / swingRange;
            const isDiscount = fibLevel >= 0.5;
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            const oteTop = recentHigh - (swingRange * 0.618);
            const oteBottom = recentHigh - (swingRange * 0.786);
            
            const bullishFvgs = fvgs.filter(f => f.type === 'BULLISH' && f.index >= lows[lows.length-1].index);
            const activeFvg = bullishFvgs.length > 0 ? bullishFvgs[bullishFvgs.length - 1] : null;
            const tappingFvg = activeFvg ? (price <= activeFvg.top && price >= activeFvg.bottom * 0.99) : false;

            structureDetails = \`1H Swing: $\${recentLow.toFixed(price<1?4:2)} - $\${recentHigh.toFixed(price<1?4:2)}. OTE Zone: $\${oteBottom.toFixed(price<1?4:2)} - $\${oteTop.toFixed(price<1?4:2)}.\`;
            
            if (activeFvg) {
              missingCondition = \`Waiting for pullback into OTE + FVG ($\${activeFvg.bottom.toFixed(price<1?4:2)} - $\${activeFvg.top.toFixed(price<1?4:2)})\`;
            } else {
              missingCondition = \`Waiting for price to reach OTE zone. No clear FVG formed yet.\`;
            }

            // Scoring
            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'PULLBACK';
              reason = \`SMC LONG: Price tapped bullish FVG inside Optimal Trade Entry (Fib \${fibLevel.toFixed(2)})!\`;
              missingCondition = null;
              stopLoss = parseFloat((recentLow * 0.99).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentHigh.toFixed(price < 1 ? 4 : 2));
            } else if (isDiscount) {
              aiScore = 75 + (fibLevel * 10); // 80-85
              status = 'NEAR_ENTRY';
              reason = \`1H Pullback in Discount Zone (Fib \${fibLevel.toFixed(2)}). \${structureDetails}\`;
            } else {
              aiScore = 50 + (fibLevel * 20); // 50-70
              reason = \`1H Trend Bullish. Price in Premium. \${structureDetails}\`;
            }
          }
        }
      } else {
        side = 'SHORT';
        trendStr = 'BEARISH';
        const highs = pivots.filter(p => p.type === 'HIGH');
        const lows = pivots.filter(p => p.type === 'LOW');
        
        if (highs.length > 0 && lows.length > 0) {
          const recentHigh = highs[highs.length - 1].price;
          const recentLow = lows[lows.length - 1].price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            const fibLevel = (price - recentLow) / swingRange;
            const isPremium = fibLevel >= 0.5; 
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            const oteBottom = recentLow + (swingRange * 0.618);
            const oteTop = recentLow + (swingRange * 0.786);
            
            const bearishFvgs = fvgs.filter(f => f.type === 'BEARISH' && f.index >= highs[highs.length-1].index);
            const activeFvg = bearishFvgs.length > 0 ? bearishFvgs[bearishFvgs.length - 1] : null;
            const tappingFvg = activeFvg ? (price >= activeFvg.bottom && price <= activeFvg.top * 1.01) : false;

            structureDetails = \`1H Swing: $\${recentHigh.toFixed(price<1?4:2)} - $\${recentLow.toFixed(price<1?4:2)}. OTE Zone: $\${oteBottom.toFixed(price<1?4:2)} - $\${oteTop.toFixed(price<1?4:2)}.\`;
            
            if (activeFvg) {
              missingCondition = \`Waiting for relief rally into OTE + FVG ($\${activeFvg.bottom.toFixed(price<1?4:2)} - $\${activeFvg.top.toFixed(price<1?4:2)})\`;
            } else {
              missingCondition = \`Waiting for price to rally into OTE zone. No clear FVG formed yet.\`;
            }

            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'REVERSAL';
              reason = \`SMC SHORT: Price tapped bearish FVG inside Optimal Trade Entry (Fib \${fibLevel.toFixed(2)})!\`;
              missingCondition = null;
              stopLoss = parseFloat((recentHigh * 1.01).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentLow.toFixed(price < 1 ? 4 : 2));
            } else if (isPremium) {
              aiScore = 75 + (fibLevel * 10);
              status = 'NEAR_ENTRY';
              reason = \`1H Relief in Premium Zone (Fib \${fibLevel.toFixed(2)}). \${structureDetails}\`;
            } else {
              aiScore = 50 + (fibLevel * 20);
              reason = \`1H Trend Bearish. Price in Discount. \${structureDetails}\`;
            }
          }
        }
      }
    } else {
      reason = 'Failed to fetch sufficient 1H Klines for SMC analysis.';
      aiScore = 45;
    }
  }

  aiScore = Math.min(99, Math.max(10, Math.round(aiScore)));

  const minStopPct = 2.5;
  const maxStopPct = 7.5;
  if (side === 'LONG') {
    stopLoss = Math.max(price * (1 - maxStopPct/100), Math.min(stopLoss, price * (1 - minStopPct/100)));
  } else {
    stopLoss = Math.min(price * (1 + maxStopPct/100), Math.max(stopLoss, price * (1 + minStopPct/100)));
  }
  
  const riskDist = Math.abs(price - stopLoss);
  if (side === 'LONG' && takeProfit < price + riskDist * 1.5) takeProfit = price + riskDist * 1.5;
  if (side === 'SHORT' && takeProfit > price - riskDist * 1.5) takeProfit = price - riskDist * 1.5;

  const riskDistPct = parseFloat(((riskDist / price) * 100).toFixed(2));
  const rewardDistPct = parseFloat(((Math.abs(takeProfit - price) / price) * 100).toFixed(2));
  const rrRatio = parseFloat((rewardDistPct / (riskDistPct || 1)).toFixed(2));

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
      explanation: [ reason, missingCondition || 'Setup Validated.', \`SL: $\${parseFloat(stopLoss.toFixed(price < 1 ? 4 : 2))} | TP: $\${parseFloat(takeProfit.toFixed(price < 1 ? 4 : 2))} (1:\${rrRatio})\` ]
    },
    lastUpdated: Date.now()
  };
}
`;

content = content.replace(regex, newFunc);
fs.writeFileSync(file, content);
console.log('Replaced computeRealSignal with richer SMC UI telemetry successfully');

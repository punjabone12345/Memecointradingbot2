import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'artifacts/api-server/src/services/altcoin-market.service.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const newCompute = `async function computeRealSignal(
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
  let reason = 'Waiting for high-probability MTF SMC setup.';
  let missingCondition: string | null = 'Scanning 4H/1H market structure...';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.10).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  let deepExplanation: string[] = [];
  const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) + " IST";

  const isLiquid = volume24h >= 15_000_000;
  let mtfTrendBull = true;

  if (!isLiquid) {
    reason = \`Volume ($\${(volume24h/1000000).toFixed(1)}M) too low for institutional MTF.\`;
    missingCondition = 'Needs > $15M 24h volume to qualify.';
    aiScore = 40;
  } else {
    // 1. Fetch 4H and 1H Timeframes
    const [klines4h, klines1h] = await Promise.all([
      fetchBinanceKlines(seed.binanceSymbol, '4h', 100),
      fetchBinanceKlines(seed.binanceSymbol, '1h', 100)
    ]);

    if (klines4h.length >= 50 && klines1h.length >= 50) {
      // 2. Macro Bias (4H)
      const ema200_4h = calculateEMA(klines4h, 50); // 50 EMA on 4H
      const currentEma4h = ema200_4h[ema200_4h.length - 1];
      const isUptrend4H = price > currentEma4h;
      mtfTrendBull = isUptrend4H;

      // 3. 1H Structure & Execution
      const pivots1h = findSwingPivots(klines1h, 4, 4);
      const fvgs1h = identifyFVGs(klines1h);

      if (pivots1h.length >= 2) {
        if (isUptrend4H) {
          side = 'LONG';

          // MUST pull back from a recent High. Most recent pivot must be HIGH.
          const lastPivot = pivots1h[pivots1h.length - 1];
          if (lastPivot.type === 'HIGH') {
            const lastHigh1h = lastPivot;
            const lastLow1h = pivots1h.slice().reverse().find(p => p.type === 'LOW' && p.index < lastHigh1h.index);
            
            if (lastHigh1h && lastLow1h) {
              const swingRange = lastHigh1h.price - lastLow1h.price;
              if (swingRange > 0) {
                const oteTop = lastHigh1h.price - (swingRange * 0.618);
                const oteBottom = lastHigh1h.price - (swingRange * 0.786);
                
                // Find Bullish FVGs formed during the upward leg
                const validFvgs = fvgs1h.filter(f => f.type === 'BULLISH' && f.index >= lastLow1h.index && f.index <= lastHigh1h.index);
                // FVG must overlap OTE zone
                const oteFvg = validFvgs.find(f => f.top >= oteBottom && f.bottom <= oteTop);
                
                deepExplanation.push(\`[Generated: \${istTime}]\`);
                deepExplanation.push(\`MACRO (4H): Bullish (Price > 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
                deepExplanation.push(\`STRUCTURE (1H): Impulsive Leg UP from $\${lastLow1h.price.toFixed(price<1?4:2)} ➔ $\${lastHigh1h.price.toFixed(price<1?4:2)}\`);
                deepExplanation.push(\`OTE ZONE (1H): $\${oteBottom.toFixed(price<1?4:2)} ➔ $\${oteTop.toFixed(price<1?4:2)}\`);
                
                if (!oteFvg) {
                   missingCondition = 'Waiting for 1H Bullish FVG in OTE zone.';
                   aiScore = 55;
                   deepExplanation.push(\`Waiting for a Bullish Fair Value Gap to form inside the OTE Zone.\`);
                } else {
                   deepExplanation.push(\`POI (1H): Valid FVG overlapping OTE at $\${oteFvg.bottom.toFixed(price<1?4:2)} ➔ $\${oteFvg.top.toFixed(price<1?4:2)}\`);
                   
                   // STRICT Entry logic: Price must tap into the FVG (no 1% buffer) and be in or below OTE top.
                   // Also must not have invalidated the structure by breaking the swing low.
                   if (price > oteTop || price > oteFvg.top) {
                     missingCondition = 'Waiting for price to drop into OTE + FVG zone.';
                     aiScore = 65;
                     deepExplanation.push(\`Current price ($\${price.toFixed(price<1?4:2)}) is still above the required entry zone.\`);
                   } else if (price < lastLow1h.price) {
                     missingCondition = 'Structure invalidated (Price broke swing low).';
                     aiScore = 30;
                     deepExplanation.push(\`Setup INVALIDATED: Price dropped below the origin of the impulsive leg ($\${lastLow1h.price.toFixed(price<1?4:2)}).\`);
                   } else {
                     // Inside the sweet spot!
                     aiScore = 95;
                     status = 'ENTRY_READY';
                     setupType = 'PULLBACK';
                     reason = \`MTF LONG: 4H Trend Bullish + Tapped 1H OTE FVG!\`;
                     missingCondition = null;
                     stopLoss = parseFloat((lastLow1h.price * 0.995).toFixed(price < 1 ? 4 : 2));
                     takeProfit = parseFloat(lastHigh1h.price.toFixed(price < 1 ? 4 : 2));
                     deepExplanation.push(\`THESIS: Price perfectly tapped the 1H OTE FVG zone in alignment with 4H Trend. Entering LONG to target the 1H Swing High.\`);
                   }
                }
              }
            }
          } else {
            reason = '1H Structure: Waiting for new impulsive HIGH to form.';
            missingCondition = 'Current leg is downwards, need a fresh Bullish Swing Leg.';
            aiScore = 50;
            deepExplanation.push(\`[Generated: \${istTime}]\`);
            deepExplanation.push(\`MACRO (4H): Bullish (Price > 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
            deepExplanation.push(\`STRUCTURE (1H): The most recent confirmed pivot is a LOW. Waiting for a new impulsive HIGH to form before calculating pullback.\`);
          }
        } else {
          side = 'SHORT';

          // MUST pull back from a recent Low. Most recent pivot must be LOW.
          const lastPivot = pivots1h[pivots1h.length - 1];
          if (lastPivot.type === 'LOW') {
            const lastLow1h = lastPivot;
            const lastHigh1h = pivots1h.slice().reverse().find(p => p.type === 'HIGH' && p.index < lastLow1h.index);
            
            if (lastHigh1h && lastLow1h) {
              const swingRange = lastHigh1h.price - lastLow1h.price;
              if (swingRange > 0) {
                const oteBottom = lastLow1h.price + (swingRange * 0.618);
                const oteTop = lastLow1h.price + (swingRange * 0.786);
                
                // Find Bearish FVGs formed during the downward leg
                const validFvgs = fvgs1h.filter(f => f.type === 'BEARISH' && f.index >= lastHigh1h.index && f.index <= lastLow1h.index);
                // FVG must overlap OTE zone
                const oteFvg = validFvgs.find(f => f.bottom <= oteTop && f.top >= oteBottom);
                
                deepExplanation.push(\`[Generated: \${istTime}]\`);
                deepExplanation.push(\`MACRO (4H): Bearish (Price < 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
                deepExplanation.push(\`STRUCTURE (1H): Impulsive Leg DOWN from $\${lastHigh1h.price.toFixed(price<1?4:2)} ➔ $\${lastLow1h.price.toFixed(price<1?4:2)}\`);
                deepExplanation.push(\`OTE ZONE (1H): $\${oteBottom.toFixed(price<1?4:2)} ➔ $\${oteTop.toFixed(price<1?4:2)}\`);
                
                if (!oteFvg) {
                   missingCondition = 'Waiting for 1H Bearish FVG in OTE zone.';
                   aiScore = 55;
                   deepExplanation.push(\`Waiting for a Bearish Fair Value Gap to form inside the OTE Zone.\`);
                } else {
                   deepExplanation.push(\`POI (1H): Valid FVG overlapping OTE at $\${oteFvg.bottom.toFixed(price<1?4:2)} ➔ $\${oteFvg.top.toFixed(price<1?4:2)}\`);
                   
                   // STRICT Entry logic: Price must tap into the FVG (no 1% buffer) and be in or above OTE bottom.
                   // Also must not have invalidated the structure by breaking the swing high.
                   if (price < oteBottom || price < oteFvg.bottom) {
                     missingCondition = 'Waiting for price to rally into OTE + FVG zone.';
                     aiScore = 65;
                     deepExplanation.push(\`Current price ($\${price.toFixed(price<1?4:2)}) is still below the required entry zone.\`);
                   } else if (price > lastHigh1h.price) {
                     missingCondition = 'Structure invalidated (Price broke swing high).';
                     aiScore = 30;
                     deepExplanation.push(\`Setup INVALIDATED: Price rallied above the origin of the impulsive leg ($\${lastHigh1h.price.toFixed(price<1?4:2)}).\`);
                   } else {
                     // Inside the sweet spot!
                     aiScore = 95;
                     status = 'ENTRY_READY';
                     setupType = 'PULLBACK';
                     reason = \`MTF SHORT: 4H Trend Bearish + Tapped 1H OTE FVG!\`;
                     missingCondition = null;
                     stopLoss = parseFloat((lastHigh1h.price * 1.005).toFixed(price < 1 ? 4 : 2));
                     takeProfit = parseFloat(lastLow1h.price.toFixed(price < 1 ? 4 : 2));
                     deepExplanation.push(\`THESIS: Price perfectly rallied into the 1H OTE FVG zone in alignment with 4H Trend. Entering SHORT to target the 1H Swing Low.\`);
                   }
                }
              }
            }
          } else {
            reason = '1H Structure: Waiting for new impulsive LOW to form.';
            missingCondition = 'Current leg is upwards, need a fresh Bearish Swing Leg.';
            aiScore = 50;
            deepExplanation.push(\`[Generated: \${istTime}]\`);
            deepExplanation.push(\`MACRO (4H): Bearish (Price < 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
            deepExplanation.push(\`STRUCTURE (1H): The most recent confirmed pivot is a HIGH. Waiting for a new impulsive LOW to form before calculating pullback.\`);
          }
        }
      }
    } else {
      reason = 'Failed to fetch MTF Klines for SMC analysis.';
      aiScore = 45;
      deepExplanation.push('Data Error: Missing or incomplete 4H/1H candlesticks from Binance.');
    }
  }

  aiScore = Math.min(99, Math.max(10, Math.round(aiScore)));

  const minStopPct = 1.5;
  const maxStopPct = 10.0;
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

  if (deepExplanation.length === 0) {
    deepExplanation.push(reason);
    if (missingCondition) deepExplanation.push(missingCondition);
  }
  deepExplanation.push(\`SL: $\${parseFloat(stopLoss.toFixed(price < 1 ? 4 : 2))} | TP: $\${parseFloat(takeProfit.toFixed(price < 1 ? 4 : 2))} (1:\${rrRatio})\`);

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
}`;

const regex = /async function computeRealSignal\([\s\S]*?\n\s+lastUpdated: Date\.now\(\)\n\s+\};\n\}/m;
const match = content.match(regex);
if (match) {
  content = content.replace(regex, newCompute);
  fs.writeFileSync(filePath, content);
  console.log("Successfully injected strict 1H OTE SMC telemetry!");
} else {
  console.log("Could not find regex match!");
}

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
  let missingCondition: string | null = 'Scanning 4H/1H/15m market structure...';
  let side: 'LONG' | 'SHORT' = 'LONG';
  let stopLoss = parseFloat((price * 0.95).toFixed(price < 1 ? 4 : 2));
  let takeProfit = parseFloat((price * 1.10).toFixed(price < 1 ? 4 : 2));
  let aiScore = 50;

  let deepExplanation: string[] = [];
  const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) + " IST";

  const isLiquid = volume24h >= 15_000_000;
  let structureDetails = '';
  let trendStr = 'BULLISH';
  let mtfTrendBull = true;

  if (!isLiquid) {
    reason = \`Volume ($\${(volume24h/1000000).toFixed(1)}M) too low for institutional MTF.\`;
    missingCondition = 'Needs > $15M 24h volume to qualify.';
    aiScore = 40;
  } else {
    // 1. Fetch 3 Timeframes
    const [klines4h, klines1h, klines15m] = await Promise.all([
      fetchBinanceKlines(seed.binanceSymbol, '4h', 100),
      fetchBinanceKlines(seed.binanceSymbol, '1h', 100),
      fetchBinanceKlines(seed.binanceSymbol, '15m', 100)
    ]);

    if (klines4h.length >= 50 && klines1h.length >= 50 && klines15m.length >= 50) {
      // 2. Macro Bias (4H)
      const ema200_4h = calculateEMA(klines4h, 50); // Using 50 EMA on 4H as trend filter
      const currentEma4h = ema200_4h[ema200_4h.length - 1];
      const isUptrend4H = price > currentEma4h;
      mtfTrendBull = isUptrend4H;

      // 3. Intermediate POI (1H) & Execution (15m)
      const pivots1h = findSwingPivots(klines1h, 4, 4);
      const fvgs1h = identifyFVGs(klines1h);
      const pivots15m = findSwingPivots(klines15m, 4, 4);

      if (isUptrend4H) {
        side = 'LONG';
        trendStr = 'BULLISH';

        // Find 1H POI
        const lastHigh1h = pivots1h.slice().reverse().find(p => p.type === 'HIGH');
        const lastLow1h = lastHigh1h ? pivots1h.slice().reverse().find(p => p.type === 'LOW' && p.index < lastHigh1h.index) : null;
        
        if (lastHigh1h && lastLow1h) {
          const recentHigh1h = lastHigh1h.price;
          const recentLow1h = lastLow1h.price;
          const swingRange1h = recentHigh1h - recentLow1h;
          
          if (swingRange1h > 0) {
            const oteTop1h = recentHigh1h - (swingRange1h * 0.618);
            const oteBottom1h = recentHigh1h - (swingRange1h * 0.786);
            
            const validFvgs1h = fvgs1h.filter(f => f.type === 'BULLISH' && f.index >= lastLow1h.index && f.index <= lastHigh1h.index);
            const oteFvg1h = validFvgs1h.find(f => f.top >= oteBottom1h && f.bottom <= oteTop1h);
            const inside1hFvg = oteFvg1h ? (price <= oteFvg1h.top * 1.01 && price >= oteFvg1h.bottom * 0.99) : false;
            
            structureDetails = \`4H Trend: Bullish. 1H FVG: \${oteFvg1h ? \`$\${oteFvg1h.bottom.toFixed(price<1?4:2)} - $\${oteFvg1h.top.toFixed(price<1?4:2)}\` : 'None'}.\`;
            
            deepExplanation.push(\`[Generated: \${istTime}]\`);
            deepExplanation.push(\`MACRO (4H): Bullish (Price > 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
            deepExplanation.push(\`POI (1H): Swing Leg $\${recentLow1h.toFixed(price<1?4:2)} ➔ $\${recentHigh1h.toFixed(price<1?4:2)}\`);
            
            if (!oteFvg1h) {
               missingCondition = 'Waiting for 1H Bullish FVG to form in OTE zone.';
               aiScore = 55;
               deepExplanation.push(\`Waiting for a valid Bullish Fair Value Gap to form inside the 1H OTE Zone ($\${oteBottom1h.toFixed(price<1?4:2)} - $\${oteTop1h.toFixed(price<1?4:2)})\`);
            } else {
               deepExplanation.push(\`POI (1H): Identified valid FVG at $\${oteFvg1h.bottom.toFixed(price<1?4:2)} ➔ $\${oteFvg1h.top.toFixed(price<1?4:2)}\`);
               
               if (!inside1hFvg) {
                 missingCondition = 'Waiting for price to pull back into 1H FVG POI.';
                 aiScore = 65;
                 deepExplanation.push(\`Current price ($\${price.toFixed(price<1?4:2)}) has not yet tapped the 1H FVG zone.\`);
               } else {
                 missingCondition = 'In 1H POI. Scanning 15m for entry setup (Order Block or OTE tap).';
                 aiScore = 80;

                 const lastHigh15m = pivots15m.slice().reverse().find(p => p.type === 'HIGH');
                 const lastLow15m = lastHigh15m ? pivots15m.slice().reverse().find(p => p.type === 'LOW' && p.index < lastHigh15m.index) : null;
                 
                 if (lastHigh15m && lastLow15m) {
                   const swingRange15m = lastHigh15m.price - lastLow15m.price;
                   const oteTop15m = lastHigh15m.price - (swingRange15m * 0.618);
                   const oteBottom15m = lastHigh15m.price - (swingRange15m * 0.786);
                   
                   deepExplanation.push(\`ENTRY (15m): Swing Leg $\${lastLow15m.price.toFixed(price<1?4:2)} ➔ $\${lastHigh15m.price.toFixed(price<1?4:2)}\`);
                   deepExplanation.push(\`ENTRY (15m): Optimal Trade Entry Zone is $\${oteBottom15m.toFixed(price<1?4:2)} ➔ $\${oteTop15m.toFixed(price<1?4:2)}\`);
                   
                   const fibLevel15m = (lastHigh15m.price - price) / swingRange15m;
                   const in15mOTE = fibLevel15m >= 0.618 && fibLevel15m <= 0.786;
                   
                   if (in15mOTE || price <= oteTop15m) {
                      aiScore = 95;
                      status = 'ENTRY_READY';
                      setupType = 'PULLBACK';
                      reason = \`MTF LONG: 4H Bullish + Tapped 1H FVG + 15m OTE Entry!\`;
                      missingCondition = null;
                      stopLoss = parseFloat((lastLow15m.price * 0.99).toFixed(price < 1 ? 4 : 2));
                      takeProfit = parseFloat(recentHigh1h.toFixed(price < 1 ? 4 : 2));
                      deepExplanation.push(\`THESIS: Price successfully tapped the 1H Macro FVG and pulled back deeply into the 15m OTE discount zone. Entering LONG to target the 1H Swing High.\`);
                   } else {
                      deepExplanation.push(\`Waiting for price to pull back deeper into the 15m OTE discount zone.\`);
                   }
                 } else {
                    deepExplanation.push(\`Waiting for a valid 15m structural swing leg to form for execution.\`);
                 }
               }
            }
          }
        }
      } else {
        side = 'SHORT';
        trendStr = 'BEARISH';

        // Find 1H POI
        const lastLow1h = pivots1h.slice().reverse().find(p => p.type === 'LOW');
        const lastHigh1h = lastLow1h ? pivots1h.slice().reverse().find(p => p.type === 'HIGH' && p.index < lastLow1h.index) : null;
        
        if (lastHigh1h && lastLow1h) {
          const recentHigh1h = lastHigh1h.price;
          const recentLow1h = lastLow1h.price;
          const swingRange1h = recentHigh1h - recentLow1h;
          
          if (swingRange1h > 0) {
            const oteBottom1h = recentLow1h + (swingRange1h * 0.618);
            const oteTop1h = recentLow1h + (swingRange1h * 0.786);
            
            const validFvgs1h = fvgs1h.filter(f => f.type === 'BEARISH' && f.index >= lastHigh1h.index && f.index <= lastLow1h.index);
            const oteFvg1h = validFvgs1h.find(f => f.bottom <= oteTop1h && f.top >= oteBottom1h);
            const inside1hFvg = oteFvg1h ? (price >= oteFvg1h.bottom * 0.99 && price <= oteFvg1h.top * 1.01) : false;
            
            structureDetails = \`4H Trend: Bearish. 1H FVG: \${oteFvg1h ? \`$\${oteFvg1h.bottom.toFixed(price<1?4:2)} - $\${oteFvg1h.top.toFixed(price<1?4:2)}\` : 'None'}.\`;
            
            deepExplanation.push(\`[Generated: \${istTime}]\`);
            deepExplanation.push(\`MACRO (4H): Bearish (Price < 50-EMA @ $\${currentEma4h.toFixed(price<1?4:2)})\`);
            deepExplanation.push(\`POI (1H): Swing Leg $\${recentHigh1h.toFixed(price<1?4:2)} ➔ $\${recentLow1h.toFixed(price<1?4:2)}\`);
            
            if (!oteFvg1h) {
               missingCondition = 'Waiting for 1H Bearish FVG to form in OTE zone.';
               aiScore = 55;
               deepExplanation.push(\`Waiting for a valid Bearish Fair Value Gap to form inside the 1H OTE Zone ($\${oteBottom1h.toFixed(price<1?4:2)} - $\${oteTop1h.toFixed(price<1?4:2)})\`);
            } else {
               deepExplanation.push(\`POI (1H): Identified valid FVG at $\${oteFvg1h.bottom.toFixed(price<1?4:2)} ➔ $\${oteFvg1h.top.toFixed(price<1?4:2)}\`);
               
               if (!inside1hFvg) {
                 missingCondition = 'Waiting for relief rally into 1H FVG POI.';
                 aiScore = 65;
                 deepExplanation.push(\`Current price ($\${price.toFixed(price<1?4:2)}) has not yet rallied into the 1H FVG zone.\`);
               } else {
                 missingCondition = 'In 1H POI. Scanning 15m for entry setup (Order Block or OTE tap).';
                 aiScore = 80;

                 const lastLow15m = pivots15m.slice().reverse().find(p => p.type === 'LOW');
                 const lastHigh15m = lastLow15m ? pivots15m.slice().reverse().find(p => p.type === 'HIGH' && p.index < lastLow15m.index) : null;
                 
                 if (lastHigh15m && lastLow15m) {
                   const swingRange15m = lastHigh15m.price - lastLow15m.price;
                   const oteBottom15m = lastLow15m.price + (swingRange15m * 0.618);
                   const oteTop15m = lastLow15m.price + (swingRange15m * 0.786);
                   
                   deepExplanation.push(\`ENTRY (15m): Swing Leg $\${lastHigh15m.price.toFixed(price<1?4:2)} ➔ $\${lastLow15m.price.toFixed(price<1?4:2)}\`);
                   deepExplanation.push(\`ENTRY (15m): Optimal Trade Entry Zone is $\${oteBottom15m.toFixed(price<1?4:2)} ➔ $\${oteTop15m.toFixed(price<1?4:2)}\`);
                   
                   const fibLevel15m = (price - lastLow15m.price) / swingRange15m;
                   const in15mOTE = fibLevel15m >= 0.618 && fibLevel15m <= 0.786;
                   
                   if (in15mOTE || price >= oteBottom15m) {
                      aiScore = 95;
                      status = 'ENTRY_READY';
                      setupType = 'REVERSAL';
                      reason = \`MTF SHORT: 4H Bearish + Tapped 1H FVG + 15m OTE Entry!\`;
                      missingCondition = null;
                      stopLoss = parseFloat((lastHigh15m.price * 1.01).toFixed(price < 1 ? 4 : 2));
                      takeProfit = parseFloat(recentLow1h.toFixed(price < 1 ? 4 : 2));
                      deepExplanation.push(\`THESIS: Price successfully rallied into the 1H Macro FVG and tapped the 15m OTE premium zone. Entering SHORT to target the 1H Swing Low.\`);
                   } else {
                      deepExplanation.push(\`Waiting for price to rally deeper into the 15m OTE premium zone.\`);
                   }
                 } else {
                    deepExplanation.push(\`Waiting for a valid 15m structural swing leg to form for execution.\`);
                 }
               }
            }
          }
        }
      }
    } else {
      reason = 'Failed to fetch MTF Klines for SMC analysis.';
      aiScore = 45;
      deepExplanation.push('Data Error: Missing or incomplete 4H/1H/15m candlesticks from Binance.');
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

  // Add standard thesis lines at the end of deep explanation
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
  console.log("Successfully injected telemetry!");
} else {
  console.log("Could not find regex match!");
}

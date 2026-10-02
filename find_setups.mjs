import axios from 'axios';

async function fetchKlines(symbol, interval) {
  const res = await axios.get(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`);
  return res.data.map(d => ({
    timestamp: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4])
  }));
}

function calculateEMA(klines, period) {
  const ema = new Array(klines.length).fill(0);
  const k = 2 / (period + 1);
  ema[0] = klines[0].close;
  for (let i = 1; i < klines.length; i++) {
    ema[i] = (klines[i].close * k) + (ema[i - 1] * (1 - k));
  }
  return ema;
}

function findSwingPivots(klines, leftBars = 4, rightBars = 4) {
  const pivots = [];
  for (let i = leftBars; i < klines.length - rightBars; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= leftBars; j++) {
      if (klines[i - j].high > klines[i].high) isHigh = false;
      if (klines[i - j].low < klines[i].low) isLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (klines[i + j].high >= klines[i].high) isHigh = false;
      if (klines[i + j].low <= klines[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ type: 'HIGH', index: i, price: klines[i].high, time: new Date(klines[i].timestamp).toLocaleString() });
    if (isLow) pivots.push({ type: 'LOW', index: i, price: klines[i].low, time: new Date(klines[i].timestamp).toLocaleString() });
  }
  return pivots;
}

function identifyFVGs(klines) {
  const fvgs = [];
  for (let i = 2; i < klines.length; i++) {
    if (klines[i - 2].high < klines[i].low && klines[i-1].close > klines[i-1].open) {
      fvgs.push({ type: 'BULLISH', index: i - 1, bottom: klines[i - 2].high, top: klines[i].low });
    }
    if (klines[i - 2].low > klines[i].high && klines[i-1].close < klines[i-1].open) {
      fvgs.push({ type: 'BEARISH', index: i - 1, top: klines[i - 2].low, bottom: klines[i].high });
    }
  }
  return fvgs;
}

async function analyze() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'LINKUSDT'];
  for (const sym of symbols) {
    try {
      const k4h = await fetchKlines(sym, '4h');
      const k1h = await fetchKlines(sym, '1h');
      
      const ema4h = calculateEMA(k4h, 50);
      const isBullish = k4h[k4h.length-1].close > ema4h[ema4h.length-1];
      
      const pivots = findSwingPivots(k1h);
      const fvgs = identifyFVGs(k1h);
      
      console.log(`\n--- ${sym} (${isBullish ? 'LONG' : 'SHORT'}) ---`);
      
      if (isBullish) {
         let found = false;
         // find most recent valid setup in the past
         for(let i = pivots.length-1; i >= 1; i--) {
            if (pivots[i].type === 'HIGH' && pivots[i-1].type === 'LOW') {
               const high = pivots[i];
               const low = pivots[i-1];
               const range = high.price - low.price;
               const oteTop = high.price - (range * 0.618);
               const oteBottom = high.price - (range * 0.786);
               
               const validFvgs = fvgs.filter(f => f.type === 'BULLISH' && f.index >= low.index && f.index <= high.index);
               const fvg = validFvgs.find(f => f.top >= oteBottom && f.bottom <= oteTop);
               
               if (fvg) {
                 console.log(`Leg: Low ${low.price} (${low.time}) -> High ${high.price} (${high.time})`);
                 console.log(`OTE: ${oteBottom.toFixed(4)} - ${oteTop.toFixed(4)}`);
                 console.log(`FVG: ${fvg.bottom.toFixed(4)} - ${fvg.top.toFixed(4)}`);
                 found = true;
                 
                 // check if price pulled back into it
                 let triggered = false;
                 for(let j = high.index + 1; j < k1h.length; j++) {
                    if (k1h[j].low <= oteTop && k1h[j].low <= fvg.top) {
                       triggered = true;
                       console.log(`-> Triggered entry at candle ${new Date(k1h[j].timestamp).toLocaleString()} (Low hit ${k1h[j].low})`);
                       // check tp/sl
                       for(let k = j+1; k < k1h.length; k++) {
                          if (k1h[k].low <= low.price) { console.log(`   -> Hit SL at ${new Date(k1h[k].timestamp).toLocaleString()}`); break; }
                          if (k1h[k].high >= high.price) { console.log(`   -> Hit TP at ${new Date(k1h[k].timestamp).toLocaleString()}`); break; }
                       }
                       break;
                    }
                 }
                 if(!triggered) console.log(`-> Waiting for pullback.`);
                 break;
               }
            }
         }
      } else {
         let found = false;
         for(let i = pivots.length-1; i >= 1; i--) {
            if (pivots[i].type === 'LOW' && pivots[i-1].type === 'HIGH') {
               const low = pivots[i];
               const high = pivots[i-1];
               const range = high.price - low.price;
               const oteBottom = low.price + (range * 0.618);
               const oteTop = low.price + (range * 0.786);
               
               const validFvgs = fvgs.filter(f => f.type === 'BEARISH' && f.index >= high.index && f.index <= low.index);
               const fvg = validFvgs.find(f => f.bottom <= oteTop && f.top >= oteBottom);
               
               if (fvg) {
                 console.log(`Leg: High ${high.price} (${high.time}) -> Low ${low.price} (${low.time})`);
                 console.log(`OTE: ${oteBottom.toFixed(4)} - ${oteTop.toFixed(4)}`);
                 console.log(`FVG: ${fvg.bottom.toFixed(4)} - ${fvg.top.toFixed(4)}`);
                 found = true;
                 
                 let triggered = false;
                 for(let j = low.index + 1; j < k1h.length; j++) {
                    if (k1h[j].high >= oteBottom && k1h[j].high >= fvg.bottom) {
                       triggered = true;
                       console.log(`-> Triggered entry at candle ${new Date(k1h[j].timestamp).toLocaleString()} (High hit ${k1h[j].high})`);
                       for(let k = j+1; k < k1h.length; k++) {
                          if (k1h[k].high >= high.price) { console.log(`   -> Hit SL at ${new Date(k1h[k].timestamp).toLocaleString()}`); break; }
                          if (k1h[k].low <= low.price) { console.log(`   -> Hit TP at ${new Date(k1h[k].timestamp).toLocaleString()}`); break; }
                       }
                       break;
                    }
                 }
                 if(!triggered) console.log(`-> Waiting for pullback.`);
                 break;
               }
            }
         }
      }
    } catch(e) {
      console.log('Error on', sym, e.message);
    }
  }
}

analyze();

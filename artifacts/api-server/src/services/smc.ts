export interface Kline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SwingPivot {
  type: 'HIGH' | 'LOW';
  index: number;
  price: number;
  timestamp: number;
}

export interface FVG {
  type: 'BULLISH' | 'BEARISH';
  index: number;
  top: number;
  bottom: number;
}

export function calculateEMA(klines: Kline[], period: number): number[] {
  const ema = new Array(klines.length).fill(0);
  if (klines.length === 0) return ema;
  const k = 2 / (period + 1);
  ema[0] = klines[0].close;
  for (let i = 1; i < klines.length; i++) {
    ema[i] = (klines[i].close * k) + (ema[i - 1] * (1 - k));
  }
  return ema;
}

export function findSwingPivots(klines: Kline[], leftBars = 3, rightBars = 3): SwingPivot[] {
  const pivots: SwingPivot[] = [];
  for (let i = leftBars; i < klines.length - rightBars; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= leftBars; j++) {
      if (klines[i - j].high > klines[i].high) isHigh = false;
      if (klines[i - j].low < klines[i].low) isLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (klines[i + j].high >= klines[i].high) isHigh = false; // >= to ignore flat tops
      if (klines[i + j].low <= klines[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ type: 'HIGH', index: i, price: klines[i].high, timestamp: klines[i].timestamp });
    if (isLow) pivots.push({ type: 'LOW', index: i, price: klines[i].low, timestamp: klines[i].timestamp });
  }
  return pivots;
}

export function identifyFVGs(klines: Kline[]): FVG[] {
  const fvgs: FVG[] = [];
  for (let i = 2; i < klines.length; i++) {
    // Bullish FVG: Bar 1 High < Bar 3 Low
    if (klines[i - 2].high < klines[i].low && klines[i-1].close > klines[i-1].open) {
      fvgs.push({ type: 'BULLISH', index: i - 1, bottom: klines[i - 2].high, top: klines[i].low });
    }
    // Bearish FVG: Bar 1 Low > Bar 3 High
    if (klines[i - 2].low > klines[i].high && klines[i-1].close < klines[i-1].open) {
      fvgs.push({ type: 'BEARISH', index: i - 1, top: klines[i - 2].low, bottom: klines[i].high });
    }
  }
  return fvgs;
}

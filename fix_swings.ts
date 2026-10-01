import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'artifacts/api-server/src/services/altcoin-market.service.ts');
let content = fs.readFileSync(file, 'utf-8');

const regex = /if \(isUptrend\) \{[\s\S]*?\} else \{[\s\S]*?side = 'SHORT';[\s\S]*?\}\s*\}/;

const newLogic = \`if (isUptrend) {
        side = 'LONG';
        trendStr = 'BULLISH';
        
        // Find valid Bullish Leg: A recent Low followed by a recent High
        const lastHigh = pivots.slice().reverse().find(p => p.type === 'HIGH');
        const lastLow = lastHigh ? pivots.slice().reverse().find(p => p.type === 'LOW' && p.index < lastHigh.index) : null;
        
        if (lastHigh && lastLow) {
          const recentHigh = lastHigh.price;
          const recentLow = lastLow.price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            const fibLevel = (recentHigh - price) / swingRange;
            const isDiscount = fibLevel >= 0.5;
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            const oteTop = recentHigh - (swingRange * 0.618);
            const oteBottom = recentHigh - (swingRange * 0.786);
            
            // FVG must overlap with OTE zone
            const validFvgs = fvgs.filter(f => f.type === 'BULLISH' && f.index >= lastLow.index && f.index <= lastHigh.index);
            const oteFvg = validFvgs.find(f => f.top >= oteBottom && f.bottom <= oteTop); // Overlap check
            
            const tappingFvg = oteFvg ? (price <= oteFvg.top && price >= oteFvg.bottom * 0.99) : false;

            structureDetails = \\\`1H Swing: $\\\${recentLow.toFixed(price<1?4:2)} - $\\\${recentHigh.toFixed(price<1?4:2)}. OTE Zone: $\\\${oteBottom.toFixed(price<1?4:2)} - $\\\${oteTop.toFixed(price<1?4:2)}.\\\`;
            
            if (oteFvg) {
              missingCondition = \\\`Waiting for pullback into OTE + FVG ($\\\${oteFvg.bottom.toFixed(price<1?4:2)} - $\\\${oteFvg.top.toFixed(price<1?4:2)})\\\`;
            } else {
              missingCondition = \\\`Waiting for price to reach OTE zone. No FVG in OTE.\\\`;
            }

            // Scoring
            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'PULLBACK';
              reason = \\\`SMC LONG: Price tapped bullish FVG inside Optimal Trade Entry (Fib \\\${fibLevel.toFixed(2)})!\\\`;
              missingCondition = null;
              stopLoss = parseFloat((recentLow * 0.99).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentHigh.toFixed(price < 1 ? 4 : 2));
            } else if (isDiscount) {
              aiScore = 75 + (fibLevel * 10);
              status = 'NEAR_ENTRY';
              reason = \\\`1H Pullback in Discount Zone (Fib \\\${fibLevel.toFixed(2)}). \\\${structureDetails}\\\`;
            } else {
              aiScore = 50 + (fibLevel * 20);
              reason = \\\`1H Trend Bullish. Price in Premium. \\\${structureDetails}\\\`;
            }
          }
        }
      } else {
        side = 'SHORT';
        trendStr = 'BEARISH';
        
        // Find valid Bearish Leg: A recent High followed by a recent Low
        const lastLow = pivots.slice().reverse().find(p => p.type === 'LOW');
        const lastHigh = lastLow ? pivots.slice().reverse().find(p => p.type === 'HIGH' && p.index < lastLow.index) : null;
        
        if (lastHigh && lastLow) {
          const recentHigh = lastHigh.price;
          const recentLow = lastLow.price;
          const swingRange = recentHigh - recentLow;
          
          if (swingRange > 0) {
            const fibLevel = (price - recentLow) / swingRange;
            const isPremium = fibLevel >= 0.5; 
            const isOTE = fibLevel >= 0.618 && fibLevel <= 0.786;
            
            const oteBottom = recentLow + (swingRange * 0.618);
            const oteTop = recentLow + (swingRange * 0.786);
            
            // FVG must overlap with OTE zone
            const validFvgs = fvgs.filter(f => f.type === 'BEARISH' && f.index >= lastHigh.index && f.index <= lastLow.index);
            const oteFvg = validFvgs.find(f => f.bottom <= oteTop && f.top >= oteBottom); // Overlap check
            
            const tappingFvg = oteFvg ? (price >= oteFvg.bottom && price <= oteFvg.top * 1.01) : false;

            structureDetails = \\\`1H Swing: $\\\${recentHigh.toFixed(price<1?4:2)} - $\\\${recentLow.toFixed(price<1?4:2)}. OTE Zone: $\\\${oteBottom.toFixed(price<1?4:2)} - $\\\${oteTop.toFixed(price<1?4:2)}.\\\`;
            
            if (oteFvg) {
              missingCondition = \\\`Waiting for relief rally into OTE + FVG ($\\\${oteFvg.bottom.toFixed(price<1?4:2)} - $\\\${oteFvg.top.toFixed(price<1?4:2)})\\\`;
            } else {
              missingCondition = \\\`Waiting for price to rally into OTE zone. No FVG in OTE.\\\`;
            }

            if (isOTE && tappingFvg) {
              aiScore = 95;
              status = 'ENTRY_READY';
              setupType = 'REVERSAL';
              reason = \\\`SMC SHORT: Price tapped bearish FVG inside Optimal Trade Entry (Fib \\\${fibLevel.toFixed(2)})!\\\`;
              missingCondition = null;
              stopLoss = parseFloat((recentHigh * 1.01).toFixed(price < 1 ? 4 : 2));
              takeProfit = parseFloat(recentLow.toFixed(price < 1 ? 4 : 2));
            } else if (isPremium) {
              aiScore = 75 + (fibLevel * 10);
              status = 'NEAR_ENTRY';
              reason = \\\`1H Relief in Premium Zone (Fib \\\${fibLevel.toFixed(2)}). \\\${structureDetails}\\\`;
            } else {
              aiScore = 50 + (fibLevel * 20);
              reason = \\\`1H Trend Bearish. Price in Discount. \\\${structureDetails}\\\`;
            }
          }
        }
      }\`;

content = content.replace(regex, newLogic);
fs.writeFileSync(file, content);
console.log('Fixed sequence bug');

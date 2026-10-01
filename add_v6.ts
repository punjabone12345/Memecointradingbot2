import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'artifacts/api-server/src/lib/db.ts');
let content = fs.readFileSync(file, 'utf-8');

const v6Migration = `
    const resetCheck = await query<{ value: string }>("SELECT value FROM settings WHERE key = 'v6_mtf_settings_reset'").catch(() => []);
    if (resetCheck.length === 0) {
      await queryQuiet("TRUNCATE TABLE paper_positions CASCADE;");
      
      // Enforce the user's explicit requested settings
      await queryQuiet("UPDATE settings SET value = '1000.00' WHERE key = 'startingBalanceUsd'");
      await queryQuiet("UPDATE settings SET value = '1000.00' WHERE key = 'currentBalanceUsd'");
      await queryQuiet("UPDATE settings SET value = '0.1' WHERE key = 'riskPerTradePct'");
      await queryQuiet("UPDATE settings SET value = '10' WHERE key = 'maxOpenPositions'");
      await queryQuiet("UPDATE settings SET value = '1.5' WHERE key = 'minRiskRewardRatio'");
      
      // If any of these didn't exist yet, insert them
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('startingBalanceUsd', '1000.00') ON CONFLICT (key) DO NOTHING");
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('currentBalanceUsd', '1000.00') ON CONFLICT (key) DO NOTHING");
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('riskPerTradePct', '0.1') ON CONFLICT (key) DO NOTHING");
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('maxOpenPositions', '10') ON CONFLICT (key) DO NOTHING");
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('minRiskRewardRatio', '1.5') ON CONFLICT (key) DO NOTHING");
      
      await queryQuiet("INSERT INTO settings (key, value) VALUES ('v6_mtf_settings_reset', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'");
      logger.info('V6 MTF Reset: Portfolio wiped, balance set to $1000, risk 0.1%, max trades 10, min RRR 1.5');
    }
`;

content = content.replace(/const resetCheck = await query<\{ value: string \}>\("SELECT value FROM settings WHERE key = 'v5_strict_trader_reset'"\)[\s\S]*?logger\.info\('V5 Strict Trader Reset: paper_positions cleared and balance reset to \$1000\.00'\);\s*\}/, v6Migration.trim());

fs.writeFileSync(file, content);
console.log('Successfully injected v6 migration');

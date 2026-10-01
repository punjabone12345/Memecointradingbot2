import { resetPaperPortfolio } from './artifacts/api-server/src/services/altcoin-paper.service.js';
import { dbInit } from './artifacts/api-server/src/lib/db.js';

async function run() {
  await dbInit();
  await resetPaperPortfolio(1000);
  console.log("Portfolio reset successfully to $1000");
  process.exit(0);
}
run();

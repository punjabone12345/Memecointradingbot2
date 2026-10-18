import { Router } from 'express';
import { getSettings, updateSettings, resetAllData, getBalance } from '../services/settings.service.js';
import { broadcastBalance, broadcastSettings } from '../websocket/server.js';
import { resetPaperPortfolio } from '../services/altcoin-paper.service.js';
import { applyBotEnabledChange } from '../lib/session-manager.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch settings' });
  }
});

router.patch('/', async (req, res) => {
  try {
    const updates = req.body as Record<string, string>;
    const stringified: Record<string, string> = {};
    for (const [k, v] of Object.entries(updates)) {
      stringified[k] = String(v);
    }
    await updateSettings(stringified);
    const settings = await getSettings();

    // Push updated settings to every connected WS client.
    broadcastSettings().catch(() => { /* non-fatal */ });

    // Apply bot on/off transition if botEnabled changed.
    applyBotEnabledChange().catch(() => { /* non-fatal */ });

    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update settings' });
  }
});

router.post('/reset', async (_req, res) => {
  try {
    await resetAllData();
    await resetPaperPortfolio();
    await broadcastBalance();
    const balance = await getBalance();
    res.json({ success: true, balance });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to reset data' });
  }
});

export default router;

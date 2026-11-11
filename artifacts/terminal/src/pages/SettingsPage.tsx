import { useState, useEffect } from 'react';
import { Settings } from '../lib/types.js';
import { api } from '../lib/api.js';

interface Props {
  settings: Settings;
  onUpdate: (s: Settings) => void;
}

export default function SettingsPage({ settings: init, onUpdate }: Props) {
  const [settings, setSettings] = useState(init);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [testingDelta, setTestingDelta] = useState(false);
  const [deltaTestResult, setDeltaTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!dirty) setSettings(init);
  }, [init, dirty]);

  function update(key: keyof Settings, value: unknown) {
    setDirty(true);
    const updated = { ...settings, [key]: value };
    setSettings(updated);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setDirty(false);
      onUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('❌ Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPortfolio() {
    if (!confirm('Are you sure you want to reset your Paper Trading Portfolio back to $1,000.00 USD? All open/closed paper trades will be cleared.')) return;
    setResetting(true);
    try {
      await api.resetAltcoinPortfolio(settings.startingBalanceUsd || 1000);
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 600, margin: '0 auto' }}>
      
      {/* Header Banner */}
      <div style={{ background: 'linear-gradient(135deg, rgba(0,212,255,0.08) 0%, rgba(155,89,255,0.08) 100%)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 14, padding: '16px' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#00d4ff' }}>
          ⚙️ ALTCOIN PAPER ACCOUNT & RISK SETTINGS
        </div>
        <div style={{ fontSize: 11, color: '#7090b0', marginTop: 4 }}>
          Manage your simulated paper balance, quantitative risk parameters, and AI signal gating rules.
        </div>
      </div>

      {/* Institutional Strategy Parameters Card */}
      <div style={{ background: 'rgba(0,255,136,0.03)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: 12, padding: '16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#00ff88', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
          🏛️ ACTIVE INSTITUTIONAL STRATEGY RULES
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', fontSize: 11 }}>
          <div style={{ color: '#7090b0' }}>Take Profit Target:</div>
          <div style={{ color: '#00ff88', fontWeight: 700 }}>3.0× ATR (1 : 2.00 R:R)</div>
          <div style={{ color: '#7090b0' }}>Stop Loss Buffer:</div>
          <div style={{ color: '#ff4466', fontWeight: 700 }}>1.5× ATR</div>
          <div style={{ color: '#7090b0' }}>Directional Cap:</div>
          <div style={{ color: '#00d4ff', fontWeight: 700 }}>Max 3 Longs or Shorts</div>
          <div style={{ color: '#7090b0' }}>24h Circuit Breaker:</div>
          <div style={{ color: '#ffd700', fontWeight: 700 }}>Max 3 SLs / 24h</div>
          <div style={{ color: '#7090b0' }}>BTC Macro Filter:</div>
          <div style={{ color: '#00ff88', fontWeight: 700 }}>Active (4H EMA 50/200)</div>
          <div style={{ color: '#7090b0' }}>Candle Invalidation:</div>
          <div style={{ color: '#ffffff', fontWeight: 700 }}>Closed 1H Bar EMA 20</div>
        </div>
      </div>

      {/* Account Balance Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#00ff88', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
          💰 PAPER ACCOUNT BALANCE
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>STARTING BALANCE (USD)</div>
            <input
              type="number"
              value={settings.startingBalanceUsd ?? 1000}
              onChange={(e) => update('startingBalanceUsd', parseFloat(e.target.value) || 1000)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Initial paper capital allocated to account (Default: $1,000.00 USD).</div>
          </div>
        </div>
      </div>

      {/* Risk Management Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#ffd700', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
          🛡️ QUANTITATIVE RISK & POSITION SIZING
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>MAX RISK PER TRADE (%)</div>
            <input
              type="number"
              step="0.05"
              value={settings.riskPerTradePct ?? 0.1}
              onChange={(e) => update('riskPerTradePct', parseFloat(e.target.value) || 0.1)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Max capital lost if Stop Loss is hit (Default: 0.1% = $1.00 USD per trade on $1,000 account).</div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>MAX OPEN POSITIONS</div>
            <input
              type="number"
              value={settings.maxOpenPositions ?? 4}
              onChange={(e) => update('maxOpenPositions', parseInt(e.target.value, 10) || 4)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Maximum concurrent open positions allowed for portfolio diversification (Default: 4).</div>
          </div>
        </div>
      </div>

      {/* AI Gate Thresholds Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#9b59ff', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
          🤖 AI MODEL ENTRY GATE THRESHOLDS
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>MINIMUM AI SCORE FOR ENTRY (0 - 100)</div>
            <input
              type="number"
              value={settings.minAiScore ?? 91}
              onChange={(e) => update('minAiScore', parseInt(e.target.value, 10) || 91)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Minimum combined AI score required to trigger ENTRY_READY (Default: 91/100).</div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>MINIMUM RISK : REWARD RATIO</div>
            <input
              type="number"
              step="0.1"
              value={settings.minRiskRewardRatio ?? 2.0}
              onChange={(e) => update('minRiskRewardRatio', parseFloat(e.target.value) || 2.0)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Minimum required reward vs risk ratio (Default: 2.0 : 1).</div>
          </div>
        </div>
      </div>

      {/* Delta Exchange Trade Replicator Section */}
      <div style={{ background: 'rgba(255,215,0,0.03)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: 12, padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#ffd700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            🔗 DELTA EXCHANGE REPLICATOR (DEMO / LIVE)
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontWeight: 800, color: settings.deltaEnabled ? '#00ff88' : '#7090b0' }}>
            <input
              type="checkbox"
              checked={Boolean(settings.deltaEnabled)}
              onChange={(e) => update('deltaEnabled', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#00ff88', cursor: 'pointer' }}
            />
            {settings.deltaEnabled ? 'ENABLED' : 'DISABLED'}
          </label>
        </div>

        <div style={{ fontSize: 10, color: '#7090b0', marginBottom: 12, lineHeight: 1.45 }}>
          Mirrors every paper bot trade (Entry, Bracket SL/TP, +1.5R Break-Even move, and Close) directly into your Delta Exchange account. Your paper strategy remains 100% unchanged.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>DELTA ENVIRONMENT</div>
            <select
              value={settings.deltaEnvironment ?? 'INDIA_DEMO'}
              onChange={(e) => update('deltaEnvironment', e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            >
              <option value="INDIA_DEMO">Delta India DEMO / Testnet (cdn-ind.testnet.deltaex.org)</option>
              <option value="GLOBAL_DEMO">Delta Global DEMO / Testnet (testnet-api.delta.exchange)</option>
              <option value="INDIA_LIVE">Delta India LIVE (api.india.delta.exchange)</option>
              <option value="GLOBAL_LIVE">Delta Global LIVE (api.delta.exchange)</option>
            </select>
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>
              Use India DEMO for demo.delta.exchange accounts. Note: Testnet lists major pairs (BTC, ETH, SOL, XRP, ADA, DOGE); non-listed testnet alts are safely skipped.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>DELTA API KEY</div>
            <input
              type="text"
              placeholder="Paste your Delta Testnet / Live API Key"
              value={settings.deltaApiKey ?? ''}
              onChange={(e) => update('deltaApiKey', e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>DELTA API SECRET</div>
            <input
              type="password"
              placeholder="Paste your Delta Testnet / Live API Secret"
              value={settings.deltaApiSecret ?? ''}
              onChange={(e) => update('deltaApiSecret', e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>SIZE SCALE (MULTIPLIER)</div>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={settings.deltaRiskScale ?? 1.0}
                onChange={(e) => update('deltaRiskScale', parseFloat(e.target.value) || 1.0)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
              />
              <div style={{ fontSize: 9.5, color: '#4a6080', marginTop: 2 }}>1.0 = exact $1k bot size; use 10.0 for $10k demo account.</div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>ORDER LEVERAGE (×)</div>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.deltaLeverage ?? 10}
                onChange={(e) => update('deltaLeverage', parseInt(e.target.value, 10) || 10)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
              />
              <div style={{ fontSize: 9.5, color: '#4a6080', marginTop: 2 }}>Margin leverage applied per contract (Default: 10x).</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>MAX RISK PER DELTA ORDER ($ USD, 0 = UNLIMITED)</div>
            <input
              type="number"
              step="0.25"
              min="0"
              value={settings.deltaMaxRiskUsd ?? 0}
              onChange={(e) => update('deltaMaxRiskUsd', parseFloat(e.target.value) || 0)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 9.5, color: '#4a6080', marginTop: 2 }}>
              Small account protection: skips pairs whose minimum 1 contract risks more than this $ amount (recommended: $1.25 for a $50 real account).
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
            <button
              type="button"
              disabled={testingDelta}
              onClick={async () => {
                setTestingDelta(true);
                setDeltaTestResult(null);
                try {
                  const res = await api.testDelta({
                    deltaEnvironment: settings.deltaEnvironment ?? 'INDIA_DEMO',
                    deltaApiKey: settings.deltaApiKey ?? '',
                    deltaApiSecret: settings.deltaApiSecret ?? '',
                  });
                  if (res.success) {
                    const balStr = (res.balances || []).map(b => `${b.asset}: ${Number(b.available).toFixed(2)}`).join(' | ') || '0 USD';
                    setDeltaTestResult({
                      success: true,
                      message: `Connected to ${res.environment}! Balance: ${balStr}. Live perpetuals: ${res.livePerpsCount}. Remember to click SAVE SETTINGS below!`,
                    });
                  } else {
                    setDeltaTestResult({
                      success: false,
                      message: `Connection failed: ${res.error || 'Unknown error'}`,
                    });
                  }
                } catch (e: any) {
                  setDeltaTestResult({
                    success: false,
                    message: `Error: ${e?.message || 'Request failed'}`,
                  });
                } finally {
                  setTestingDelta(false);
                }
              }}
              style={{
                padding: '9px 14px', borderRadius: 7, background: 'rgba(255,215,0,0.15)',
                border: '1px solid rgba(255,215,0,0.35)', color: '#ffd700', fontSize: 11, fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start',
              }}
            >
              {testingDelta ? '⏳ Testing Delta API...' : '🔌 Test Delta Connection & Balance'}
            </button>

            {deltaTestResult && (
              <div style={{
                padding: '8px 10px', borderRadius: 7, fontSize: 10.5, fontWeight: 700,
                background: deltaTestResult.success ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,102,0.1)',
                border: `1px solid ${deltaTestResult.success ? 'rgba(0,255,136,0.3)' : 'rgba(255,68,102,0.3)'}`,
                color: deltaTestResult.success ? '#00ff88' : '#ff4466',
              }}>
                {deltaTestResult.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Telegram Alerts Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 12, padding: '16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#00d4ff', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
          📱 TELEGRAM ALERTS & NOTIFICATIONS
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>TELEGRAM BOT TOKEN</div>
            <input
              type="password"
              placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              value={settings.telegramBotToken ?? ''}
              onChange={(e) => update('telegramBotToken' as any, e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>From @BotFather on Telegram (also reads TELEGRAM_BOT_TOKEN env var).</div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#7090b0', fontWeight: 700, marginBottom: 4 }}>TELEGRAM CHAT ID / CHANNEL ID</div>
            <input
              type="text"
              placeholder="e.g. 123456789 or -1001234567890"
              value={settings.telegramChatId ?? ''}
              onChange={(e) => update('telegramChatId' as any, e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0a101d', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontSize: 13, fontWeight: 700 }}
            />
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Your user ID or channel ID where entry, exit, TP, and SL alerts will be sent.</div>
          </div>

          <div style={{ marginTop: 4 }}>
            <button
              onClick={async () => {
                try {
                  const res = await api.testTelegram();
                  if (res.success) {
                    alert('✅ Test alert sent successfully to Telegram!');
                  } else {
                    alert(`❌ Failed to send Telegram alert: ${res.error || 'Unknown error'}`);
                  }
                } catch (e: any) {
                  alert(`❌ Error sending Telegram test: ${e.message}`);
                }
              }}
              style={{
                padding: '8px 14px', borderRadius: 7, background: 'rgba(0,212,255,0.15)',
                border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', fontSize: 11, fontWeight: 800, cursor: 'pointer'
              }}
            >
              🚀 Send Test Telegram Alert
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: '100%', padding: 14, borderRadius: 10, background: 'linear-gradient(135deg, #00d4ff, #9b59ff)',
          border: 'none', color: '#080d1a', fontSize: 13, fontWeight: 900, cursor: 'pointer',
          letterSpacing: '0.04em', opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'SAVING...' : saved ? '✅ SETTINGS SAVED' : 'SAVE SETTINGS'}
      </button>

      {/* Reset Portfolio */}
      <div style={{ background: 'rgba(255,68,102,0.05)', border: '1px solid rgba(255,68,102,0.2)', borderRadius: 12, padding: '16px', marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#ff4466', letterSpacing: '0.08em', marginBottom: 4 }}>
          ⚠️ RESET PAPER PORTFOLIO
        </div>
        <div style={{ fontSize: 10, color: '#7090b0', marginBottom: 12 }}>
          Reset your paper trading account back to initial $1,000.00 USD starting balance.
        </div>
        <button
          onClick={handleResetPortfolio}
          disabled={resetting}
          style={{
            padding: '10px 16px', borderRadius: 8, background: 'rgba(255,68,102,0.18)',
            border: '1px solid rgba(255,68,102,0.4)', color: '#ff4466', fontSize: 11, fontWeight: 800, cursor: 'pointer',
          }}
        >
          {resetting ? 'RESETTING...' : 'RESET PORTFOLIO TO $1,000.00'}
        </button>
      </div>
    </div>
  );
}

/**
 * Currency conversion for multi-client roll-ups (e.g. EGP + AED clients on one dashboard).
 * Rates are stored per organization in Organization.settings.fx (Settings → Currency) and are
 * labelled as manual/estimated in the UI. Values are "units per 1 base currency".
 */
export type FxTable = { base: string; rates: Record<string, number>; asOf?: string; source?: string };

export const DEFAULT_FX: FxTable = { base: "USD", rates: { USD: 1, EGP: 48.5, AED: 3.6725, SAR: 3.75, EUR: 0.92, KWD: 0.307, QAR: 3.64 }, source: "Default reference rates — update in Settings" };

export function fxFromSettings(settings: unknown): FxTable {
  const s = (settings ?? {}) as { fx?: FxTable };
  if (s.fx?.rates && Object.keys(s.fx.rates).length) return { ...DEFAULT_FX, ...s.fx, rates: { ...DEFAULT_FX.rates, ...s.fx.rates } };
  return DEFAULT_FX;
}

export function convert(amount: number, from: string, to: string, fx: FxTable): number {
  if (!amount || from === to) return amount;
  const a = fx.rates[from];
  const b = fx.rates[to];
  if (!a || !b) return amount; // unknown currency: leave unconverted rather than invent a rate
  return (amount / a) * b;
}

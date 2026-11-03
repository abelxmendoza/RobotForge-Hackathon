/* Connection kinds for the Wiring tab views, derived from the
 * connection's own recorded detail text — and nothing else.
 *
 * The record (spec.connections) carries free-text details like
 * "I2C 0x40 · PWM ch 1 fwd / ch 0 back · 50 Hz" or "Power — 7.4 V
 * nominal pack". This classifier only groups those strings for
 * filtering: a detail that names a bus or a pin set lands in that
 * kind; power wording lands in Power; anything else is "Other" —
 * never force-classified into a kind the text does not name.
 * Precedence when a detail names several: CSI, then GPIO, then
 * I2C / comms, then Power (the most specific interface first).
 * Pure and import-free, like lib/takeApart.ts, so the Python gate
 * can copy it verbatim into a node harness. */

export type ConnectionKind = 'Power' | 'I2C / comms' | 'GPIO' | 'CSI' | 'Other';

export const CONNECTION_KINDS: ConnectionKind[] = ['Power', 'I2C / comms', 'GPIO', 'CSI', 'Other'];

export function connectionKind(detail: string): ConnectionKind {
  const d = (detail ?? '').toLowerCase();
  if (d.includes('csi')) return 'CSI';
  if (d.includes('gpio')) return 'GPIO';
  if (/i2c|uart|usb|spi|serial/.test(d)) return 'I2C / comms';
  if (/power|nominal pack|battery|\b\d+(\.\d+)?\s*v\b|rail/.test(d)) return 'Power';
  return 'Other';
}

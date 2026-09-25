// Bewusst ohne DOM- oder Node-Typen: `shared` läuft in Browser, Worker und Node.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

/**
 * Erzeugt eine UUID v7 (RFC 9562): zeitlich sortierbar, im Client wie im Server erzeugbar.
 * Nutzt nur `crypto.getRandomValues`, das in Browsern, Workers und Node vorhanden ist.
 */
export function newId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

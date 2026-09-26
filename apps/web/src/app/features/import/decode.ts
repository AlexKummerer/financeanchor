/** Bytes als Text: UTF-8, wenn gültig, sonst Windows-1252 (ältere Exporte von Sparkasse, ING, Comdirect). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

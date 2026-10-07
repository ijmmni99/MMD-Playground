import Encoding from 'encoding-japanese';

/**
 * Decode a raw ZIP entry name. ZIPs created on Japanese Windows store names in Shift-JIS without
 * the UTF-8 flag; we detect the encoding and convert.
 */
export function decodeZipName(bytes: Uint8Array): string {
  let ascii = true;
  for (const b of bytes) if (b >= 0x80) ascii = false;
  if (ascii) return String.fromCharCode(...bytes);
  const detected = Encoding.detect(bytes);
  if (detected === 'UTF8' || detected === 'ASCII') return new TextDecoder('utf-8').decode(bytes);
  if (detected === 'SJIS' || detected === 'EUCJP' || detected === 'JIS') {
    return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: detected, type: 'string' });
  }
  // Fall back: try utf-8 strictly, then Shift-JIS.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
  }
}

import Encoding from 'encoding-japanese';

/** Shift-JIS bytes for `text`, cut to at most `max` bytes without splitting a double-byte character. */
export function encodeSjis(text: string, max: number): Uint8Array {
  const codes = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
  let end = 0;
  for (let i = 0; i < codes.length;) {
    const lead = codes[i];
    const width = (lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc) ? 2 : 1;
    if (i + width > max) break;
    i += width;
    end = i;
  }
  return Uint8Array.from(codes.slice(0, end));
}

/** Decode a zero-terminated Shift-JIS field. */
export function decodeSjis(bytes: Uint8Array): string {
  let n = bytes.indexOf(0);
  if (n < 0) n = bytes.length;
  // Some writers pad with 0xFD after the terminator; only the bytes before the first 0 matter.
  return Encoding.convert(Array.from(bytes.subarray(0, n)), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

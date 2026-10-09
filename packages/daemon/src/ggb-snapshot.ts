import { crc32, inflateRawSync } from 'node:zlib';

/** Validate the ZIP directory and the actual construction XML before accepting a checkpoint.
 * No extraction to disk, encrypted/ZIP64 archives are deliberately unsupported. */
export function validateGgbSnapshot(data: Buffer): void {
  const invalid = () => { throw new Error('画板快照不是完整、有效的 GGB ZIP 文件'); };
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) {
    if (data.readUInt32LE(at) === 0x06054b50 && at + 22 + data.readUInt16LE(at + 20) === data.length) { end = at; break; }
  }
  if (end < 0) return invalid();
  const count = data.readUInt16LE(end + 10); const size = data.readUInt32LE(end + 12); const start = data.readUInt32LE(end + 16);
  if (!count || count === 65535 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || data.readUInt16LE(end + 8) !== count || start + size !== end) return invalid();
  let at = start; let found = false;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) return invalid();
    const flags = data.readUInt16LE(at + 8); const method = data.readUInt16LE(at + 10);
    const checksum = data.readUInt32LE(at + 16); const compressed = data.readUInt32LE(at + 20); const expanded = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28); const extra = data.readUInt16LE(at + 30); const comment = data.readUInt16LE(at + 32);
    const offset = data.readUInt32LE(at + 42); const next = at + 46 + nameLength + extra + comment;
    if (next > end || offset + 30 > start || flags & 1 || ![0, 8].includes(method) || data.readUInt32LE(offset) !== 0x04034b50) return invalid();
    const name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const bodyStart = offset + 30 + data.readUInt16LE(offset + 26) + data.readUInt16LE(offset + 28);
    if (bodyStart + compressed > start) return invalid();
    if (name === 'geogebra.xml') {
      if (found || expanded > 64 * 1024 * 1024) return invalid();
      const packed = data.subarray(bodyStart, bodyStart + compressed);
      const xml = method === 8 ? inflateRawSync(packed, { maxOutputLength: 64 * 1024 * 1024 }) : packed;
      if (xml.length !== expanded || crc32(xml) !== checksum || !/<geogebra[\s>]/.test(xml.toString('utf8')) || !xml.toString('utf8').includes('</geogebra>')) return invalid();
      found = true;
    }
    at = next;
  }
  if (!found || at !== end) invalid();
}

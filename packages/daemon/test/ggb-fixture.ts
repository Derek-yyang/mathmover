import { crc32 } from 'node:zlib';
export function ggbFixture(label = 'test'): string {
  const name = Buffer.from('geogebra.xml'); const xml = Buffer.from(`<geogebra><construction>${label}</construction></geogebra>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(xml), 14); local.writeUInt32LE(xml.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
  header.writeUInt32LE(crc32(xml), 16); header.writeUInt32LE(xml.length, 20); header.writeUInt32LE(xml.length, 24); header.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([header, name]); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(local.length + name.length + xml.length, 16);
  return Buffer.concat([local, name, xml, directory, end]).toString('base64');
}

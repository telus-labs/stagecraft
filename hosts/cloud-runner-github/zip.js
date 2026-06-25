"use strict";

// Minimal zip reader and writer used by the cloud-runner-github adapter.
// Handles only the subset of the zip format needed for result artifacts:
//   - STORE (method 0) and DEFLATE (method 8) compression
//   - Single or multiple files, no directory entries
//   - No zip64 extensions
//
// No third-party dependencies. Uses only node:zlib.

const zlib = require("node:zlib");

// ---------------------------------------------------------------------------
// CRC-32 (zip requires it; Node's zlib.crc32 is Node 22.2+ only)
// ---------------------------------------------------------------------------

const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ _crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// makeZip — create a zip buffer from an array of { name: string, data: Buffer }
// ---------------------------------------------------------------------------

function makeZip(files) {
  const localHeaders = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = file.data instanceof Buffer ? file.data : Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const fileData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);           // version needed
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(method, 8);       // compression method
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(crc, 14);         // crc32
    localHeader.writeUInt32LE(fileData.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22);  // uncompressed size
    localHeader.writeUInt16LE(name.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28);           // extra field length
    name.copy(localHeader, 30);

    localHeaders.push({ name, data: fileData, crc, method, uncompressedSize: data.length, compressedSize: fileData.length, offset });
    offset += localHeader.length + fileData.length;
  }

  // Central directory
  const cdEntries = [];
  for (const f of localHeaders) {
    const cd = Buffer.alloc(46 + f.name.length);
    cd.writeUInt32LE(0x02014b50, 0);  // signature
    cd.writeUInt16LE(20, 4);           // version made by
    cd.writeUInt16LE(20, 6);           // version needed
    cd.writeUInt16LE(0, 8);            // flags
    cd.writeUInt16LE(f.method, 10);
    cd.writeUInt16LE(0, 12);           // mod time
    cd.writeUInt16LE(0, 14);           // mod date
    cd.writeUInt32LE(f.crc, 16);
    cd.writeUInt32LE(f.compressedSize, 20);
    cd.writeUInt32LE(f.uncompressedSize, 24);
    cd.writeUInt16LE(f.name.length, 28);
    cd.writeUInt16LE(0, 30);           // extra length
    cd.writeUInt16LE(0, 32);           // comment length
    cd.writeUInt16LE(0, 34);           // disk start
    cd.writeUInt16LE(0, 36);           // internal attr
    cd.writeUInt32LE(0, 38);           // external attr
    cd.writeUInt32LE(f.offset, 42);    // local header offset
    f.name.copy(cd, 46);
    cdEntries.push(cd);
  }

  const cdBuf = Buffer.concat(cdEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);  // signature
  eocd.writeUInt16LE(0, 4);           // disk number
  eocd.writeUInt16LE(0, 6);           // disk with CD
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);     // CD offset
  eocd.writeUInt16LE(0, 20);          // comment length

  const localParts = localHeaders.flatMap((f) => {
    const h = Buffer.alloc(30 + f.name.length);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0, 6);
    h.writeUInt16LE(f.method, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt32LE(f.crc, 14);
    h.writeUInt32LE(f.compressedSize, 18);
    h.writeUInt32LE(f.uncompressedSize, 22);
    h.writeUInt16LE(f.name.length, 26);
    h.writeUInt16LE(0, 28);
    f.name.copy(h, 30);
    return [h, f.data];
  });

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

// ---------------------------------------------------------------------------
// readZip — extract files from a zip buffer
// Returns: Array<{ name: string, data: Buffer }>
//
// Uses the central directory (not local headers) for sizes, because
// actions/upload-artifact@v4 sets bit 3 (data descriptor) in local headers,
// which means local compressedSize/uncompressedSize are written as 0.
// The central directory always carries the real values.
// ---------------------------------------------------------------------------

function readZip(buf) {
  // --- 1. Find end-of-central-directory record (EOCD) ---
  // EOCD signature: 0x06054b50. Scan backwards from the end to handle
  // an optional ZIP comment (up to 65535 bytes, but we cap at 65536+22).
  const maxScan = Math.min(buf.length, 65536 + 22);
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= buf.length - maxScan; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("readZip: no EOCD record found — not a valid zip");

  const cdCount  = buf.readUInt16LE(eocdPos + 10);  // entries in central dir
  const cdSize   = buf.readUInt32LE(eocdPos + 12);   // central dir byte size
  const cdOffset = buf.readUInt32LE(eocdPos + 16);   // central dir start offset

  // --- 2. Parse central directory to get correct sizes and local offsets ---
  const cdEntries = [];
  let cdPos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50) {
      throw new Error("readZip: unexpected central directory signature");
    }
    const method          = buf.readUInt16LE(cdPos + 10);
    const compressedSize  = buf.readUInt32LE(cdPos + 20);
    const uncompressedSize = buf.readUInt32LE(cdPos + 24);
    const nameLen         = buf.readUInt16LE(cdPos + 28);
    const extraLen        = buf.readUInt16LE(cdPos + 30);
    const commentLen      = buf.readUInt16LE(cdPos + 32);
    const localOffset     = buf.readUInt32LE(cdPos + 42);
    const name            = buf.slice(cdPos + 46, cdPos + 46 + nameLen).toString("utf8");
    cdEntries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cdPos += 46 + nameLen + extraLen + commentLen;
  }

  // --- 3. For each entry, seek past the local header and extract data ---
  const files = [];
  for (const entry of cdEntries) {
    if (entry.name.endsWith("/")) continue;  // skip directory entries

    const lh = entry.localOffset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error(`readZip: bad local header signature for "${entry.name}"`);
    }
    const lhNameLen  = buf.readUInt16LE(lh + 26);
    const lhExtraLen = buf.readUInt16LE(lh + 28);
    const dataStart  = lh + 30 + lhNameLen + lhExtraLen;
    const compressed = buf.slice(dataStart, dataStart + entry.compressedSize);

    let data;
    if (entry.method === 0) {
      data = compressed;
    } else if (entry.method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`readZip: unsupported compression method ${entry.method} for "${entry.name}"`);
    }

    if (data.length !== entry.uncompressedSize) {
      throw new Error(`readZip: size mismatch for "${entry.name}": expected ${entry.uncompressedSize}, got ${data.length}`);
    }

    files.push({ name: entry.name, data });
  }

  return files;
}

module.exports = { makeZip, readZip, crc32 };

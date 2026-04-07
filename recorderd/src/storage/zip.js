import fs from "node:fs";
import path from "node:path";

const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }

  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function makeLocalHeader(fileName, crc, size) {
  const nameBuffer = Buffer.from(fileName, "utf8");
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, nameBuffer]);
}

function makeCentralHeader(fileName, crc, size, localOffset) {
  const nameBuffer = Buffer.from(fileName, "utf8");
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);

  return Buffer.concat([header, nameBuffer]);
}

function makeEndRecord(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);

  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);

  return record;
}

export async function createZipArchive(archivePath, entries) {
  await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });

  const writeStream = fs.createWriteStream(archivePath);
  const centralHeaders = [];
  let offset = 0;

  await new Promise((resolve, reject) => {
    writeStream.once("open", resolve);
    writeStream.once("error", reject);
  });

  for (const entry of entries) {
    const data = entry.buffer || await fs.promises.readFile(entry.filePath);
    const checksum = crc32(data);
    const localHeader = makeLocalHeader(entry.name, checksum, data.length);

    await new Promise((resolve, reject) => {
      writeStream.write(Buffer.concat([localHeader, data]), function (error) {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    centralHeaders.push(makeCentralHeader(entry.name, checksum, data.length, offset));
    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralHeaders);

  await new Promise((resolve, reject) => {
    writeStream.write(centralDirectory, function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await new Promise((resolve, reject) => {
    writeStream.end(makeEndRecord(entries.length, centralDirectory.length, centralOffset), function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const stat = await fs.promises.stat(archivePath);

  return stat.size;
}

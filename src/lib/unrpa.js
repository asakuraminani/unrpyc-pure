import { unzlibSync } from 'fflate';
import { Parser } from 'pickleparser';

const NOOP = () => {};

function defaultLogger() {
    return { info: NOOP, warn: NOOP, error: NOOP };
}

/**
 * Ensures input is a Uint8Array regardless of source.
 * Accepts Uint8Array, ArrayBuffer, ArrayBufferView, or Buffer.
 */
function toUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error('Input must be Uint8Array, ArrayBuffer, or ArrayBufferView');
}

/**
 * Reads a slice from an input source.
 * Supports browser File objects (with .slice().arrayBuffer()) and Uint8Array/Buffer.
 * @param {File|Uint8Array|ArrayBuffer} source
 * @param {number} start
 * @param {number} [end] - exclusive end; omit to read to the end
 * @returns {Promise<Uint8Array>}
 */
async function readSlice(source, start, end) {
    // Browser File / Blob
    if (typeof source?.slice === 'function' && typeof source?.arrayBuffer === 'function') {
        const slice = end != null ? source.slice(start, end) : source.slice(start);
        return new Uint8Array(await slice.arrayBuffer());
    }
    // Blob with slice but no top-level arrayBuffer
    if (typeof source?.slice === 'function') {
        const slice = end != null ? source.slice(start, end) : source.slice(start);
        if (typeof slice.arrayBuffer === 'function') {
            return new Uint8Array(await slice.arrayBuffer());
        }
    }
    // Uint8Array / Buffer
    const buf = toUint8Array(source);
    if (end != null) {
        return buf.slice(start, end);
    }
    return buf.slice(start);
}

/**
 * Parses an RPA v3.x archive and returns its entry index.
 *
 * Works in both browser and Node.js environments:
 *  - Browser: pass a File or Blob
 *  - Node.js: pass a Uint8Array, Buffer, or ArrayBuffer
 *
 * @param {File|Blob|Uint8Array|ArrayBuffer} source - The RPA archive data
 * @param {Object} [options]
 * @param {Object} [options.logger] - Logger with .info/.warn/.error methods
 * @returns {Promise<{ entries: Array<{ path: string; size: number; offset: number; rawSize: number; prefix: any }>, key: number, version: number, indexOffset: number, header: string }>}
 */
export async function parseRpaFile(source, options = {}) {
    const logger = options.logger || defaultLogger();

    // --- Read header ---
    let headerStr = '';
    let offset = 0;
    const chunk_size = 512;
    const max_header_size = 8192;

    while (headerStr.indexOf('\n') === -1 && offset < max_header_size) {
        const buf = await readSlice(source, offset, offset + chunk_size);
        if (buf.length === 0) break;
        headerStr += new TextDecoder().decode(buf);
        offset += chunk_size;
    }

    const firstLine = headerStr.split('\n')[0].trim();
    const parts = firstLine.split(/\s+/);

    if (!parts[0].startsWith('RPA-3')) {
        throw new Error('Not a valid RPA-3.x file (header mismatch).');
    }

    const version = parts[0] === 'RPA-3.2' ? 3.2 : 3.0;
    const indexOffset = parseInt(parts[1], 16);

    if (isNaN(indexOffset)) {
        throw new Error('Invalid index offset.');
    }

    let key = 0;

    if (version === 3.0) {
        for (let i = 2; i < parts.length; i++) {
            const val = parseInt(parts[i], 16);
            if (!isNaN(val)) key ^= val;
        }
        key = key >>> 0;
    } else if (version === 3.2) {
        for (let i = 3; i < parts.length; i++) {
            const val = parseInt(parts[i], 16);
            if (!isNaN(val)) key ^= val;
        }
        key = key >>> 0;
    }

    // --- Read & decompress index ---
    const indexBuf = await readSlice(source, indexOffset);
    let decompressed;
    let lastError = null;

    try {
        decompressed = unzlibSync(indexBuf);
    } catch (err) {
        lastError = err;
        logger.warn?.('Standard decompression failed: ' + (err.message || err));
    }

    if (!decompressed) {
        throw new Error(`Index decompression failed. Last error: ${lastError?.message || lastError}. Original Key: 0x${key.toString(16)}`);
    }

    // --- Unpickle index ---
    let data;
    try {
        const parser = new Parser();
        data = parser.parse(decompressed);
    } catch (err) {
        const first16 = Array.from(decompressed.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        logger.error(`Pickle parsing failed: ${err.message || err}. Data start: ${first16}`);
        throw new Error(`Pickle parsing failed: ${err.message || err}. Data start: ${first16}`);
    }

    // --- Build entry list ---
    const entries = [];
    let fileEntries = [];

    if (data instanceof Map) {
        data.forEach((value, k) => {
            fileEntries.push([k, value]);
        });
    } else if (typeof data === 'object' && data !== null) {
        fileEntries = Object.entries(data);
    } else {
        throw new Error('Unexpected pickle result type: ' + typeof data);
    }

    for (const [filename, fileList] of fileEntries) {
        let items = [];
        if (Array.isArray(fileList)) {
            items = fileList;
        } else {
            logger.warn?.(`FileList is not array: ${filename}`);
            continue;
        }

        if (items.length > 0) {
            let item = items[0];

            if (!Array.isArray(item)) {
                if (items.length >= 2 && typeof items[0] === 'number') {
                    item = items;
                } else {
                    logger.warn?.(`Unexpected item format (inner) for file: ${filename}`);
                    continue;
                }
            }

            if (item.length >= 2) {
                let entryOffset = item[0];
                let length = item[1];
                const prefix = item[2] || null;

                if (key !== 0) {
                    let offsetNum = Number(entryOffset);
                    let lengthNum = Number(length);

                    if (offsetNum <= 0xFFFFFFFF) {
                        entryOffset = (offsetNum ^ key) >>> 0;
                    } else {
                        const offsetBI = typeof entryOffset === 'bigint' ? entryOffset : BigInt(entryOffset);
                        const keyBI = BigInt(key);
                        entryOffset = Number(offsetBI ^ keyBI);
                    }

                    if (lengthNum <= 0xFFFFFFFF) {
                        length = (lengthNum ^ key) >>> 0;
                    } else {
                        const lengthBI = typeof length === 'bigint' ? length : BigInt(length);
                        const keyBI = BigInt(key);
                        length = Number(lengthBI ^ keyBI);
                    }
                } else {
                    entryOffset = Number(entryOffset);
                    length = Number(length);
                }

                entries.push({
                    path: filename,
                    offset: entryOffset,
                    size: length,
                    rawSize: length,
                    prefix: prefix
                });
            }
        }
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));

    logger.info(`Successfully parsed ${entries.length} entries from RPA file.`);
    return { entries, key, version, indexOffset, header: firstLine };
}

/**
 * Extracts raw data for a single entry from an RPA archive.
 *
 * @param {File|Blob|Uint8Array|ArrayBuffer} source - The RPA archive data
 * @param {{ offset: number; size: number; prefix: any }} entry - An entry returned by parseRpaFile
 * @returns {Promise<Uint8Array>} The extracted file data
 */
export async function extractRpaEntry(source, entry) {
    let data = await readSlice(source, entry.offset, entry.offset + entry.size);
    if (entry.prefix) {
        const prefixBytes = typeof entry.prefix === 'string'
            ? new TextEncoder().encode(entry.prefix)
            : (entry.prefix instanceof Uint8Array ? entry.prefix : new Uint8Array(0));
        if (prefixBytes.length > 0) {
            const combined = new Uint8Array(prefixBytes.length + data.length);
            combined.set(prefixBytes, 0);
            combined.set(data, prefixBytes.length);
            data = combined;
        }
    }
    return data;
}

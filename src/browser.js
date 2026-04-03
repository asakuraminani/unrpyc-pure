import { createOutputFromBuffer } from './lib/pipeline.js';
import { parseRpaFile, extractRpaEntry } from './lib/unrpa.js';

function normalizeInputBuffer(input) {
    if (input instanceof Uint8Array) {
        return input;
    }

    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }

    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }

    throw new Error('Browser input must be Uint8Array, ArrayBuffer, or ArrayBuffer view');
}

function resolveArchiveEntry(files, pathOrEntry) {
    if (typeof pathOrEntry === 'string') {
        const entry = files.get(pathOrEntry);
        if (!entry) {
            throw new Error(`Archive entry not found: ${pathOrEntry}`);
        }
        return entry;
    }

    if (pathOrEntry && typeof pathOrEntry === 'object' && typeof pathOrEntry.path === 'string') {
        return pathOrEntry;
    }

    throw new Error('Archive entry must be a path string or entry object');
}

export function decompileRpyc(input, options = {}) {
    return createOutputFromBuffer(normalizeInputBuffer(input), {
        ...options,
        mode: 'decompile'
    });
}

export function genTranslate(input, type, options = {}) {
    return createOutputFromBuffer(normalizeInputBuffer(input), {
        ...options,
        mode: 'translate',
        type
    });
}

export async function openRpa(source, options = {}) {
    const archiveParser = options.parseRpaFile ?? parseRpaFile;
    const entryExtractor = options.extractRpaEntry ?? extractRpaEntry;
    const decompiler = options.decompileRpyc ?? decompileRpyc;
    const translator = options.genTranslate ?? genTranslate;
    const parsed = await archiveParser(source, options);
    const files = new Map(parsed.entries.map((entry) => [entry.path, entry]));
    const textDecoder = options.textDecoder ?? TextDecoder;

    const read = async (pathOrEntry) => {
        const entry = resolveArchiveEntry(files, pathOrEntry);
        return entryExtractor(source, entry);
    };

    const readText = async (pathOrEntry, encoding = 'utf-8') => {
        const bytes = await read(pathOrEntry);
        return new textDecoder(encoding).decode(bytes);
    };

    const decompile = async (pathOrEntry, decompileOptions = {}) => {
        const bytes = await read(pathOrEntry);
        return decompiler(bytes, decompileOptions);
    };

    const translate = async (pathOrEntry, type, translateOptions = {}) => {
        const bytes = await read(pathOrEntry);
        return translator(bytes, type, translateOptions);
    };

    return {
        entries: parsed.entries,
        files,
        metadata: {
            key: parsed.key,
            version: parsed.version,
            indexOffset: parsed.indexOffset,
            header: parsed.header
        },
        read,
        readText,
        decompile,
        translate
    };
}

export { parseRpaFile, extractRpaEntry };

import { createOutputFromBuffer } from './pipeline.js';

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

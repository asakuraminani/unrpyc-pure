import test from 'node:test';
import assert from 'node:assert/strict';

import { openRpa } from '../src/browser.js';

test('openRpa returns entries, files map, and metadata', async () => {
    const archive = await openRpa(new Uint8Array([1, 2, 3]), {
        parseRpaFile: async () => ({
            entries: [
                { path: 'game/script.rpyc', offset: 0, size: 3, rawSize: 3, prefix: null },
                { path: 'game/options.rpy', offset: 3, size: 4, rawSize: 4, prefix: null }
            ],
            key: 123,
            version: 3.0,
            indexOffset: 42,
            header: 'RPA-3.0 0000002a'
        })
    });

    assert.equal(archive.entries.length, 2);
    assert.ok(archive.files instanceof Map);
    assert.equal(archive.files.get('game/script.rpyc').offset, 0);
    assert.deepEqual(archive.metadata, {
        key: 123,
        version: 3.0,
        indexOffset: 42,
        header: 'RPA-3.0 0000002a'
    });
});

test('openRpa reads entries lazily by path', async () => {
    const calls = [];
    const archive = await openRpa(new Uint8Array([1, 2, 3]), {
        parseRpaFile: async () => ({
            entries: [
                { path: 'game/script.rpyc', offset: 0, size: 3, rawSize: 3, prefix: null },
                { path: 'game/other.rpyc', offset: 3, size: 4, rawSize: 4, prefix: null }
            ],
            key: 0,
            version: 3.0,
            indexOffset: 0,
            header: 'RPA-3.0 0'
        }),
        extractRpaEntry: async (_source, entry) => {
            calls.push(entry.path);
            return new TextEncoder().encode(entry.path);
        }
    });

    const bytes = await archive.read('game/script.rpyc');

    assert.equal(new TextDecoder().decode(bytes), 'game/script.rpyc');
    assert.deepEqual(calls, ['game/script.rpyc']);
});

test('openRpa readText decodes extracted bytes', async () => {
    const archive = await openRpa(new Uint8Array([1, 2, 3]), {
        parseRpaFile: async () => ({
            entries: [
                { path: 'game/options.rpy', offset: 0, size: 3, rawSize: 3, prefix: null }
            ],
            key: 0,
            version: 3.0,
            indexOffset: 0,
            header: 'RPA-3.0 0'
        }),
        extractRpaEntry: async () => new TextEncoder().encode('label start:')
    });

    assert.equal(await archive.readText('game/options.rpy'), 'label start:');
});

test('openRpa decompile passes extracted bytes to existing browser decompiler', async () => {
    const archive = await openRpa(new Uint8Array([1, 2, 3]), {
        parseRpaFile: async () => ({
            entries: [
                { path: 'game/script.rpyc', offset: 0, size: 3, rawSize: 3, prefix: null }
            ],
            key: 0,
            version: 3.0,
            indexOffset: 0,
            header: 'RPA-3.0 0'
        }),
        extractRpaEntry: async () => new Uint8Array([7, 8, 9]),
        decompileRpyc: (bytes, options) => ({ bytes: Array.from(bytes), options })
    });

    const result = await archive.decompile('game/script.rpyc', { debug: true });

    assert.deepEqual(result, {
        bytes: [7, 8, 9],
        options: { debug: true }
    });
});

test('openRpa translate passes extracted bytes to existing browser translator', async () => {
    const archive = await openRpa(new Uint8Array([1, 2, 3]), {
        parseRpaFile: async () => ({
            entries: [
                { path: 'game/script.rpyc', offset: 0, size: 3, rawSize: 3, prefix: null }
            ],
            key: 0,
            version: 3.0,
            indexOffset: 0,
            header: 'RPA-3.0 0'
        }),
        extractRpaEntry: async () => new Uint8Array([4, 5, 6]),
        genTranslate: (bytes, type, options) => ({ bytes: Array.from(bytes), type, options })
    });

    const result = await archive.translate('game/script.rpyc', 'json', { language: 'japanese' });

    assert.deepEqual(result, {
        bytes: [4, 5, 6],
        type: 'json',
        options: { language: 'japanese' }
    });
});

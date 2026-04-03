import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unpackRpa } from '../src/node/core/rpa.js';

function withTempDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-rpa-test-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('unpackRpa extracts files under outputDir/archiveName', async () => {
    await withTempDir(async (dir) => {
        const inputPath = join(dir, 'archive.rpa');
        const outputDir = join(dir, 'out');
        writeFileSync(inputPath, 'dummy');
        mkdirSync(outputDir);

        const result = await unpackRpa(inputPath, outputDir, {
            readSource: () => new Uint8Array([1, 2, 3]),
            parseRpaFile: async () => ({
                entries: [
                    { path: 'script.rpy', offset: 0, size: 3, prefix: null },
                    { path: 'nested/data.bin', offset: 3, size: 2, prefix: null }
                ]
            }),
            extractRpaEntry: async (_source, entry) => new TextEncoder().encode(entry.path)
        });

        assert.equal(result.mode, 'unpack-rpa');
        assert.equal(result.entryCount, 2);
        assert.equal(result.outputPath, join(outputDir, 'archive'));
        assert.equal(readFileSync(join(outputDir, 'archive', 'script.rpy'), 'utf8'), 'script.rpy');
        assert.equal(readFileSync(join(outputDir, 'archive', 'nested', 'data.bin'), 'utf8'), 'nested/data.bin');
        assert.deepEqual(result.errors, []);
    });
});

test('unpackRpa rejects escaping archive entries and records an error', async () => {
    await withTempDir(async (dir) => {
        const inputPath = join(dir, 'archive.rpa');
        const outputDir = join(dir, 'out');
        writeFileSync(inputPath, 'dummy');
        mkdirSync(outputDir);

        const result = await unpackRpa(inputPath, outputDir, {
            readSource: () => new Uint8Array([1, 2, 3]),
            parseRpaFile: async () => ({
                entries: [
                    { path: '../escape.txt', offset: 0, size: 3, prefix: null },
                    { path: 'safe.txt', offset: 3, size: 2, prefix: null }
                ]
            }),
            extractRpaEntry: async () => new TextEncoder().encode('ok')
        });

        assert.equal(result.writtenFiles.length, 1);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0].message, /outside output directory/);
        assert.equal(readFileSync(join(outputDir, 'archive', 'safe.txt'), 'utf8'), 'ok');
    });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, validateCliOptions } from '../src/node/cli.js';
import { collectInputFiles, getOutputPath, isProcessableDirectoryEntry, run, validateDirectoryOutputPath, validateSingleFileInputPath } from '../src/node/core/rpyc.js';
import { getArchiveOutputPath, validateUnpackRpaOptions } from '../src/node/core/rpa.js';

function withTempDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-test-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('parseArgs parses decompile mode arguments', () => {
    const result = parseArgs(['input.rpyc', 'output.rpy']);

    assert.deepEqual(result, {
        options: {
            mode: 'decompile',
            type: null,
            language: null,
            inputPath: 'input.rpyc',
            outputPath: 'output.rpy',
            directoryOutputMode: 'explicit-parent'
        }
    });
});

test('parseArgs defaults single-file decompile output next to existing input file', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'test.rpyc');
        writeFileSync(inputPath, 'dummy');

        const result = parseArgs([inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'decompile',
                type: null,
                language: null,
                inputPath,
                outputPath: join(dir, 'test.rpy'),
                directoryOutputMode: 'explicit-parent'
            }
        });
    });
});

test('parseArgs defaults single-file decompile output for existing file without relying on extension', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'test.bin');
        writeFileSync(inputPath, 'dummy');

        const result = parseArgs([inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'decompile',
                type: null,
                language: null,
                inputPath,
                outputPath: join(dir, 'test.rpy'),
                directoryOutputMode: 'explicit-parent'
            }
        });
    });
});

test('collectInputFiles treats any explicit file path as single-file input', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'Week1.bin');
        writeFileSync(inputPath, 'dummy');

        const result = collectInputFiles(inputPath);

        assert.equal(result.isSingleFileInput, true);
        assert.equal(result.inputBase, dir);
        assert.deepEqual(result.filesToProcess, [inputPath]);
    });
});

test('parseArgs defaults directory decompile output to sibling decompiled directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'scripts');
        mkdirSync(inputPath);

        const result = parseArgs([inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'decompile',
                type: null,
                language: null,
                inputPath,
                outputPath: join(dir, 'scripts-decompiled'),
                directoryOutputMode: 'implicit-final'
            }
        });
    });
});

test('parseArgs parses text translate arguments', () => {
    const result = parseArgs(['--gen-translate', 'text', 'japanese', 'game', 'translations']);

    assert.deepEqual(result, {
        options: {
            mode: 'translate',
            type: 'text',
            language: 'japanese',
            inputPath: 'game',
            outputPath: 'translations',
            directoryOutputMode: 'explicit-parent'
        }
    });
});

test('parseArgs defaults single-file text translate output under language directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpyc');
        writeFileSync(inputPath, 'dummy');

        const result = parseArgs(['--gen-translate', 'text', 'chinese', inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'translate',
                type: 'text',
                language: 'chinese',
                inputPath,
                outputPath: join(dir, 'chinese', 'script.rpy'),
                directoryOutputMode: 'explicit-parent'
            }
        });
    });
});

test('parseArgs defaults directory text translate output under input language directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        mkdirSync(inputPath);

        const result = parseArgs(['--gen-translate', 'text', 'chinese', inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'translate',
                type: 'text',
                language: 'chinese',
                inputPath,
                outputPath: join(inputPath, 'chinese'),
                directoryOutputMode: 'implicit-final'
            }
        });
    });
});

test('parseArgs defaults single-file json translate output under translate-json directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpyc');
        writeFileSync(inputPath, 'dummy');

        const result = parseArgs(['--gen-translate', 'json', inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'translate',
                type: 'json',
                language: null,
                inputPath,
                outputPath: join(dir, 'translate-json', 'script.json'),
                directoryOutputMode: 'explicit-parent'
            }
        });
    });
});

test('parseArgs defaults directory json translate output under translate-json directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        mkdirSync(inputPath);

        const result = parseArgs(['--gen-translate', 'json', inputPath]);

        assert.deepEqual(result, {
            options: {
                mode: 'translate',
                type: 'json',
                language: null,
                inputPath,
                outputPath: join(inputPath, 'translate-json'),
                directoryOutputMode: 'implicit-final'
            }
        });
    });
});

test('parseArgs parses unpack-rpa arguments', () => {
    const result = parseArgs(['--unpack-rpa', 'archive.rpa', 'out']);

    assert.deepEqual(result, {
        options: {
            mode: 'unpack-rpa',
            type: null,
            language: null,
            inputPath: 'archive.rpa',
            outputPath: 'out',
            directoryOutputMode: 'explicit-parent'
        }
    });
});

test('parseArgs returns usage for invalid translate type', () => {
    const result = parseArgs(['--gen-translate', 'xml', 'input', 'output']);

    assert.ok(typeof result.usage === 'string');
    assert.match(result.usage, /Usage:/);
});

test('validateSingleFileInputPath rejects non-rpyc single-file input', () => {
    assert.throws(
        () => validateSingleFileInputPath('/tmp/script.rpy'),
        /Single-file input must be a \.rpyc file/
    );
});

test('validateCliOptions rejects non-rpyc single-file input', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpy');

        writeFileSync(inputPath, 'dummy');

        assert.throws(
            () => validateCliOptions({
                mode: 'decompile',
                inputPath,
                outputPath: join(dir, 'script.out.rpy')
            }),
            /Single-file input must be a \.rpyc file/
        );
    });
});

test('validateCliOptions rejects single-file decompile output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpyc');
        const outputPath = join(dir, 'script.rpy');
        writeFileSync(inputPath, 'dummy');
        writeFileSync(outputPath, 'existing output');

        assert.throws(
            () => validateCliOptions({
                mode: 'decompile',
                inputPath,
                outputPath
            }),
            /Output file already exists/
        );
    });
});

test('validateCliOptions rejects directory decompile nested output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(dir, 'out');
        mkdirSync(inputPath);
        mkdirSync(outputPath);
        mkdirSync(join(outputPath, 'game'));

        assert.throws(
            () => validateCliOptions({
                mode: 'decompile',
                inputPath,
                outputPath
            }),
            /Output directory already exists/
        );
    });
});

test('validateCliOptions rejects single-file json translate with non-json output', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpyc');
        writeFileSync(inputPath, 'dummy');

        assert.throws(
            () => validateCliOptions({
                mode: 'translate',
                type: 'json',
                inputPath,
                outputPath: join(dir, 'script.rpy')
            }),
            /must end with \.json/
        );
    });
});

test('validateCliOptions accepts explicit json output path for single rpyc input', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'Week1.rpyc');
        writeFileSync(inputPath, 'dummy');

        assert.doesNotThrow(() => validateCliOptions({
            mode: 'translate',
            type: 'json',
            inputPath,
            outputPath: join(dir, 'a.json')
        }));
    });
});

test('validateCliOptions rejects single-file text translate output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'script.rpyc');
        const outputDir = join(dir, 'japanese');
        const outputPath = join(outputDir, 'script.rpy');
        writeFileSync(inputPath, 'dummy');
        mkdirSync(outputDir);
        writeFileSync(outputPath, 'existing output');

        assert.throws(
            () => validateCliOptions({
                mode: 'translate',
                type: 'text',
                language: 'japanese',
                inputPath,
                outputPath
            }),
            /Output file already exists/
        );
    });
});

test('validateCliOptions rejects directory translate nested output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(dir, 'out');
        mkdirSync(inputPath);
        mkdirSync(outputPath);
        mkdirSync(join(outputPath, 'game'));

        assert.throws(
            () => validateCliOptions({
                mode: 'translate',
                type: 'json',
                inputPath,
                outputPath
            }),
            /Output directory already exists/
        );
    });
});

test('validateCliOptions allows existing parent output directory for explicit directory input', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(dir, 'out');
        mkdirSync(inputPath);
        mkdirSync(outputPath);

        assert.doesNotThrow(() => validateCliOptions({
            mode: 'decompile',
            inputPath,
            outputPath,
            directoryOutputMode: 'explicit-parent'
        }));
    });
});

test('validateCliOptions rejects implicit directory output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(dir, 'game-decompiled');
        mkdirSync(inputPath);
        mkdirSync(outputPath);

        assert.throws(
            () => validateCliOptions({
                mode: 'decompile',
                inputPath,
                outputPath,
                directoryOutputMode: 'implicit-final'
            }),
            /Output directory already exists/
        );
    });
});

test('validateCliOptions rejects implicit text translate language output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(inputPath, 'chinese');
        mkdirSync(inputPath);
        mkdirSync(outputPath, { recursive: true });

        assert.throws(
            () => validateCliOptions({
                mode: 'translate',
                type: 'text',
                language: 'chinese',
                inputPath,
                outputPath,
                directoryOutputMode: 'implicit-final'
            }),
            /Output directory already exists/
        );
    });
});

test('validateCliOptions rejects implicit json translate output path that already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(inputPath, 'translate-json');
        mkdirSync(inputPath);
        mkdirSync(outputPath, { recursive: true });

        assert.throws(
            () => validateCliOptions({
                mode: 'translate',
                type: 'json',
                language: null,
                inputPath,
                outputPath,
                directoryOutputMode: 'implicit-final'
            }),
            /Output directory already exists/
        );
    });
});

test('validateCliOptions rejects unpack-rpa directory input with explicit message', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'scripts');
        const outputPath = join(dir, 'out');
        mkdirSync(inputPath);

        assert.throws(
            () => validateCliOptions({
                mode: 'unpack-rpa',
                inputPath,
                outputPath
            }),
            /must be a \.rpa file, got directory/
        );
    });
});

test('validateCliOptions rejects unpack-rpa output path that is a file', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'archive.rpa');
        const outputPath = join(dir, 'out');
        writeFileSync(inputPath, 'dummy');
        writeFileSync(outputPath, 'not a directory');

        assert.throws(
            () => validateCliOptions({
                mode: 'unpack-rpa',
                inputPath,
                outputPath
            }),
            /not a directory/
        );
    });
});

test('validateCliOptions rejects unpack-rpa when target archive directory already exists', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'archive.rpa');
        const outputPath = join(dir, 'out');
        writeFileSync(inputPath, 'dummy');
        mkdirSync(outputPath);
        mkdirSync(join(outputPath, 'archive'));

        assert.throws(
            () => validateCliOptions({
                mode: 'unpack-rpa',
                inputPath,
                outputPath
            }),
            /Output directory already exists/
        );
    });
});

test('collectInputFiles finds only rpyc files recursively', () => {
    withTempDir((dir) => {
        mkdirSync(join(dir, 'nested'));
        writeFileSync(join(dir, 'a.rpyc'), 'a');
        writeFileSync(join(dir, 'nested', 'b.rpyc'), 'b');
        writeFileSync(join(dir, 'nested', 'ignore.txt'), 'c');

        const result = collectInputFiles(dir);

        assert.equal(result.isSingleFileInput, false);
        assert.equal(result.inputBase, dir);
        assert.deepEqual(result.filesToProcess.sort(), [
            join(dir, 'a.rpyc'),
            join(dir, 'nested', 'b.rpyc')
        ]);
    });
});

test('isProcessableDirectoryEntry matches only rpyc files', () => {
    assert.equal(isProcessableDirectoryEntry('script.rpyc'), true);
    assert.equal(isProcessableDirectoryEntry('script.bin'), false);
});

test('validateDirectoryOutputPath rejects existing implicit-final output directory', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'game');
        const outputPath = join(dir, 'game-decompiled');
        mkdirSync(inputPath);
        mkdirSync(outputPath);

        assert.throws(
            () => validateDirectoryOutputPath(inputPath, outputPath, { directoryOutputMode: 'implicit-final' }),
            /Output directory already exists/
        );
    });
});

test('getOutputPath maps directory input to json output extension', () => {
    const outputPath = getOutputPath(
        '/tmp/project/game/script.rpyc',
        '/tmp/project/game',
        '/tmp/project/out/game',
        { mode: 'translate', type: 'json' }
    );

    assert.equal(outputPath, '/tmp/project/out/game/script.json');
});

test('getArchiveOutputPath uses archive basename under output dir', () => {
    const outputPath = getArchiveOutputPath('/tmp/game/archive.rpa', '/tmp/out');
    assert.equal(outputPath, '/tmp/out/archive');
});

test('validateUnpackRpaOptions resolves final archive output path', () => {
    withTempDir((dir) => {
        const inputPath = join(dir, 'archive.rpa');
        const outputDir = join(dir, 'out');
        writeFileSync(inputPath, 'dummy');
        mkdirSync(outputDir);

        const result = validateUnpackRpaOptions(inputPath, outputDir);

        assert.equal(result.resolvedInputPath, inputPath);
        assert.equal(result.resolvedOutputDir, outputDir);
        assert.equal(result.finalOutputPath, join(outputDir, 'archive'));
    });
});

test('run writes directory input under explicit output plus input directory name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-test-'));

    try {
        const inputPath = join(dir, 'scripts');
        const outputPath = join(dir, 'out');
        mkdirSync(inputPath);
        writeFileSync(join(inputPath, 'script.rpyc'), 'dummy');

        let capturedOutputBase = null;

        await run({
            inputPath,
            outputPath,
            directoryOutputMode: 'explicit-parent',
            logger: { info: () => {}, error: () => {} },
            processFile: async (filePath, inputBase, outputBase) => {
                capturedOutputBase = outputBase;
                return {
                    filePath,
                    outputPath: join(outputBase, 'script.rpy')
                };
            }
        });

        assert.equal(capturedOutputBase, join(outputPath, 'scripts'));
        assert.equal(existsSync(outputPath), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('run writes implicit directory output directly to derived output directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-test-'));

    try {
        const inputPath = join(dir, 'scripts');
        const outputPath = join(dir, 'scripts-decompiled');
        mkdirSync(inputPath);
        writeFileSync(join(inputPath, 'script.rpyc'), 'dummy');

        let capturedOutputBase = null;

        await run({
            inputPath,
            outputPath,
            directoryOutputMode: 'implicit-final',
            logger: { info: () => {}, error: () => {} },
            processFile: async (filePath, inputBase, outputBase) => {
                capturedOutputBase = outputBase;
                return {
                    filePath,
                    outputPath: join(outputBase, 'script.rpy')
                };
            }
        });

        assert.equal(capturedOutputBase, outputPath);
        assert.equal(existsSync(outputPath), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('run writes implicit text translate directory output under language directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-test-'));

    try {
        const inputPath = join(dir, 'game');
        const outputPath = join(inputPath, 'chinese');
        mkdirSync(inputPath);
        writeFileSync(join(inputPath, 'script.rpyc'), 'dummy');

        let capturedOutputBase = null;

        await run({
            mode: 'translate',
            type: 'text',
            language: 'chinese',
            inputPath,
            outputPath,
            directoryOutputMode: 'implicit-final',
            logger: { info: () => {}, error: () => {} },
            processFile: async (filePath, inputBase, outputBase) => {
                capturedOutputBase = outputBase;
                return {
                    filePath,
                    outputPath: join(outputBase, 'script.rpy')
                };
            }
        });

        assert.equal(capturedOutputBase, outputPath);
        assert.equal(existsSync(outputPath), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('run writes implicit json translate directory output under translate-json directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unrpyc-pure-test-'));

    try {
        const inputPath = join(dir, 'game');
        const outputPath = join(inputPath, 'translate-json');
        mkdirSync(inputPath);
        writeFileSync(join(inputPath, 'script.rpyc'), 'dummy');

        let capturedOutputBase = null;

        await run({
            mode: 'translate',
            type: 'json',
            inputPath,
            outputPath,
            directoryOutputMode: 'implicit-final',
            logger: { info: () => {}, error: () => {} },
            processFile: async (filePath, inputBase, outputBase) => {
                capturedOutputBase = outputBase;
                return {
                    filePath,
                    outputPath: join(outputBase, 'script.json')
                };
            }
        });

        assert.equal(capturedOutputBase, outputPath);
        assert.equal(existsSync(outputPath), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

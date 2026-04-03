#!/usr/bin/env node

import { realpathSync, statSync, existsSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

import { run, validateOutputTarget } from './core/rpyc.js';
import { unpackRpa, validateUnpackRpaOptions } from './core/rpa.js';

const USAGE = `Usage:
  unrpyc <input> [output]
  unrpyc --gen-translate text <language> <input> [output]
  unrpyc --gen-translate json <input> [output]
  unrpyc --unpack-rpa <input.rpa> <output-dir>

Modes:
  Default decompile:
    unrpyc <input> [output]

  Translation text output (.rpy):
    unrpyc --gen-translate text <language> <input> [output]

  Translation JSON output (.json):
    unrpyc --gen-translate json <input> [output]

  RPA unpack:
    unrpyc --unpack-rpa <input.rpa> [output-dir]

Path rules:
  - Single .rpyc input with no output -> writes next to input as .rpy
  - text translate single-file input with no output -> writes into <input-dir>/<language>/<file>.rpy
  - Directory input with no output -> writes into <input>-decompiled/
  - Directory input with explicit output -> writes into <output>/<input-name>/
  - text output writes .rpy files
  - text translate directory input with no output -> writes into <input>/<language>/
  - json output writes .json files
  - json translate single-file input with no output -> writes into <input-dir>/translate-json/<file>.json
  - json translate directory input with no output -> writes into <input>/translate-json/
  - Only text output requires <language>
  - --unpack-rpa only accepts a single .rpa file
  - --unpack-rpa defaults output-dir to the current directory
  - --unpack-rpa writes into <output-dir>/<archive-name>/`;

function getDefaultDecompileOutputPath(inputPath) {
    return join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.rpy`);
}

function getDefaultDirectoryOutputPath(inputPath) {
    return join(dirname(inputPath), `${basename(inputPath)}-decompiled`);
}

function getDefaultTextTranslateFileOutputPath(inputPath, language) {
    return join(dirname(inputPath), language, `${basename(inputPath, extname(inputPath))}.rpy`);
}

function getDefaultTextTranslateDirectoryOutputPath(inputPath, language) {
    return join(inputPath, language);
}

function getDefaultJsonTranslateFileOutputPath(inputPath) {
    return join(dirname(inputPath), 'translate-json', `${basename(inputPath, extname(inputPath))}.json`);
}

function getDefaultJsonTranslateDirectoryOutputPath(inputPath) {
    return join(inputPath, 'translate-json');
}

function normalizeLogger(logger = console) {
    if (typeof logger === 'function') {
        return {
            info: logger,
            error: logger
        };
    }

    return {
        info: logger?.log ?? logger?.info ?? (() => {}),
        error: logger?.error ?? logger?.log ?? (() => {})
    };
}

export function parseArgs(argv = []) {
    const args = [...argv];
    const options = {
        mode: 'decompile',
        type: null,
        language: null,
        inputPath: null,
        outputPath: null,
        directoryOutputMode: 'explicit-parent'
    };

    if (args[0] === '--gen-translate') {
        const type = args[1];
        if (!type || !['text', 'json'].includes(type)) {
            return { usage: USAGE };
        }

        options.mode = 'translate';
        options.type = type;

        if (type === 'text') {
            const language = args[2];
            if (!language) {
                return { usage: USAGE };
            }

            options.language = language;
            args.splice(0, 3);
        } else {
            args.splice(0, 2);
        }
    } else if (args[0] === '--unpack-rpa') {
        options.mode = 'unpack-rpa';
        args.splice(0, 1);
    }

    if (options.mode === 'unpack-rpa') {
        if (args.length < 1) {
            return { usage: USAGE };
        }

        options.inputPath = args[0];
        options.outputPath = args[1] ?? '.';
        return { options };
    }

    if (args.length < 1) {
        return { usage: USAGE };
    }

    options.inputPath = args[0];

    if (args.length >= 2) {
        options.outputPath = args[1];
        return { options };
    }

    if (!existsSync(options.inputPath)) {
        return { usage: USAGE };
    }

    const inputStat = statSync(options.inputPath);

    if (inputStat.isFile()) {
        if (options.mode === 'translate' && options.type === 'text') {
            options.outputPath = getDefaultTextTranslateFileOutputPath(args[0], options.language);
        } else if (options.mode === 'translate' && options.type === 'json') {
            options.outputPath = getDefaultJsonTranslateFileOutputPath(args[0]);
        } else {
            options.outputPath = getDefaultDecompileOutputPath(args[0]);
        }

        return { options };
    }

    if (inputStat.isDirectory()) {
        if (options.mode === 'translate' && options.type === 'text') {
            options.outputPath = getDefaultTextTranslateDirectoryOutputPath(args[0], options.language);
        } else if (options.mode === 'translate' && options.type === 'json') {
            options.outputPath = getDefaultJsonTranslateDirectoryOutputPath(args[0]);
        } else {
            options.outputPath = getDefaultDirectoryOutputPath(args[0]);
        }

        options.directoryOutputMode = 'implicit-final';
        return { options };
    }

    return { usage: USAGE };
}

export function validateCliOptions(options) {
    if (options.mode === 'translate') {
        if (!['text', 'json'].includes(options.type)) {
            throw new Error(`Unsupported translate type: ${options.type}`);
        }

        if (options.type === 'text' && !options.language) {
            throw new Error('text translate mode requires a language');
        }
    }

    if (options.mode === 'unpack-rpa') {
        validateUnpackRpaOptions(options.inputPath, options.outputPath);
        return;
    }

    validateOutputTarget(options.inputPath, options.outputPath, options, options);
}

function getCompletionMessage(options) {
    if (options.mode === 'unpack-rpa') {
        return 'RPA unpack complete.';
    }

    if (options.mode !== 'translate') {
        return 'Decompilation complete.';
    }

    if (options.type === 'json') {
        return 'Translation JSON generation complete.';
    }

    return 'Translation template generation complete.';
}

export async function main(argv = process.argv.slice(2), logger = console) {
    const normalizedLogger = normalizeLogger(logger);
    const parsed = parseArgs(argv);

    if (parsed.usage) {
        normalizedLogger.info(parsed.usage);
        return 0;
    }

    validateCliOptions(parsed.options);

    const result = parsed.options.mode === 'unpack-rpa'
        ? await unpackRpa(parsed.options.inputPath, parsed.options.outputPath, {
            logger: {
                info: (message) => normalizedLogger.info(message),
                warn: (message) => normalizedLogger.error(message),
                error: (message) => normalizedLogger.error(message)
            }
        })
        : await run({
            ...parsed.options,
            logger: {
                info: (message) => normalizedLogger.info(message),
                error: (message) => normalizedLogger.error(message)
            }
        });

    if ((result.processedFiles?.length ?? result.processedEntries?.length ?? 0) > 0) {
        normalizedLogger.info(`\n${getCompletionMessage(parsed.options)}`);
    }

    return result.errors.length > 0 ? 1 : 0;
}

async function runAsCli() {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

const isMainModule = process.argv[1]
    && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    await runAsCli();
}

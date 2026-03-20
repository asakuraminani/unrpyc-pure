#!/usr/bin/env node

import { realpathSync, statSync } from 'fs';
import { fileURLToPath } from 'url';

import { run } from './core.js';

const USAGE = `Usage:
  unrpyc <input> <output>
  unrpyc --gen-translate text <language> <input> <output>
  unrpyc --gen-translate json <input> <output>

Modes:
  Default decompile:
    unrpyc <input> <output>

  Translation text output (.rpy):
    unrpyc --gen-translate text <language> <input> <output>

  Translation JSON output (.json):
    unrpyc --gen-translate json <input> <output>

Path rules:
  - Single .rpyc input -> single output file
  - Directory input -> output directory
  - text output writes .rpy files
  - json output writes .json files
  - Only text output requires <language>`;

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
        outputPath: null
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
    }

    if (args.length < 2) {
        return { usage: USAGE };
    }

    options.inputPath = args[0];
    options.outputPath = args[1];

    return { options };
}

export function validateCliOptions(options) {
    if (options.mode !== 'translate') {
        return;
    }

    if (!['text', 'json'].includes(options.type)) {
        throw new Error(`Unsupported translate type: ${options.type}`);
    }

    if (options.type === 'text' && !options.language) {
        throw new Error('text translate mode requires a language');
    }

    const inputStat = statSync(options.inputPath);

    if (inputStat.isFile()) {
        const expectedExtension = options.type === 'json' ? '.json' : '.rpy';
        if (!options.outputPath.endsWith(expectedExtension)) {
            throw new Error(`Single-file ${options.type} translate output must end with ${expectedExtension}`);
        }
    }
}

function getCompletionMessage(options) {
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

    const result = await run({
        ...parsed.options,
        logger: {
            info: (message) => normalizedLogger.info(message),
            error: (message) => normalizedLogger.error(message)
        }
    });

    if (result.processedFiles.length > 0) {
        normalizedLogger.info(`\n${getCompletionMessage(parsed.options)}`);
    }

    return result.errors.length > 0 ? 1 : 0;
}

async function runAsCli() {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error('An error occurred during decompilation:');
        console.error(error);
        process.exitCode = 1;
    }
}

const isMainModule = process.argv[1]
    && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    await runAsCli();
}

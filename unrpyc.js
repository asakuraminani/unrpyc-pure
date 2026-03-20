#!/usr/bin/env node

import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

import { main } from './cli.js';

export { main, parseArgs, validateCliOptions } from './cli.js';
export { decompileRpyc, genTranslate, processFile, collectInputFiles, getOutputPath, traverse } from './core.js';

const isMainModule = process.argv[1]
    && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error('An error occurred during decompilation:');
        console.error(error);
        process.exitCode = 1;
    }
}

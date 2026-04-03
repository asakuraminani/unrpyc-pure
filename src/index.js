#!/usr/bin/env node

import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

import { main } from './node/cli.js';

export { main, parseArgs, validateCliOptions } from './node/cli.js';
export { decompileRpyc, genTranslate, processFile, collectInputFiles, getOutputPath, traverse, run } from './node/core/rpyc.js';
export { unpackRpa, getArchiveOutputPath } from './node/core/rpa.js';
export { openRpa, parseRpaFile, extractRpaEntry } from './browser.js';

const isMainModule = process.argv[1]
    && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error('An error occurred during processing:');
        console.error(error);
        process.exitCode = 1;
    }
}

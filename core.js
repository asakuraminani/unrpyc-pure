import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname, relative } from 'path';

import { createOutputFromBuffer, normalizeOperation } from './pipeline.js';

const NOOP = () => {};

function normalizeLogger(logger = null) {
    if (typeof logger === 'function') {
        return { info: logger, error: logger };
    }

    return {
        info: logger?.info ?? NOOP,
        error: logger?.error ?? NOOP
    };
}

function normalizeInputBuffer(input) {
    if (typeof input === 'string') {
        return readFileSync(input);
    }

    if (input instanceof Uint8Array) {
        return input;
    }

    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }

    throw new Error('decompileRpyc input must be a file path, Uint8Array, or ArrayBuffer');
}

function createOutput(input, options = {}) {
    return createOutputFromBuffer(normalizeInputBuffer(input), options, {
        appendTrailingNewline: true
    });
}

function getOutputExtension(operation) {
    if (operation.mode === 'translate' && operation.type === 'json') {
        return '.json';
    }

    return '.rpy';
}

function describeOperation(operation) {
    if (operation.mode === 'translate' && operation.type === 'json') {
        return 'Generating translation JSON for';
    }

    if (operation.mode === 'translate') {
        return 'Generating translation template for';
    }

    return 'Decompiling';
}

function validateSingleFileOutputPath(inputPath, outputPath, operation) {
    const expectedExtension = getOutputExtension(operation);

    if (!outputPath.endsWith(expectedExtension)) {
        throw new Error(`Single-file ${operation.mode === 'translate' ? `${operation.type} translate` : 'decompile'} output must end with ${expectedExtension}`);
    }

    if (existsSync(outputPath) && !statSync(outputPath).isFile()) {
        throw new Error(`Output path exists and is not a file: ${outputPath}`);
    }
}

export function* traverse(root) {
    const stat = statSync(root);
    if (stat.isFile()) {
        if (root.endsWith('.rpyc')) {
            yield root;
        }
        return;
    }

    if (stat.isDirectory()) {
        const files = readdirSync(root);
        for (const file of files) {
            const fullPath = join(root, file);
            yield* traverse(fullPath);
        }
    }
}

export function collectInputFiles(inputPath) {
    const inputStat = statSync(inputPath);
    let filesToProcess = [];
    let inputBase = inputPath;
    let isSingleFileInput = false;

    if (inputStat.isFile()) {
        if (inputPath.endsWith('.rpyc')) {
            filesToProcess = [inputPath];
            inputBase = dirname(inputPath);
            isSingleFileInput = true;
        }
    } else if (inputStat.isDirectory()) {
        filesToProcess = Array.from(traverse(inputPath));
    }

    return { filesToProcess, inputBase, isSingleFileInput };
}

export function getOutputPath(filePath, inputBase, outputBase, operation, options = {}) {
    if (options.isSingleFileInput) {
        return outputBase;
    }

    const relativePath = relative(inputBase, filePath);
    const outputExtension = getOutputExtension(operation);

    return join(outputBase, relativePath.replace(/\.rpyc$/, outputExtension));
}

function ensureOutputTarget(outputPath, isSingleFileInput) {
    if (existsSync(outputPath)) {
        const outputStat = statSync(outputPath);

        if (isSingleFileInput) {
            if (!outputStat.isFile()) {
                throw new Error(`Output path exists and is not a file: ${outputPath}`);
            }
            return;
        }

        if (!outputStat.isDirectory()) {
            throw new Error(`Output path exists and is not a directory: ${outputPath}`);
        }
        return;
    }

    mkdirSync(isSingleFileInput ? dirname(outputPath) : outputPath, { recursive: true });
}

export async function processFile(filePath, inputBase, outputBase, options = {}) {
    const logger = normalizeLogger(options.logger);
    const operation = normalizeOperation(options);
    const outputPath = getOutputPath(filePath, inputBase, outputBase, operation, {
        isSingleFileInput: options.isSingleFileInput
    });
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    logger.info(`${describeOperation(operation)} ${filePath}...`);

    const relativeRpyPath = relative(inputBase, filePath).replace(/\.rpyc$/, '.rpy');
    const serializedOutput = createOutput(readFileSync(filePath), {
        mode: operation.mode,
        type: operation.type,
        language: operation.language,
        relativePath: relativeRpyPath
    });

    writeFileSync(outputPath, serializedOutput);
    logger.info(`  -> Wrote ${outputPath}`);

    return {
        filePath,
        outputPath,
        relativePath: relative(inputBase, filePath),
        relativeRpyPath
    };
}

export async function run(options = {}) {
    const logger = normalizeLogger(options.logger);
    const operation = normalizeOperation(options);

    if (!options.inputPath) {
        throw new Error('inputPath is required');
    }
    if (!options.outputPath) {
        throw new Error('outputPath is required');
    }

    const inputPath = resolve(options.inputPath);
    const outputPath = resolve(options.outputPath);

    if (!existsSync(inputPath)) {
        throw new Error(`Input path not found: ${inputPath}`);
    }

    const { filesToProcess, inputBase, isSingleFileInput } = collectInputFiles(inputPath);

    if (isSingleFileInput) {
        validateSingleFileOutputPath(inputPath, outputPath, operation);
    }

    ensureOutputTarget(outputPath, isSingleFileInput);

    if (filesToProcess.length === 0) {
        logger.info('No .rpyc files found to decompile.');
        return {
            mode: operation.mode,
            type: operation.type,
            language: operation.language,
            inputPath,
            outputPath,
            inputBase,
            processedFiles: [],
            writtenFiles: [],
            errors: []
        };
    }

    logger.info(`Found ${filesToProcess.length} file(s) to process.`);

    const processedFiles = [];
    const writtenFiles = [];
    const errors = [];

    for (const filePath of filesToProcess) {
        processedFiles.push(filePath);

        try {
            const result = await processFile(filePath, inputBase, outputPath, {
                ...options,
                mode: operation.mode,
                type: operation.type,
                language: operation.language,
                logger,
                isSingleFileInput
            });
            writtenFiles.push(result.outputPath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Error processing ${filePath}: ${message}`);
            errors.push({ filePath, message });
        }
    }

    return {
        mode: operation.mode,
        type: operation.type,
        language: operation.language,
        inputPath,
        outputPath,
        inputBase,
        processedFiles,
        writtenFiles,
        errors
    };
}

export function decompileRpyc(inputPath, outputPath, options = {}) {
    return run({ ...options, mode: 'decompile', inputPath, outputPath });
}

export function genTranslate(inputPath, outputPath, type, options = {}) {
    return run({ ...options, mode: 'translate', type, inputPath, outputPath });
}

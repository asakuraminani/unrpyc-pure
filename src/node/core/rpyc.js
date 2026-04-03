import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname, relative, basename } from 'path';

import { createOutputFromBuffer, normalizeOperation } from '../../lib/pipeline.js';

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

export function isProcessableDirectoryEntry(filePath) {
    return filePath.endsWith('.rpyc');
}

export function validateSingleFileInputPath(inputPath) {
    if (!isProcessableDirectoryEntry(inputPath)) {
        throw new Error(`Single-file input must be a .rpyc file: ${inputPath}`);
    }
}

function replaceRpycExtension(filePath, extension) {
    return filePath.replace(/\.rpyc$/, extension);
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

export function validateSingleFileOutputPath(inputPath, outputPath, operation) {
    const expectedExtension = getOutputExtension(operation);

    if (!outputPath.endsWith(expectedExtension)) {
        throw new Error(`Single-file ${operation.mode === 'translate' ? `${operation.type} translate` : 'decompile'} output must end with ${expectedExtension}`);
    }

    if (existsSync(outputPath)) {
        const outputStat = statSync(outputPath);
        if (!outputStat.isFile()) {
            throw new Error(`Output path exists and is not a file: ${outputPath}`);
        }
        throw new Error(`Output file already exists: ${outputPath}`);
    }
}

export function* traverse(root) {
    const stat = statSync(root);
    if (stat.isFile()) {
        if (isProcessableDirectoryEntry(root)) {
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
        filesToProcess = [inputPath];
        inputBase = dirname(inputPath);
        isSingleFileInput = true;
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

    return join(outputBase, replaceRpycExtension(relativePath, outputExtension));
}

export function getDirectoryOutputRoot(inputPath, options = {}) {
    return options.directoryOutputMode === 'implicit-final' ? null : basename(inputPath);
}

export function validateDirectoryOutputPath(inputPath, outputPath, options = {}) {
    if (!existsSync(outputPath)) {
        return;
    }

    const outputStat = statSync(outputPath);
    if (!outputStat.isDirectory()) {
        throw new Error(`Output path exists and is not a directory: ${outputPath}`);
    }

    const directoryOutputRoot = getDirectoryOutputRoot(inputPath, options);
    const directoryOutputPath = directoryOutputRoot ? join(outputPath, directoryOutputRoot) : outputPath;
    if (existsSync(directoryOutputPath)) {
        throw new Error(`Output directory already exists: ${directoryOutputPath}`);
    }
}

export function validateOutputTarget(inputPath, outputPath, operation, options = {}) {
    const { isSingleFileInput } = collectInputFiles(inputPath);

    if (isSingleFileInput) {
        validateSingleFileInputPath(inputPath);
        validateSingleFileOutputPath(inputPath, outputPath, operation);
        return { isSingleFileInput, directoryOutputRoot: null };
    }

    const directoryOutputRoot = getDirectoryOutputRoot(inputPath, options);
    validateDirectoryOutputPath(inputPath, outputPath, options);
    return { isSingleFileInput, directoryOutputRoot };
}

function ensureOutputTarget(outputPath, isSingleFileInput) {
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

    const { filesToProcess, inputBase } = collectInputFiles(inputPath);
    const { isSingleFileInput, directoryOutputRoot } = validateOutputTarget(inputPath, outputPath, operation, options);
    const outputBase = directoryOutputRoot ? join(outputPath, directoryOutputRoot) : outputPath;

    ensureOutputTarget(outputPath, isSingleFileInput);

    if (filesToProcess.length === 0) {
        logger.info(`No ${describeOperation(operation).toLowerCase()} files found to process.`);
        return {
            mode: operation.mode,
            type: operation.type,
            language: operation.language,
            inputPath,
            outputBase,
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
    const fileProcessor = options.processFile ?? processFile;

    for (const filePath of filesToProcess) {
        processedFiles.push(filePath);

        try {
            const result = await fileProcessor(filePath, inputBase, outputBase, {
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

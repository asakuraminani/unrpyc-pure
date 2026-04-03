import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'path';

import { parseRpaFile, extractRpaEntry } from '../../lib/unrpa.js';

const NOOP = () => {};

function normalizeLogger(logger = null) {
    if (typeof logger === 'function') {
        return { info: logger, warn: logger, error: logger };
    }

    return {
        info: logger?.info ?? NOOP,
        warn: logger?.warn ?? NOOP,
        error: logger?.error ?? NOOP
    };
}

export function getArchiveOutputPath(inputPath, outputDir) {
    return join(outputDir, basename(inputPath, '.rpa'));
}

function sanitizeEntryPath(entryPath) {
    const normalizedPath = normalize(String(entryPath)).replace(/^([/\\])+/, '');

    if (!normalizedPath || normalizedPath === '.' || normalizedPath === '..') {
        throw new Error(`Invalid archive entry path: ${entryPath}`);
    }

    if (isAbsolute(normalizedPath) || normalizedPath.startsWith('..') || normalizedPath.includes('../') || normalizedPath.includes('..\\')) {
        throw new Error(`Refusing to write archive entry outside output directory: ${entryPath}`);
    }

    return normalizedPath;
}

function ensureDirectory(path) {
    if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
        return;
    }

    if (!statSync(path).isDirectory()) {
        throw new Error(`Output path exists and is not a directory: ${path}`);
    }
}

export function validateUnpackRpaOptions(inputPath, outputDir) {
    const resolvedInputPath = resolve(inputPath);
    const resolvedOutputDir = resolve(outputDir);

    if (!existsSync(resolvedInputPath)) {
        throw new Error(`Input path not found: ${resolvedInputPath}`);
    }

    const inputStat = statSync(resolvedInputPath);
    if (!inputStat.isFile()) {
        throw new Error(`Input path for --unpack-rpa must be a .rpa file, got directory: ${resolvedInputPath}`);
    }
    if (!resolvedInputPath.endsWith('.rpa')) {
        throw new Error('unpack-rpa input must be a .rpa file');
    }

    if (existsSync(resolvedOutputDir) && !statSync(resolvedOutputDir).isDirectory()) {
        throw new Error(`Output path exists and is not a directory: ${resolvedOutputDir}`);
    }

    const finalOutputPath = getArchiveOutputPath(resolvedInputPath, resolvedOutputDir);
    if (existsSync(finalOutputPath)) {
        throw new Error(`Output directory already exists: ${finalOutputPath}`);
    }

    return { resolvedInputPath, resolvedOutputDir, finalOutputPath };
}

function resolveEntryOutputPath(baseDir, entryPath) {
    const safeRelativePath = sanitizeEntryPath(entryPath);
    const targetPath = join(baseDir, safeRelativePath);
    const relativePath = relative(baseDir, targetPath);

    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error(`Refusing to write archive entry outside output directory: ${entryPath}`);
    }

    return targetPath;
}

export async function unpackRpa(inputPath, outputDir, options = {}) {
    const logger = normalizeLogger(options.logger);

    if (!inputPath) {
        throw new Error('inputPath is required');
    }
    if (!outputDir) {
        throw new Error('outputPath is required');
    }

    const { resolvedInputPath, resolvedOutputDir, finalOutputPath } = validateUnpackRpaOptions(inputPath, outputDir);

    ensureDirectory(resolvedOutputDir);
    mkdirSync(finalOutputPath, { recursive: true });

    const readSource = options.readSource ?? readFileSync;
    const source = readSource(resolvedInputPath);
    const archiveParser = options.parseRpaFile ?? parseRpaFile;
    const entryExtractor = options.extractRpaEntry ?? extractRpaEntry;

    const parsed = await archiveParser(source, { logger });
    const processedEntries = [];
    const writtenFiles = [];
    const errors = [];

    logger.info(`Found ${parsed.entries.length} archive entr${parsed.entries.length === 1 ? 'y' : 'ies'} to extract.`);

    for (const entry of parsed.entries) {
        processedEntries.push(entry);

        try {
            const targetPath = resolveEntryOutputPath(finalOutputPath, entry.path);
            ensureDirectory(dirname(targetPath));
            const data = await entryExtractor(source, entry);
            writeFileSync(targetPath, data);
            writtenFiles.push(targetPath);
            logger.info(`  -> Wrote ${targetPath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Error extracting ${entry.path}: ${message}`);
            errors.push({ path: entry.path, message });
        }
    }

    return {
        mode: 'unpack-rpa',
        inputPath: resolvedInputPath,
        outputPath: finalOutputPath,
        entryCount: parsed.entries.length,
        processedEntries,
        writtenFiles,
        errors
    };
}

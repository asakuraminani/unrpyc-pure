import { Options, Decompiler } from './ast_handlers.js';
import { Translator } from './translate.js';
import { loadRpycBuffer, extractStatements } from './util.js';

const RUN_MODES = ['decompile', 'translate'];
const TRANSLATE_TYPES = ['text', 'json'];

export function normalizeOperation(options = {}) {
    const mode = options.mode ?? 'decompile';
    const type = mode === 'translate' ? (options.type ?? 'text') : null;
    const language = options.language ?? null;

    if (!RUN_MODES.includes(mode)) {
        throw new Error(`Unsupported mode: ${mode}`);
    }

    if (mode === 'translate' && !TRANSLATE_TYPES.includes(type)) {
        throw new Error(`Unsupported translate type: ${type}`);
    }

    if (mode === 'translate' && type === 'text' && !language) {
        throw new Error('language is required for translate text output');
    }

    return { mode, type, language };
}

export function renderScript(statements) {
    const optionsForDecompiler = new Options();
    optionsForDecompiler.init_offset = true;

    const decompiler = new Decompiler(null, optionsForDecompiler);
    decompiler.dump(statements);

    return decompiler._buffer;
}

export function parseStatementsFromBuffer(buffer) {
    const pickleRoot = loadRpycBuffer(buffer);

    if (!pickleRoot) {
        throw new Error('Failed to parse .rpyc input');
    }

    const statements = extractStatements(pickleRoot);
    if (!statements.length) {
        throw new Error('No script statements found in .rpyc input');
    }

    return statements;
}

export function buildOutput(statements, relativeRpyPath, operation) {
    if (operation.mode === 'decompile') {
        return statements;
    }

    const translator = new Translator(operation.type === 'text' ? operation.language : null, false);

    if (operation.type === 'text') {
        return translator.generate_translation_ast(statements, relativeRpyPath);
    }

    return translator.generate_translation_json(statements, relativeRpyPath);
}

export function serializeOutput(output, operation, options = {}) {
    if (operation.mode === 'translate' && operation.type === 'json') {
        const serialized = JSON.stringify(output, null, 2);
        return options.appendTrailingNewline ? `${serialized}\n` : serialized;
    }

    return renderScript(output);
}

export function createOutputFromBuffer(buffer, options = {}, serializeOptions = {}) {
    const operation = normalizeOperation(options);
    const statements = parseStatementsFromBuffer(buffer);
    const output = buildOutput(statements, options.relativePath ?? 'script.rpy', operation);
    return serializeOutput(output, operation, serializeOptions);
}

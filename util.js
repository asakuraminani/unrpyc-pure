/**
 * Utility functions and base decompiler class for unrpyc.js
 * Ported from unrpyc/decompiler/util.py
 */

import { unzlibSync } from 'fflate';
import { Parser } from 'pickleparser';

function createLoosePObject(module, name) {
    const PObject = function (...args) {
        if (new.target) {
            this.args = args;
        } else {
            const PFunction = function (...innerArgs) {
                this.args = innerArgs;
            };
            PFunction.prototype.__module__ = module;
            PFunction.prototype.__name__ = name;
            return Reflect.construct(PFunction, args);
        }
    };
    PObject.prototype.__module__ = module;
    PObject.prototype.__name__ = name;
    PObject.prototype.__setnewargs_ex__ = function (...kwargs) {
        this.kwargs = kwargs;
    };
    return PObject;
}

export class StringWriter {
    constructor() {
        this.buffer = '';
    }

    write(string) {
        this.buffer += String(string);
    }

    getvalue() {
        return this.buffer;
    }
}

/**
 * Parses Ren'Py RPC2 file format.
 */
export function parseRPC2(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let pos = 10;
    const chunks = {};
    while (pos + 12 <= buffer.byteLength) {
        const slot = view.getUint32(pos, true);
        const start = view.getUint32(pos + 4, true);
        const length = view.getUint32(pos + 8, true);
        pos += 12;
        if (slot === 0) break;
        if (start + length <= buffer.byteLength) {
            chunks[slot] = buffer.slice ? buffer.slice(start, start + length) : new Uint8Array(buffer.buffer, buffer.byteOffset + start, length);
        }
    }
    if (!chunks[1]) return null;
    return unzlibSync(chunks[1]);
}

/**
 * Loads and unpickles an .rpyc file buffer.
 */
export function loadRpycBuffer(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.length < 10) return null;
    let raw;
    if (u8[0] === 0x52 && u8[1] === 0x45 && u8[2] === 0x4e) {
        raw = parseRPC2(u8);
    } else {
        try {
            raw = unzlibSync(u8);
        } catch (_) {
            return null;
        }
    }
    if (!raw || raw.length === 0) return null;
    const parser = new Parser({
        nameResolver: {
            resolve: (module, name) => createLoosePObject(module, name)
        }
    });
    try {
        return parser.parse(raw);
    } catch (_) {
        return null;
    }
}

/**
 * Extracts a flat list of AST nodes from the unpickled object.
 */
export function extractStatements(pickleRoot) {
    if (!pickleRoot) return [];
    if (Array.isArray(pickleRoot)) {
        if (pickleRoot.length >= 2 && Array.isArray(pickleRoot[1])) return pickleRoot[1];
        if (pickleRoot.length >= 1 && Array.isArray(pickleRoot[0])) return pickleRoot[0];
        return pickleRoot.filter(Boolean);
    }
    if (pickleRoot?.statements && Array.isArray(pickleRoot.statements)) return pickleRoot.statements;
    if (pickleRoot?.[1] && Array.isArray(pickleRoot[1])) return pickleRoot[1];
    if (typeof pickleRoot === 'object') return [pickleRoot];
    return [];
}

/**
 * Base class for configuration options.
 */
export class OptionBase {
    /**
     * @param {string} indentation - The string to use for indentation (default: "    ")
     * @param {string[]} log - Array to store debug/error logs
     */
    constructor(indentation = "    ", log = null) {
        this.indentation = indentation;
        this.log = log || [];
    }
}

/**
 * Base class for the decompiler, handling state management and output.
 */
export class DecompilerBase {
    /**
     * @param {Object} out_file - Output stream or object with write() method
     * @param {OptionBase} options - Decompilation options
     */
    constructor(out_file = null, options = new OptionBase()) {
        this.out_file = out_file || new StringWriter();
        this.options = options;
        this.indentation = options.indentation;

        this.linenumber = 0;
        this.indent_level = 0;
        this.skip_indent_until_write = false;

        this.block_stack = [];
        this.index_stack = [];
        this.blank_line_queue = [];

        this._buffer = this.getvalue();
    }

    dump(ast, indent_level = 0, linenumber = 1, skip_indent_until_write = false) {
        this.indent_level = indent_level;
        this.linenumber = linenumber;
        this.skip_indent_until_write = skip_indent_until_write;
        if (!Array.isArray(ast)) {
            ast = [ast];
        }
        this.print_nodes(ast);
        this._syncBuffer();
        return this.linenumber;
    }

    increase_indent(amount = 1) {
        this.indent_level += amount;
        return {
            dispose: () => {
                this.indent_level -= amount;
            }
        };
    }

    _syncBuffer() {
        this._buffer = this.getvalue();
    }

    getvalue() {
        if (this.out_file && typeof this.out_file.getvalue === 'function') {
            return this.out_file.getvalue();
        }
        return this._buffer || '';
    }

    write(string) {
        string = String(string);
        this.linenumber += (string.match(/\n/g) || []).length;
        this.skip_indent_until_write = false;
        this.out_file.write(string);
        this._syncBuffer();
    }

    write_lines(lines) {
        for (const line of lines) {
            if (line === '') {
                this.write('\n');
            } else {
                this.indent();
                this.write(line);
            }
        }
    }

    save_state() {
        const state = {
            out_file: this.out_file,
            skip_indent_until_write: this.skip_indent_until_write,
            linenumber: this.linenumber,
            block_stack: [...this.block_stack],
            index_stack: [...this.index_stack],
            indent_level: this.indent_level,
            blank_line_queue: [...this.blank_line_queue]
        };
        this.out_file = new StringWriter();
        this._syncBuffer();
        return state;
    }

    commit_state(state) {
        state.out_file.write(this.out_file.getvalue());
        this.out_file = state.out_file;
        this._syncBuffer();
    }

    rollback_state(state) {
        this.out_file = state.out_file;
        this.skip_indent_until_write = state.skip_indent_until_write;
        this.linenumber = state.linenumber;
        this.block_stack = state.block_stack;
        this.index_stack = state.index_stack;
        this.indent_level = state.indent_level;
        this.blank_line_queue = state.blank_line_queue;
        this._syncBuffer();
    }

    advance_to_line(linenumber) {
        this.blank_line_queue = this.blank_line_queue.filter(m => m(linenumber));

        if (this.linenumber < linenumber) {
            this.write("\n".repeat(linenumber - this.linenumber - 1));
        }
    }

    do_when_blank_line(m) {
        this.blank_line_queue.push(m);
    }

    indent() {
        if (!this.skip_indent_until_write) {
            this.write('\n' + this.indentation.repeat(this.indent_level));
        }
    }

    print_nodes(ast, extra_indent = 0) {
        const indentScope = this.increase_indent(extra_indent);
        this.block_stack.push(ast);
        this.index_stack.push(0);

        for (let i = 0; i < ast.length; i++) {
            this.index_stack[this.index_stack.length - 1] = i;
            this.print_node(ast[i]);
        }

        this.block_stack.pop();
        this.index_stack.pop();
        indentScope.dispose();
    }

    get block() {
        return this.block_stack[this.block_stack.length - 1];
    }

    get index() {
        return this.index_stack[this.index_stack.length - 1];
    }

    get parent() {
        if (this.block_stack.length < 2) return null;
        return this.block_stack[this.block_stack.length - 2][this.index_stack[this.index_stack.length - 2]];
    }

    print_debug(message) {
        this.options.log.push(message);
    }

    write_failure(message) {
        this.print_debug(message);
        this.indent();
        this.write(`pass # <<<COULD NOT DECOMPILE: ${message}>>>`);
    }

    print_unknown(ast) {
        this.write_failure(`Unknown AST node: ${getNodeName(ast)}`);
    }

    print_node(ast) {
        throw new Error("Not implemented");
    }
}

/**
 * Helper to handle first-time logic in loops.
 * Returns yes_value on the first call, and no_value on subsequent calls.
 */
export class First {
    constructor(yes_value = true, no_value = false) {
        this.yes_value = yes_value;
        this.no_value = no_value;
        this.first = true;
    }

    call() {
        if (this.first) {
            this.first = false;
            return this.yes_value;
        }
        return this.no_value;
    }
}

/**
 * Helper to concatenate words with spaces intelligently.
 */
export class WordConcatenator {
    constructor(needs_space = false, reorderable = false) {
        this.words = [];
        this.needs_space = needs_space;
        this.reorderable = reorderable;
    }

    append(...words) {
        this.words.push(...words.filter(Boolean));
    }

    join() {
        if (!this.words.length) {
            return '';
        }

        if (this.reorderable && this.words[this.words.length - 1].endsWith(' ')) {
            for (let i = this.words.length - 1; i >= 0; i--) {
                if (!this.words[i].endsWith(' ')) {
                    this.words.push(this.words.splice(i, 1)[0]);
                    break;
                }
            }
        }

        const lastWord = this.words[this.words.length - 1];
        this.words = this.words.map((word, index) => index === this.words.length - 1 ? lastWord : (word.endsWith(' ') ? word.slice(0, -1) : word));
        const rv = `${this.needs_space ? ' ' : ''}${this.words.join(' ')}`;
        this.needs_space = !rv.endsWith(' ');
        return rv;
    }
}

// --- AST Helper Functions ---

/**
 * Safely extracts attributes from an AST node object.
 * Handles cases where the object itself is the attribute dict or it's nested in 'attrs' or pickle slots.
 * @param {Object} node - The AST node
 * @returns {Object|null} The attributes object
 */
export function getAttrs(node) {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    let state = node['1'] ?? node[1] ?? node.attrs;
    
    // If state is found in slot 1, use it and mixin metadata
    if (state) {
        return { 
            ...state, 
            __module__: node.__module__, 
            __name__: node.__name__ 
        };
    }
    
    // Fallback: assume the object itself holds the state
    const out = { ...node };
    if (node.__module__ !== undefined) out.__module__ = node.__module__;
    if (node.__name__ !== undefined) out.__name__ = node.__name__;
    return out;
}

/**
 * Gets the class name of an AST node.
 * @param {Object} node - The AST node
 * @returns {string} The class name
 */
export function getNodeName(node) {
    const attrs = getAttrs(node);
    if (attrs && (attrs.__name__ || attrs.name)) return attrs.__name__ ?? attrs.name;
    if (typeof node === 'function' && node.prototype && node.prototype.__name__) return node.prototype.__name__;
    return '';
}

/**
 * Gets the module name of an AST node.
 * @param {Object} node - The AST node
 * @returns {string} The module name
 */
export function getNodeModule(node) {
    const attrs = getAttrs(node);
    if (attrs && attrs.__module__) return attrs.__module__;
    if (typeof node === 'function' && node.prototype && node.prototype.__module__) return node.prototype.__module__;
    return '';
}

/**
 * Recursively extracts source code string from a code object (e.g. PyExpr).
 * @param {Object|string} obj - The code object or string
 * @returns {string} The extracted source code
 */
export function extractSource(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

    const attrs = getAttrs(obj);

    // Handle PyExpr / PObject with args
    if (obj.args && Array.isArray(obj.args) && obj.args.length > 0) {
        if (obj.__name__ === 'PyExpr') {
            return String(obj.args[0]);
        }
    }

    // Handle PyCode
    if (obj.__name__ === 'PyCode') {
        if (attrs && attrs.source) {
             const inner = attrs.source;
             if (typeof inner === 'string') return inner;
             if (inner && typeof inner === 'object') return extractSource(inner);
        }
        if (obj.args && obj.args.length > 0 && typeof obj.args[0] === 'string') {
             return obj.args[0];
        }
        if (typeof obj['1'] === 'string') return obj['1'];
        if (typeof attrs?.['1'] === 'string') return attrs['1'];
        if (obj['1']) return extractSource(obj['1']);
        if (attrs && attrs['1']) return extractSource(attrs['1']);
    }

    if (obj.source !== undefined) return String(obj.source);
    if (obj.code !== undefined) return String(obj.code);
    if (attrs && attrs.source !== undefined) return String(attrs.source);

    // Fallback: try to be helpful
    if (obj.__name__) return `[${obj.__name__}]`;
    
    // Check if it is a plain object with numeric keys (pickle tuple/list)
    if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) {
             return obj.map(o => extractSource(o)).join(', ');
        }
        
        const keys = Object.keys(obj);
        if (keys.length > 0 && keys.every(k => !isNaN(parseInt(k)))) {
             const vals = [];
             for (let i = 0; i < keys.length; i++) {
                  if (obj[i] !== undefined) vals.push(extractSource(obj[i]));
             }
             return `(${vals.join(', ')})`;
        }
    }
    
    return String(obj);
}

/**
 * Escapes a string for use in Ren'Py script (handling quotes and newlines).
 * @param {string} s - The string to escape
 * @returns {string} The escaped string
 */
export function string_escape(s) {
    if (s == null) return '';
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"')
        .replace(/(?<= ) /g, '\\ ');
}

export function encode_say_string(s) {
    return `"${string_escape(s)}"`;
}

export function say_get_code(ast, inmenu = false) {
    const attrs = getAttrs(ast);
    if (!attrs) return '';

    const rv = [];

    if (attrs.who) {
        rv.push(extractSource(attrs.who));
    }

    if (attrs.attributes != null) {
        rv.push(...attrs.attributes);
    }

    if (attrs.temporary_attributes != null) {
        rv.push('@');
        rv.push(...attrs.temporary_attributes);
    }

    rv.push(encode_say_string(attrs.what ?? ''));

    if (!attrs.interact && !inmenu) {
        rv.push('nointeract');
    }

    if (attrs.explicit_identifier) {
        rv.push('id', attrs.identifier);
    } else if (attrs.identifier != null) {
        rv.push('id', attrs.identifier);
    }

    if (attrs.arguments != null) {
        rv.push(reconstruct_arginfo(attrs.arguments));
    }

    if (attrs.with_) {
        rv.push('with', extractSource(attrs.with_));
    }

    return rv.join(' ');
}

export function split_logical_lines(source) {
    if (!source) return [];

    const text = String(source);
    const lines = [];
    let contained = 0;
    let start = 0;
    let pos = 0;

    const scanString = (index) => {
        let i = index;
        if ((text[i] === 'u' || text[i] === 'U') && (text[i + 1] === '"' || text[i + 1] === "'")) {
            i += 1;
        }

        const quote = text[i];
        if (quote !== '"' && quote !== "'") {
            return index;
        }

        const triple = text[i + 1] === quote && text[i + 2] === quote;
        i += triple ? 3 : 1;

        while (i < text.length) {
            if (triple) {
                if (text[i] === quote && text[i + 1] === quote && text[i + 2] === quote) {
                    return i + 3;
                }
                i += 1;
                continue;
            }

            if (text[i] === '\\') {
                i += 2;
                continue;
            }

            if (text[i] === quote) {
                return i + 1;
            }

            i += 1;
        }

        return text.length;
    };

    while (pos < text.length) {
        const c = text[pos];

        if (c === '\n' && contained === 0 && (pos === 0 || text[pos - 1] !== '\\')) {
            lines.push(text.slice(start, pos));
            pos += 1;
            start = pos;
            continue;
        }

        if (c === '(' || c === '[' || c === '{') {
            contained += 1;
            pos += 1;
            continue;
        }

        if ((c === ')' || c === ']' || c === '}') && contained > 0) {
            contained -= 1;
            pos += 1;
            continue;
        }

        if (c === '#') {
            while (pos < text.length && text[pos] !== '\n') {
                pos += 1;
            }
            continue;
        }

        const stringEnd = scanString(pos);
        if (stringEnd !== pos) {
            pos = stringEnd;
            continue;
        }

        pos += 1;
    }

    if (pos !== start) {
        lines.push(text.slice(start));
    }

    return lines;
}

/**
 * Reconstructs a parameter list string (e.g. for function definitions).
 * @param {Object} paraminfo - The parameter info object
 * @returns {string} The formatted parameter string
 */
export function reconstruct_paraminfo(paraminfo) {
    if (paraminfo === null || paraminfo === undefined) return '';

    paraminfo = getAttrs(paraminfo);
    if (!paraminfo) return '()';

    const unpackParamTuple = (parameter) => {
        if (Array.isArray(parameter)) return [parameter[0], parameter[1]];
        const attrs = getAttrs(parameter);
        if (!attrs) return [undefined, undefined];
        return [attrs[0] ?? attrs['0'] ?? attrs.name, attrs[1] ?? attrs['1'] ?? attrs.default];
    };

    const formatParam = (name, defaultVal) => {
        let s = String(name);
        if (defaultVal !== null && defaultVal !== undefined) {
            s += '=' + extractSource(defaultVal);
        }
        return s;
    };

    if ('positional_only' in paraminfo) {
        const parameters = Array.isArray(paraminfo.parameters) ? paraminfo.parameters : [];
        const positionalOnly = Array.isArray(paraminfo.positional_only) ? paraminfo.positional_only : [];
        const keywordOnly = Array.isArray(paraminfo.keyword_only) ? paraminfo.keyword_only : [];

        const alreadyAccounted = new Set();
        for (const entry of positionalOnly) {
            const [name] = unpackParamTuple(entry);
            alreadyAccounted.add(name);
        }
        for (const entry of keywordOnly) {
            const [name] = unpackParamTuple(entry);
            alreadyAccounted.add(name);
        }

        const other = parameters
            .map(unpackParamTuple)
            .filter(([name]) => !alreadyAccounted.has(name));

        const parts = [];

        for (const entry of positionalOnly) {
            const [name, defaultVal] = unpackParamTuple(entry);
            parts.push(formatParam(name, defaultVal));
        }

        if (positionalOnly.length > 0) {
            parts.push('/');
        }

        for (const [name, defaultVal] of other) {
            parts.push(formatParam(name, defaultVal));
        }

        if (paraminfo.extrapos) {
            parts.push(`*${paraminfo.extrapos}`);
        } else if (keywordOnly.length > 0) {
            parts.push('*');
        }

        for (const entry of keywordOnly) {
            const [name, defaultVal] = unpackParamTuple(entry);
            parts.push(formatParam(name, defaultVal));
        }

        if (paraminfo.extrakw) {
            parts.push(`**${paraminfo.extrakw}`);
        }

        return `(${parts.join(', ')})`;
    }

    if ('extrapos' in paraminfo || 'extrakw' in paraminfo || 'positional' in paraminfo) {
        let parameters = paraminfo.parameters;
        let extrapos = paraminfo.extrapos;
        let extrakw = paraminfo.extrakw;

        if (!parameters && (Array.isArray(paraminfo) || paraminfo['0'] !== undefined)) {
            parameters = paraminfo[0] ?? paraminfo['0'];
            extrapos = paraminfo[2] ?? paraminfo['2'];
            extrakw = paraminfo[3] ?? paraminfo['3'];
        }

        const parameterList = Array.isArray(parameters) ? parameters.map(unpackParamTuple) : [];
        const positionalSet = new Set(Array.isArray(paraminfo.positional) ? paraminfo.positional : []);
        const positional = parameterList.filter(([name]) => positionalSet.has(name));
        const nameonly = parameterList.filter(([name]) => !positionalSet.has(name));
        const parts = [];

        for (const [name, defaultVal] of positional) {
            parts.push(formatParam(name, defaultVal));
        }

        if (extrapos) {
            parts.push(`*${extrapos}`);
        }

        if (nameonly.length > 0) {
            if (!extrapos) {
                parts.push('*');
            }
            for (const [name, defaultVal] of nameonly) {
                parts.push(formatParam(name, defaultVal));
            }
        }

        if (extrakw) {
            parts.push(`**${extrakw}`);
        }

        return `(${parts.join(', ')})`;
    }

    const rawParameters = paraminfo.parameters;
    let parameters = [];
    if (rawParameters instanceof Map) {
        parameters = Array.from(rawParameters.values());
    } else if (Array.isArray(rawParameters)) {
        parameters = rawParameters;
    } else if (rawParameters && typeof rawParameters === 'object') {
        parameters = Object.values(rawParameters);
    }

    const orderedParameters = parameters
        .map(parameter => getAttrs(parameter))
        .filter(parameter => parameter && parameter.name !== undefined && parameter.kind !== undefined);

    const parts = [];
    let state = 1;

    for (const parameter of orderedParameters) {
        if (parameter.kind === 0) {
            state = 0;
            parts.push(formatParam(parameter.name, parameter.default));
            continue;
        }

        if (state === 0) {
            state = 1;
            parts.push('/');
        }

        if (parameter.kind === 1) {
            parts.push(formatParam(parameter.name, parameter.default));
        } else if (parameter.kind === 2) {
            state = 2;
            parts.push(`*${parameter.name}`);
        } else if (parameter.kind === 3) {
            if (state === 1) {
                state = 2;
                parts.push('*');
            }
            parts.push(formatParam(parameter.name, parameter.default));
        } else if (parameter.kind === 4) {
            state = 3;
            parts.push(`**${parameter.name}`);
        }
    }

    return `(${parts.join(', ')})`;
}

/**
 * Reconstructs an argument list string (e.g. for function calls).
 * @param {Object} arginfo - The argument info object
 * @returns {string} The formatted argument string
 */
/**
 * Reconstructs an argument list string (e.g. for function calls).
 * @param {Object} arginfo - The argument info object
 * @returns {string} The formatted argument string
 */
export function reconstruct_arginfo(arginfo) {
    if (!arginfo) return '';
    arginfo = getAttrs(arginfo); // Unwrap PObject if needed
    const args = arginfo.arguments;
    if (!args || !Array.isArray(args)) return '';
    const parts = [];
    const starred = arginfo.starred_indexes ?? new Set();
    const doublestarred = arginfo.doublestarred_indexes ?? new Set();
    for (let i = 0; i < args.length; i++) {
        const [name, val] = Array.isArray(args[i]) ? args[i] : [args[i]?.name, args[i]?.val];
        if (starred.has && starred.has(i)) parts.push('*' + extractSource(val ?? ''));
        else if (doublestarred.has && doublestarred.has(i)) parts.push('**' + extractSource(val ?? ''));
        else if (name != null && name !== '') parts.push(name + '=' + extractSource(val ?? ''));
        else parts.push(extractSource(val ?? ''));
    }
    return '(' + parts.join(', ') + ')';
}

// --- Displayable Mappings ---
// Maps (ClassName, StyleName) -> (OutputName, ChildCount/Type)
// ChildCount: 0=none, 1=one, 'many'=list
export const DISPLAYABLE_NAMES = [
    [['renpy.display.behavior.AreaPicker', 'default'], ['areapicker', 1]],
    [['renpy.display.behavior.Button', 'button'], ['button', 1]],
    [['renpy.display.behavior.DismissBehavior', 'default'], ['dismiss', 0]],
    [['renpy.display.behavior.Input', 'input'], ['input', 0]],
    [['renpy.display.behavior.MouseArea', 0], ['mousearea', 0]],
    [['renpy.display.behavior.MouseArea', null], ['mousearea', 0]],
    [['renpy.display.behavior.OnEvent', 0], ['on', 0]],
    [['renpy.display.behavior.OnEvent', null], ['on', 0]],
    [['renpy.display.behavior.Timer', 'default'], ['timer', 0]],
    [['renpy.display.dragdrop.Drag', 'drag'], ['drag', 1]],
    [['renpy.display.dragdrop.Drag', null], ['drag', 1]],
    [['renpy.display.dragdrop.DragGroup', null], ['draggroup', 'many']],
    [['renpy.display.im.image', 'default'], ['image', 0]],
    [['renpy.display.layout.Grid', 'grid'], ['grid', 'many']],
    [['renpy.display.layout.MultiBox', 'fixed'], ['fixed', 'many']],
    [['renpy.display.layout.MultiBox', 'hbox'], ['hbox', 'many']],
    [['renpy.display.layout.MultiBox', 'vbox'], ['vbox', 'many']],
    [['renpy.display.layout.NearRect', 'default'], ['nearrect', 1]],
    [['renpy.display.layout.Null', 'default'], ['null', 0]],
    [['renpy.display.layout.Side', 'side'], ['side', 'many']],
    [['renpy.display.layout.Window', 'frame'], ['frame', 1]],
    [['renpy.display.layout.Window', 'window'], ['window', 1]],
    [['renpy.display.motion.Transform', 'transform'], ['transform', 1]],
    [['renpy.sl2.sldisplayables.sl2add', null], ['add', 0]],
    [['renpy.sl2.sldisplayables.sl2bar', null], ['bar', 0]],
    [['renpy.sl2.sldisplayables.sl2vbar', null], ['vbar', 0]],
    [['renpy.sl2.sldisplayables.sl2viewport', 'viewport'], ['viewport', 1]],
    [['renpy.sl2.sldisplayables.sl2vpgrid', 'vpgrid'], ['vpgrid', 'many']],
    [['renpy.text.text.Text', 'text'], ['text', 0]],
    [['renpy.display.transform.Transform', 'transform'], ['transform', 1]],
    [['renpy.ui._add', null], ['add', 0]],
    [['renpy.ui._hotbar', 'hotbar'], ['hotbar', 0]],
    [['renpy.ui._hotspot', 'hotspot'], ['hotspot', 1]],
    [['renpy.ui._imagebutton', 'image_button'], ['imagebutton', 0]],
    [['renpy.ui._imagemap', 'imagemap'], ['imagemap', 'many']],
    [['renpy.ui._key', null], ['key', 0]],
    [['renpy.ui._label', 'label'], ['label', 0]],
    [['renpy.ui._textbutton', 'button'], ['textbutton', 0]],
    [['renpy.ui._textbutton', 0], ['textbutton', 0]],
];

/**
 * Gets the output name and child type for a displayable class.
 */
export function getDisplayableName(clsModule, clsName, style) {
    const clsFullName = clsModule + '.' + clsName;
    for (const [[cName, sName], val] of DISPLAYABLE_NAMES) {
        if (cName === clsFullName && (sName === style || sName === 0 || sName === null)) {
            return val;
        }
    }
    if (style && typeof style === 'string') {
        return [style, 'many'];
    }
    return ['unknown', 'many'];
}

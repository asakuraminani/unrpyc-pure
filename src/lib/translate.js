/**
 * Translator support for unrpyc.js
 * Ported from unrpyc/decompiler/translate.py
 */

import { extractSource, getAttrs, getNodeName, say_get_code } from './util.js';

function leftRotate(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function add32(a, b) {
    return (a + b) >>> 0;
}

function cmn(q, a, b, x, s, t) {
    return add32(leftRotate(add32(add32(a, q), add32(x, t)), s), b);
}

function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t);
}

function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t);
}

function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
}

function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t);
}

function wordToHexLE(word) {
    return [
        word & 0xff,
        (word >>> 8) & 0xff,
        (word >>> 16) & 0xff,
        (word >>> 24) & 0xff
    ].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function md5Hex(input) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const words = new Uint32Array(16);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            words[i] = view.getUint32(offset + (i * 4), true);
        }

        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        a = ff(a, b, c, d, words[0], 7, 0xd76aa478); d = ff(d, a, b, c, words[1], 12, 0xe8c7b756); c = ff(c, d, a, b, words[2], 17, 0x242070db); b = ff(b, c, d, a, words[3], 22, 0xc1bdceee);
        a = ff(a, b, c, d, words[4], 7, 0xf57c0faf); d = ff(d, a, b, c, words[5], 12, 0x4787c62a); c = ff(c, d, a, b, words[6], 17, 0xa8304613); b = ff(b, c, d, a, words[7], 22, 0xfd469501);
        a = ff(a, b, c, d, words[8], 7, 0x698098d8); d = ff(d, a, b, c, words[9], 12, 0x8b44f7af); c = ff(c, d, a, b, words[10], 17, 0xffff5bb1); b = ff(b, c, d, a, words[11], 22, 0x895cd7be);
        a = ff(a, b, c, d, words[12], 7, 0x6b901122); d = ff(d, a, b, c, words[13], 12, 0xfd987193); c = ff(c, d, a, b, words[14], 17, 0xa679438e); b = ff(b, c, d, a, words[15], 22, 0x49b40821);

        a = gg(a, b, c, d, words[1], 5, 0xf61e2562); d = gg(d, a, b, c, words[6], 9, 0xc040b340); c = gg(c, d, a, b, words[11], 14, 0x265e5a51); b = gg(b, c, d, a, words[0], 20, 0xe9b6c7aa);
        a = gg(a, b, c, d, words[5], 5, 0xd62f105d); d = gg(d, a, b, c, words[10], 9, 0x02441453); c = gg(c, d, a, b, words[15], 14, 0xd8a1e681); b = gg(b, c, d, a, words[4], 20, 0xe7d3fbc8);
        a = gg(a, b, c, d, words[9], 5, 0x21e1cde6); d = gg(d, a, b, c, words[14], 9, 0xc33707d6); c = gg(c, d, a, b, words[3], 14, 0xf4d50d87); b = gg(b, c, d, a, words[8], 20, 0x455a14ed);
        a = gg(a, b, c, d, words[13], 5, 0xa9e3e905); d = gg(d, a, b, c, words[2], 9, 0xfcefa3f8); c = gg(c, d, a, b, words[7], 14, 0x676f02d9); b = gg(b, c, d, a, words[12], 20, 0x8d2a4c8a);

        a = hh(a, b, c, d, words[5], 4, 0xfffa3942); d = hh(d, a, b, c, words[8], 11, 0x8771f681); c = hh(c, d, a, b, words[11], 16, 0x6d9d6122); b = hh(b, c, d, a, words[14], 23, 0xfde5380c);
        a = hh(a, b, c, d, words[1], 4, 0xa4beea44); d = hh(d, a, b, c, words[4], 11, 0x4bdecfa9); c = hh(c, d, a, b, words[7], 16, 0xf6bb4b60); b = hh(b, c, d, a, words[10], 23, 0xbebfbc70);
        a = hh(a, b, c, d, words[13], 4, 0x289b7ec6); d = hh(d, a, b, c, words[0], 11, 0xeaa127fa); c = hh(c, d, a, b, words[3], 16, 0xd4ef3085); b = hh(b, c, d, a, words[6], 23, 0x04881d05);
        a = hh(a, b, c, d, words[9], 4, 0xd9d4d039); d = hh(d, a, b, c, words[12], 11, 0xe6db99e5); c = hh(c, d, a, b, words[15], 16, 0x1fa27cf8); b = hh(b, c, d, a, words[2], 23, 0xc4ac5665);

        a = ii(a, b, c, d, words[0], 6, 0xf4292244); d = ii(d, a, b, c, words[7], 10, 0x432aff97); c = ii(c, d, a, b, words[14], 15, 0xab9423a7); b = ii(b, c, d, a, words[5], 21, 0xfc93a039);
        a = ii(a, b, c, d, words[12], 6, 0x655b59c3); d = ii(d, a, b, c, words[3], 10, 0x8f0ccc92); c = ii(c, d, a, b, words[10], 15, 0xffeff47d); b = ii(b, c, d, a, words[1], 21, 0x85845dd1);
        a = ii(a, b, c, d, words[8], 6, 0x6fa87e4f); d = ii(d, a, b, c, words[15], 10, 0xfe2ce6e0); c = ii(c, d, a, b, words[6], 15, 0xa3014314); b = ii(b, c, d, a, words[13], 21, 0x4e0811a1);
        a = ii(a, b, c, d, words[4], 6, 0xf7537e82); d = ii(d, a, b, c, words[11], 10, 0xbd3af235); c = ii(c, d, a, b, words[2], 15, 0x2ad7d2bb); b = ii(b, c, d, a, words[9], 21, 0xeb86d391);

        a0 = add32(a0, a);
        b0 = add32(b0, b);
        c0 = add32(c0, c);
        d0 = add32(d0, d);
    }

    return `${wordToHexLE(a0)}${wordToHexLE(b0)}${wordToHexLE(c0)}${wordToHexLE(d0)}`;
}

function getBlockDigest(block, getCanonicalCode) {
    let buffer = '';

    for (const node of block) {
        buffer += `${getCanonicalCode(node)}\r\n`;
    }

    return md5Hex(buffer).slice(0, 8);
}

function makeNode(name, attrs = {}) {
    return {
        __name__: name,
        __module__: 'renpy.ast',
        attrs
    };
}

function makeCommentNode(text) {
    return makeNode('UserStatement', {
        line: text,
        translatable: false,
        block: null
    });
}

function getNodeLinenumber(node) {
    return getAttrs(node)?.linenumber ?? node?.linenumber ?? getAttrs(node)?.loc?.[1] ?? node?.loc?.[1] ?? null;
}

function cloneNode(ast) {
    if (ast == null || typeof ast !== 'object') {
        return ast;
    }

    const clone = Object.assign(Object.create(Object.getPrototypeOf(ast) || Object.prototype), ast);

    if (ast['1'] && typeof ast['1'] === 'object') {
        clone['1'] = { ...ast['1'] };
    }
    if (ast[1] && typeof ast[1] === 'object' && ast[1] !== ast['1']) {
        clone[1] = { ...ast[1] };
    }
    if (ast.attrs && typeof ast.attrs === 'object') {
        clone.attrs = { ...ast.attrs };
    }

    return clone;
}

function setNodeLinenumber(ast, linenumber) {
    if (ast == null || typeof ast !== 'object') {
        return;
    }

    if (ast['1'] && typeof ast['1'] === 'object') {
        ast['1'].linenumber = linenumber;
    }
    if (ast[1] && typeof ast[1] === 'object') {
        ast[1].linenumber = linenumber;
    }
    if (ast.attrs && typeof ast.attrs === 'object') {
        ast.attrs.linenumber = linenumber;
    }
    ast.linenumber = linenumber;
}

function clearNodeLinenumber(ast) {
    if (ast == null || typeof ast !== 'object') {
        return;
    }

    if (ast['1'] && typeof ast['1'] === 'object') {
        delete ast['1'].linenumber;
    }
    if (ast[1] && typeof ast[1] === 'object') {
        delete ast[1].linenumber;
    }
    if (ast.attrs && typeof ast.attrs === 'object') {
        delete ast.attrs.linenumber;
    }
    delete ast.linenumber;
}

function quoteCommentForNode(node) {
    const name = getNodeName(node);
    if (name === 'Say') {
        return `# ${say_get_code(node)}`;
    }
    return `# ${getAttrs(node)?.line ?? ''}`;
}

function makeTranslateStringNode(language, relativePath, oldText, line) {
    return makeNode('TranslateString', {
        language,
        old: oldText,
        new: oldText,
        location_comment: line != null ? `# game/${relativePath}:${line}` : null
    });
}

function isBlockNode(name) {
    return ['Init', 'Label', 'While'].includes(name);
}

function walkMenuBlocks(items, collect) {
    for (const item of items ?? []) {
        if (item?.[2] != null) {
            collect(item[2]);
        }
    }
}

function walkIfBlocks(entries, collect) {
    for (const entry of entries ?? []) {
        if (entry?.[1] != null) {
            collect(entry[1]);
        }
    }
}

function walkSubblocks(node, collect) {
    const name = getNodeName(node);
    const attrs = getAttrs(node);

    if (name === 'Menu') {
        walkMenuBlocks(attrs?.items, collect);
    } else if (name === 'If') {
        walkIfBlocks(attrs?.entries, collect);
    } else if (isBlockNode(name)) {
        collect(attrs?.block ?? []);
    }
}

function collectMenuStrings(node, strings, context = {}) {
    const attrs = getAttrs(node);
    const baseLine = getNodeLinenumber(node);

    for (const item of attrs?.items ?? []) {
        const label = item?.[0];
        if (typeof label === 'string' && !strings.has(label)) {
            strings.set(label, {
                line: baseLine,
                label: context.label ?? null,
                alternate: context.alternate ?? null
            });
        }
    }
}

function cloneTemplateNode(node) {
    const cloned = cloneNode(node);
    clearNodeLinenumber(cloned);
    return cloned;
}

function makeTemplateTranslateNode(language, relativePath, identifier, alternate, sourceLine, block) {
    const translatedBlock = [];

    for (const node of block) {
        translatedBlock.push(makeCommentNode(quoteCommentForNode(node)));
        translatedBlock.push(cloneTemplateNode(node));
    }

    return makeNode('Translate', {
        language,
        identifier,
        alternate,
        block: translatedBlock,
        location_comment: sourceLine != null ? `# game/${relativePath}:${sourceLine}` : null
    });
}

function resetTranslatorContext(translator) {
    translator.identifiers.clear();
    translator.label = null;
    translator.alternate = null;
}

function updateTranslatorContext(translator, node) {
    const name = getNodeName(node);
    const attrs = getAttrs(node);

    if (name === 'Label' && !attrs?.hide) {
        if (String(attrs?.name ?? '').startsWith('_')) {
            translator.alternate = attrs?.name ?? null;
        } else {
            translator.label = attrs?.name ?? null;
            translator.alternate = null;
        }
    }
}

function makeJsonEntry(type, text, line, options = {}) {
    const entry = {
        type,
        line,
        text
    };

    if (options.identifier != null) {
        entry.identifier = options.identifier;
    }
    if (options.alternate != null) {
        entry.alternate = options.alternate;
    }
    if (options.digest != null) {
        entry.digest = options.digest;
    }
    if (options.label != null) {
        entry.label = options.label;
    }
    if (options.who != null) {
        entry.who = options.who;
    }

    return entry;
}

function getDialogueSpeaker(node) {
    const who = getAttrs(node)?.who;
    if (who == null) {
        return null;
    }

    const speaker = extractSource(who);
    return speaker === '' ? null : speaker;
}

function getIdentifierOptions(translator, block, label = translator.label) {
    const identifierData = translator.create_identifier_pair(block);
    return {
        identifier: identifierData.identifier,
        alternate: identifierData.alternate,
        digest: identifierData.digest,
        label
    };
}

function generateTranslationAst(translator, children, relativePath) {
    const generated = [];
    const strings = new Map();
    let group = [];

    resetTranslatorContext(translator);

    const flushGroup = () => {
        if (!group.length) {
            return;
        }
        const { identifier, alternate } = translator.create_identifier_pair(group);
        generated.push(makeTemplateTranslateNode(
            translator.language,
            relativePath,
            identifier,
            alternate,
            getNodeLinenumber(group[0]),
            group
        ));
        group = [];
    };

    const collect = (nodes) => {
        for (const node of nodes) {
            const name = getNodeName(node);
            const attrs = getAttrs(node);

            updateTranslatorContext(translator, node);

            if (name === 'Say') {
                group.push(node);
                flushGroup();
                continue;
            }

            if (attrs?.translatable) {
                group.push(node);
                continue;
            }

            flushGroup();

            if (name === 'Menu') {
                collectMenuStrings(node, strings, {
                    label: translator.label,
                    alternate: translator.alternate
                });
            }

            walkSubblocks(node, collect);
        }
    };

    collect(children);
    flushGroup();

    if (strings.size) {
        const stringNodes = [];
        for (const [oldText, metadata] of strings) {
            stringNodes.push(makeTranslateStringNode(translator.language, relativePath, oldText, metadata.line));
        }

        generated.push(makeNode('Init', {
            priority: 0,
            block: stringNodes
        }));
    }

    return generated;
}

function generateTranslationJson(translator, children) {
    const entries = [];
    const strings = new Map();

    resetTranslatorContext(translator);

    const collect = (nodes) => {
        for (const node of nodes) {
            const name = getNodeName(node);
            const attrs = getAttrs(node);

            updateTranslatorContext(translator, node);

            if (name === 'Say') {
                entries.push(makeJsonEntry(
                    'dialogue',
                    attrs?.what ?? '',
                    getNodeLinenumber(node),
                    {
                        ...getIdentifierOptions(translator, [node]),
                        who: getDialogueSpeaker(node)
                    }
                ));
                continue;
            }

            if (attrs?.translatable) {
                entries.push(makeJsonEntry(
                    'statement',
                    translator.get_canonical_code(node),
                    getNodeLinenumber(node),
                    getIdentifierOptions(translator, [node])
                ));
                continue;
            }

            if (name === 'TranslateString') {
                continue;
            }

            if (name === 'Menu') {
                collectMenuStrings(node, strings, {
                    label: translator.label,
                    alternate: translator.alternate
                });
            }

            walkSubblocks(node, collect);
        }
    };

    collect(children);

    for (const [text, metadata] of strings) {
        entries.push(makeJsonEntry(
            'string',
            text,
            metadata.line ?? null,
            {
                label: metadata.label ?? null
            }
        ));
    }

    return entries;
}

export class Translator {
    constructor(language, saving_translations = false) {
        this.language = language;
        this.saving_translations = saving_translations;
        this.strings = new Map();
        this.dialogue = new Map();
        this.identifiers = new Set();
        this.alternate = null;
        this.label = null;
    }

    unique_identifier(label, digest) {
        const base = label == null ? digest : `${String(label).replace(/\./g, '_')}_${digest}`;
        let i = 0;
        let suffix = '';

        while (this.identifiers.has(`${base}${suffix}`)) {
            i += 1;
            suffix = `_${i}`;
        }

        return `${base}${suffix}`;
    }

    get_canonical_code(node) {
        const name = getNodeName(node);
        if (name === 'Say') {
            return say_get_code(node);
        }
        if (name === 'UserStatement') {
            return getAttrs(node)?.line;
        }
        throw new Error(`Don't know how to get canonical code for a ${name || typeof node}`);
    }

    get_digest(block) {
        return getBlockDigest(block, (node) => this.get_canonical_code(node));
    }

    create_identifier_pair(block) {
        const digest = this.get_digest(block);
        const identifier = this.unique_identifier(this.label, digest);
        this.identifiers.add(identifier);

        let alternate = null;
        if (this.alternate != null) {
            alternate = this.unique_identifier(this.alternate, digest);
            this.identifiers.add(alternate);
        }

        return { digest, identifier, alternate };
    }

    create_translate(block) {
        if (this.saving_translations) {
            return [];
        }

        const { identifier, alternate } = this.create_identifier_pair(block);

        let translatedBlock = this.dialogue.get(identifier);
        if (translatedBlock == null && alternate != null) {
            translatedBlock = this.dialogue.get(alternate);
        }
        if (translatedBlock == null) {
            return block;
        }

        const oldLinenumber = getAttrs(block[0])?.linenumber ?? block[0]?.linenumber;
        return translatedBlock.map((node) => {
            const newAst = cloneNode(node);
            setNodeLinenumber(newAst, oldLinenumber);
            return newAst;
        });
    }

    walk(ast, f) {
        const name = getNodeName(ast);
        const attrs = getAttrs(ast);

        if (['Init', 'Label', 'While', 'Translate', 'TranslateBlock', 'TranslateEarlyBlock'].includes(name)) {
            f(attrs?.block ?? []);
        } else if (name === 'Menu') {
            for (const item of attrs?.items ?? []) {
                if (item?.[2] != null) {
                    f(item[2]);
                }
            }
        } else if (name === 'If') {
            for (const entry of attrs?.entries ?? []) {
                if (entry?.[1] != null) {
                    f(entry[1]);
                }
            }
        }
    }

    generate_translation_ast(children, relativePath) {
        return generateTranslationAst(this, children, relativePath);
    }

    generate_translation_json(children, relativePath) {
        return generateTranslationJson(this, children, relativePath);
    }

    translate_dialogue(children) {
        const newChildren = [];
        let group = [];

        for (const node of children) {
            const name = getNodeName(node);
            const attrs = getAttrs(node);

            if (name === 'Label' && !attrs?.hide) {
                if (String(attrs?.name ?? '').startsWith('_')) {
                    this.alternate = attrs?.name ?? null;
                } else {
                    this.label = attrs?.name ?? null;
                    this.alternate = null;
                }
            }

            if (this.saving_translations && name === 'TranslateString' && attrs?.language === this.language) {
                this.strings.set(attrs.old, attrs.new);
            }

            if (name !== 'Translate') {
                this.walk(node, (block) => this.translate_dialogue(block));
            } else if (this.saving_translations && attrs?.language === this.language) {
                this.dialogue.set(attrs.identifier, attrs.block);
                if (attrs.alternate != null) {
                    this.dialogue.set(attrs.alternate, attrs.block);
                }
            }

            if (name === 'Say') {
                group.push(node);
                newChildren.push(...this.create_translate(group));
                group = [];
            } else if (attrs?.translatable) {
                group.push(node);
            } else {
                if (group.length) {
                    newChildren.push(...this.create_translate(group));
                    group = [];
                }
                newChildren.push(node);
            }
        }

        if (group.length) {
            newChildren.push(...this.create_translate(group));
        }

        children.splice(0, children.length, ...newChildren);
    }
}

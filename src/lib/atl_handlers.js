/**
 * ATL (Animation Transformation Language) node handlers for unrpyc.js
 * Ported from unrpyc/decompiler/atldecompiler.py
 */

import {
    DecompilerBase,
    getNodeName,
    getAttrs,
    extractSource
} from './util.js';

function getLocLine(node) {
    return getAttrs(node)?.loc?.[1] ?? node?.loc?.[1] ?? null;
}

function isInvalidBlockLoc(loc) {
    return Array.isArray(loc) && loc[0] === '' && loc[1] === 0;
}

/**
 * Decompiler class specifically for ATL nodes.
 */
export class ATLDecompiler extends DecompilerBase {
    constructor(out_file, options) {
        super(out_file, options);
        this.dispatch_map = {
            RawMultipurpose: this.print_atl_rawmulti,
            RawBlock: this.print_atl_rawblock,
            RawChild: this.print_atl_rawchild,
            RawChoice: this.print_atl_rawchoice,
            RawContainsExpr: this.print_atl_rawcontainsexpr,
            RawEvent: this.print_atl_rawevent,
            RawFunction: this.print_atl_rawfunction,
            RawOn: this.print_atl_rawon,
            RawParallel: this.print_atl_rawparallel,
            RawRepeat: this.print_atl_rawrepeat,
            RawTime: this.print_atl_rawtime
        };
    }

    dump(ast, indent_level = 0, linenumber = 1, skip_indent_until_write = false) {
        this.indent_level = indent_level;
        this.linenumber = linenumber;
        this.skip_indent_until_write = skip_indent_until_write;
        this.print_block(ast);
        this._syncBuffer();
        return this.linenumber;
    }

    print_node(ast) {
        const name = getNodeName(ast);
        const attrs = getAttrs(ast);
        const loc = attrs?.loc;

        if (loc) {
            if (name === 'RawBlock') {
                this.advance_to_block(ast);
            } else if (loc[1]) {
                this.advance_to_line(loc[1]);
            }
        }

        const handler = this.dispatch_map[name];
        if (handler) {
            handler.call(this, ast);
        } else {
            this.print_unknown(ast);
        }
    }

    print_block(block) {
        const attrs = getAttrs(block);
        const indentScope = this.increase_indent();

        if (attrs?.animation) {
            this.indent();
            this.write('animation');
        }

        const statements = attrs?.statements || [];
        if (statements.length > 0) {
            this.print_nodes(statements);
        } else if (!isInvalidBlockLoc(attrs?.loc)) {
            this.indent();
            this.write('pass');
        }

        indentScope.dispose();
    }

    advance_to_block(block) {
        const loc = getAttrs(block)?.loc ?? block?.loc;
        if (!loc || isInvalidBlockLoc(loc)) return;
        this.advance_to_line(loc[1] - 1);
    }

    print_atl_rawmulti(node) {
        const attrs = getAttrs(node);
        const parts = [];

        if (attrs.warp_function) {
            parts.push(`warp ${extractSource(attrs.warp_function)} ${extractSource(attrs.duration)}`);
        } else if (attrs.warper) {
            parts.push(`${extractSource(attrs.warper)} ${extractSource(attrs.duration)}`);
        } else if (String(extractSource(attrs.duration)) !== '0') {
            parts.push(`pause ${extractSource(attrs.duration)}`);
        }

        if (attrs.revolution) {
            parts.push(extractSource(attrs.revolution));
        }

        if (String(extractSource(attrs.circles)) !== '0') {
            parts.push(`circles ${extractSource(attrs.circles)}`);
        }

        for (const spline of attrs.splines || []) {
            const [name, expressions] = spline;
            const exprs = Array.isArray(expressions) ? expressions : [];
            if (exprs.length > 0) {
                parts.push(`${name} ${extractSource(exprs[exprs.length - 1])}`);
                for (const expression of exprs.slice(0, -1)) {
                    parts.push(`knot ${extractSource(expression)}`);
                }
            }
        }

        for (const property of attrs.properties || []) {
            const [key, value] = property;
            parts.push(`${key} ${extractSource(value)}`);
        }

        const expressions = attrs.expressions || [];
        const needsPass = expressions.length > 1;
        for (const pair of expressions) {
            const [expression, withExpression] = pair;
            parts.push(extractSource(expression));
            if (withExpression) {
                parts.push(`with ${extractSource(withExpression)}`);
            }
            if (needsPass) {
                parts.push('pass');
            }
        }

        if (parts.length > 0) {
            this.indent();
            this.write(parts.join(' '));
        } else {
            this.write(',');
        }
    }

    print_atl_rawblock(node) {
        this.indent();
        this.write('block:');
        this.print_block(node);
    }

    print_atl_rawchild(node) {
        const attrs = getAttrs(node);
        for (const child of attrs.children || []) {
            this.advance_to_block(child);
            this.indent();
            this.write('contains:');
            this.print_block(child);
        }
    }

    print_atl_rawchoice(node) {
        const attrs = getAttrs(node);
        for (const choice of attrs.choices || []) {
            const [chance, block] = choice;
            this.advance_to_block(block);
            this.indent();
            this.write('choice');
            if (String(extractSource(chance)) !== '1.0') {
                this.write(` ${extractSource(chance)}`);
            }
            this.write(':');
            this.print_block(block);
        }

        const next = this.block?.[this.index + 1];
        if (getNodeName(next) === 'RawChoice') {
            this.indent();
            this.write('pass');
        }
    }

    print_atl_rawcontainsexpr(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`contains ${extractSource(attrs.expression)}`);
    }

    print_atl_rawevent(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`event ${attrs.name}`);
    }

    print_atl_rawfunction(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`function ${extractSource(attrs.expr)}`);
    }

    print_atl_rawon(node) {
        const attrs = getAttrs(node);
        let handlers = [];
        if (attrs.handlers instanceof Map) {
            handlers = Array.from(attrs.handlers.entries());
        } else if (attrs.handlers && typeof attrs.handlers === 'object') {
            handlers = Object.entries(attrs.handlers).filter(([name]) => name !== 'args');
        }

        handlers.sort((a, b) => (getLocLine(a[1]) ?? 0) - (getLocLine(b[1]) ?? 0));

        for (const [name, block] of handlers) {
            this.advance_to_block(block);
            this.indent();
            this.write(`on ${name}:`);
            this.print_block(block);
        }
    }

    print_atl_rawparallel(node) {
        const attrs = getAttrs(node);
        for (const block of attrs.blocks || []) {
            this.advance_to_block(block);
            this.indent();
            this.write('parallel:');
            this.print_block(block);
        }

        const next = this.block?.[this.index + 1];
        if (getNodeName(next) === 'RawParallel') {
            this.indent();
            this.write('pass');
        }
    }

    print_atl_rawrepeat(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write('repeat');
        if (attrs.repeats) {
            this.write(` ${extractSource(attrs.repeats)}`);
        }
    }

    print_atl_rawtime(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`time ${extractSource(attrs.time)}`);
    }
}

/**
 * Helper function to instantiate and run the ATL decompiler for a given AST.
 * Used when an ATL block is encountered in the main AST (e.g. show ... with ...).
 */
export function pprint(out_file, ast, options, indent_level, linenumber, skip_indent_until_write) {
    const d = new ATLDecompiler(out_file, options);
    return d.dump(ast, indent_level, linenumber, skip_indent_until_write);
}

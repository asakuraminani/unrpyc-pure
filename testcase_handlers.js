/**
 * Testcase node handlers for unrpyc.js
 * Ported from unrpyc/decompiler/testcasedecompiler.py
 */

import {
    DecompilerBase,
    getNodeName,
    getAttrs,
    string_escape,
    split_logical_lines,
    extractSource
} from './util.js';

export class TestcaseDecompiler extends DecompilerBase {
    constructor(out_file, options) {
        super(out_file, options);
        this.dispatch_map = {
            'Python': this.print_python,
            'If': this.print_if,
            'Assert': this.print_assert,
            'Jump': this.print_jump,
            'Call': this.print_call,
            'Action': this.print_action,
            'Pause': this.print_pause,
            'Label': this.print_label,
            'Type': this.print_type,
            'Drag': this.print_drag,
            'Move': this.print_move,
            'Click': this.print_click,
            'Scroll': this.print_scroll,
            'Until': this.print_until
        };
    }

    print_node(ast) {
        const linenumber = getAttrs(ast)?.linenumber ?? ast?.linenumber;
        if (linenumber !== undefined) {
            this.advance_to_line(linenumber);
        }

        const handler = this.dispatch_map[getNodeName(ast)];
        if (handler) {
            handler.call(this, ast);
        } else {
            this.print_unknown(ast);
        }
    }

    print_python(node) {
        const attrs = getAttrs(node);
        const code = extractSource(attrs?.code);
        if (!code) return;

        this.indent();
        if (code[0] === '\n') {
            this.write('python:');
            const indentScope = this.increase_indent();
            this.write_lines(split_logical_lines(code.slice(1)));
            indentScope.dispose();
        } else {
            this.write(`$ ${code}`);
        }
    }

    print_if(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`if ${attrs?.condition}:`);
        this.print_nodes(attrs?.block || [], 1);
    }

    print_assert(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`assert ${attrs?.expr}`);
    }

    print_jump(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`jump ${attrs?.target}`);
    }

    print_call(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`call ${attrs?.target}`);
    }

    print_action(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`run ${attrs?.expr}`);
    }

    print_pause(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`pause ${attrs?.expr}`);
    }

    print_label(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`label ${attrs?.name}`);
    }

    print_type(node) {
        const attrs = getAttrs(node);
        const keys = attrs?.keys || [];

        this.indent();
        if (keys[0] && keys[0].length === 1) {
            this.write(`type "${string_escape(keys.join(''))}"`);
        } else {
            this.write(`type ${keys[0]}`);
        }
        if (attrs?.pattern != null) {
            this.write(` pattern "${string_escape(attrs.pattern)}"`);
        }
        if (attrs?.position != null) {
            this.write(` pos ${attrs.position}`);
        }
    }

    print_drag(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`drag ${attrs?.points}`);
        if (attrs?.button != null && attrs.button !== 1) {
            this.write(` button ${attrs.button}`);
        }
        if (attrs?.pattern != null) {
            this.write(` pattern "${string_escape(attrs.pattern)}"`);
        }
        if (attrs?.steps != null && attrs.steps !== 10) {
            this.write(` steps ${attrs.steps}`);
        }
    }

    print_move(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`move ${attrs?.position}`);
        if (attrs?.pattern != null) {
            this.write(` pattern "${string_escape(attrs.pattern)}"`);
        }
    }

    print_click(node) {
        const attrs = getAttrs(node);
        this.indent();
        if (attrs?.pattern != null) {
            this.write(`"${string_escape(attrs.pattern)}"`);
        } else {
            this.write('click');
        }
        if (attrs?.button != null && attrs.button !== 1) {
            this.write(` button ${attrs.button}`);
        }
        if (attrs?.position != null) {
            this.write(` pos ${attrs.position}`);
        }
        if (attrs?.always) {
            this.write(' always');
        }
    }

    print_scroll(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`scroll "${string_escape(attrs?.pattern ?? '')}"`);
    }

    print_until(node) {
        const attrs = getAttrs(node);
        const rightLine = getAttrs(attrs?.right)?.linenumber ?? attrs?.right?.linenumber;
        if (rightLine !== undefined) {
            this.advance_to_line(rightLine);
        }
        this.print_node(attrs?.left);
        this.write(' until ');
        this.skip_indent_until_write = true;
        this.print_node(attrs?.right);
    }
}

export function pprint(out_file, ast, options, indent_level, linenumber, skip_indent_until_write) {
    const d = new TestcaseDecompiler(out_file, options);
    return d.dump(ast, indent_level, linenumber, skip_indent_until_write);
}

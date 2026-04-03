/**
 * SL2 (Screen Language 2) node handlers for unrpyc.js
 * Ported from unrpyc/decompiler/sl2decompiler.py
 */

import {
    DecompilerBase,
    getNodeName,
    getNodeModule,
    getAttrs,
    extractSource,
    getDisplayableName,
    reconstruct_paraminfo,
    reconstruct_arginfo,
    split_logical_lines
} from './util.js';
import * as atl from './atl_handlers.js';

function getLocationLine(node) {
    return getAttrs(node)?.location?.[1] ?? node?.location?.[1] ?? null;
}

function getKeywordLine(value) {
    return value?.linenumber ?? getAttrs(value)?.linenumber ?? null;
}

/**
 * Decompiler class specifically for Screen Language 2 nodes.
 */
export class SL2Decompiler extends DecompilerBase {
    constructor(out_file, options) {
        super(out_file, options);
        this.dispatch_map = {
            SLScreen: this.print_sl_screen,
            SLIf: this.print_sl_if,
            SLShowIf: this.print_sl_showif,
            SLFor: this.print_sl_for,
            SLUse: this.print_sl_use,
            SLTransclude: this.print_sl_transclude,
            SLDefault: this.print_sl_default,
            SLDisplayable: this.print_sl_displayable,
            SLPython: this.print_sl_python,
            SLPass: this.print_sl_pass,
            SLBlock: this.print_sl_block
        };
    }

    print_node(ast) {
        const attrs = getAttrs(ast);
        const line = attrs?.location?.[1];
        if (line) {
            this.advance_to_line(line);
        }

        const handler = this.dispatch_map[getNodeName(ast)];
        if (handler) {
            handler.call(this, ast);
        } else {
            this.print_unknown(ast);
        }
    }

    print_sl_screen(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`screen ${attrs.name}`);
        if (attrs.parameters) {
            this.write(reconstruct_paraminfo(attrs.parameters));
        }

        const [firstLine, otherLines] = this.sort_keywords_and_children(node);
        this.print_keyword_or_child(firstLine, true, otherLines.length > 0);

        if (otherLines.length > 0) {
            const indentScope = this.increase_indent();
            for (const line of otherLines) {
                this.print_keyword_or_child(line);
            }
            indentScope.dispose();
        }
    }

    print_sl_if(node) {
        this._print_if(node, 'if');
    }

    print_sl_showif(node) {
        this._print_if(node, 'showif');
    }

    _print_if(node, firstKeyword) {
        const attrs = getAttrs(node);
        const entries = attrs.entries || [];
        let keyword = firstKeyword;

        for (const [condition, block] of entries) {
            const blockLine = getLocationLine(block);
            if (blockLine) {
                this.advance_to_line(blockLine);
            }

            this.indent();
            if (condition == null) {
                this.write('else');
            } else {
                this.write(`${keyword} ${extractSource(condition)}`);
                keyword = 'elif';
            }

            this.print_sl_block(block, true);
        }
    }

    print_sl_block(node, immediate_block = false) {
        const [firstLine, otherLines] = this.sort_keywords_and_children(node, immediate_block);
        const hasBlock = immediate_block || otherLines.length > 0;

        this.print_keyword_or_child(firstLine, true, hasBlock);

        if (otherLines.length > 0) {
            const indentScope = this.increase_indent();
            for (const line of otherLines) {
                this.print_keyword_or_child(line);
            }
            indentScope.dispose();
        } else if (immediate_block) {
            const indentScope = this.increase_indent();
            this.indent();
            this.write('pass');
            indentScope.dispose();
        }
    }

    print_sl_for(node) {
        const attrs = getAttrs(node);
        let variable;
        let children;

        if (attrs.variable === '_sl2_i') {
            const firstChildCode = extractSource(getAttrs(attrs.children?.[0])?.code);
            variable = firstChildCode.endsWith(' = _sl2_i') ? firstChildCode.slice(0, -9) : firstChildCode;
            children = (attrs.children || []).slice(1);
        } else {
            variable = `${String(attrs.variable).trim()} `;
            children = attrs.children || [];
        }

        this.indent();
        if (attrs.index_expression != null) {
            this.write(`for ${variable}index ${extractSource(attrs.index_expression)} in ${extractSource(attrs.expression)}:`);
        } else {
            this.write(`for ${variable}in ${extractSource(attrs.expression)}:`);
        }
        this.print_nodes(children, 1);
    }

    print_sl_use(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`use ${extractSource(attrs.target)}`);

        if (attrs.args) {
            this.write(reconstruct_arginfo(attrs.args));
        }

        if (attrs.id) {
            this.write(` id ${attrs.id}`);
        }

        if (attrs.block) {
            this.print_sl_block(attrs.block, true);
        }
    }

    print_sl_transclude() {
        this.indent();
        this.write('transclude');
    }

    print_sl_default(node) {
        const attrs = getAttrs(node);
        this.indent();
        this.write(`default ${attrs.variable} = ${extractSource(attrs.expression)}`);
    }

    print_sl_python(node) {
        const attrs = getAttrs(node);
        const code = extractSource(attrs.code);
        this.indent();
        if (code.startsWith('\n')) {
            this.write('python:');
            const indentScope = this.increase_indent();
            this.write_lines(split_logical_lines(code.slice(1)));
            indentScope.dispose();
        } else {
            this.write(`$ ${code}`);
        }
    }

    print_sl_pass() {
        this.indent();
        this.write('pass');
    }

    print_sl_displayable(node, has_block = false) {
        const attrs = getAttrs(node);
        const clsModule = getNodeModule(attrs.displayable);
        const clsName = getNodeName(attrs.displayable);
        const [name, childrenSpec] = getDisplayableName(clsModule, clsName, attrs.style);

        this.indent();
        this.write(name);
        if (attrs.positional?.length) {
            this.write(` ${attrs.positional.map(arg => extractSource(arg)).join(' ')}`);
        }

        const atlTransform = attrs.atl_transform;
        const child = attrs.children?.[0];
        const childAttrs = getAttrs(child);
        const lastKeyword = attrs.keyword?.length ? attrs.keyword[attrs.keyword.length - 1] : null;
        const lastKeywordLine = lastKeyword ? getKeywordLine(lastKeyword[1]) : null;
        const childLine = getLocationLine(child);
        const atlLine = getAttrs(atlTransform)?.loc?.[1] ?? atlTransform?.loc?.[1] ?? null;


        if (has_block) {
            const [firstLine, otherLines] = this.sort_keywords_and_children(node);
            this.print_keyword_or_child(firstLine, true, otherLines.length > 0);
            if (otherLines.length > 0) {
                const indentScope = this.increase_indent();
                for (const line of otherLines) {
                    this.print_keyword_or_child(line);
                }
                indentScope.dispose();
            }
            return;
        }

        const [firstLine, otherLines] = this.sort_keywords_and_children(node);
        this.print_keyword_or_child(firstLine, true, otherLines.length > 0);

        if (otherLines.length > 0) {
            const indentScope = this.increase_indent();
            for (const line of otherLines) {
                this.print_keyword_or_child(line);
            }
            indentScope.dispose();
        }
    }

    sort_keywords_and_children(node, immediate_block = false, ignore_children = false) {
        const attrs = getAttrs(node);
        const keywords = attrs.keyword || [];
        const children = ignore_children ? [] : (attrs.children || []);
        const blockLineno = attrs.location?.[1] ?? 1;
        const startLineno = immediate_block ? blockLineno + 1 : blockLineno;
        const keywordTag = attrs.tag;
        const keywordAs = attrs.variable;
        const atlTransform = attrs.atl_transform;

        const keywordsByLine = keywords.map(([name, value]) => [
            value ? getKeywordLine(value) : null,
            value ? 'keyword' : 'broken',
            [name, value]
        ]);
        const childrenByLine = children.map(child => [getLocationLine(child), 'child', child]);

        const contentsInOrder = [];
        const keywordQueue = [...keywordsByLine].reverse();
        const childQueue = [...childrenByLine].reverse();

        while (keywordQueue.length && childQueue.length) {
            if (keywordQueue[keywordQueue.length - 1][0] == null) {
                contentsInOrder.push(keywordQueue.pop());
            } else if (keywordQueue[keywordQueue.length - 1][0] < childQueue[childQueue.length - 1][0]) {
                contentsInOrder.push(keywordQueue.pop());
            } else {
                contentsInOrder.push(childQueue.pop());
            }
        }
        while (keywordQueue.length) contentsInOrder.push(keywordQueue.pop());
        while (childQueue.length) contentsInOrder.push(childQueue.pop());

        if (atlTransform != null) {
            const atlLine = getAttrs(atlTransform)?.loc?.[1] ?? atlTransform?.loc?.[1] ?? null;
            let index = contentsInOrder.length;
            for (let i = 0; i < contentsInOrder.length; i++) {
                const [line] = contentsInOrder[i];
                if (line != null && atlLine != null && atlLine < line) {
                    index = i;
                    break;
                }
            }
            contentsInOrder.splice(index, 0, [atlLine, 'atl', atlTransform]);
        }

        let currentKeywordLine = null;
        const grouped = [];

        for (const [lineno, type, content] of contentsInOrder) {
            if (currentKeywordLine == null) {
                if (type === 'child') {
                    grouped.push([lineno, 'child', content]);
                } else if (type === 'keyword') {
                    currentKeywordLine = [lineno, 'keywords', [content]];
                } else if (type === 'broken') {
                    grouped.push([lineno, 'keywords_broken', [], content]);
                } else if (type === 'atl') {
                    grouped.push([lineno, 'keywords_atl', [], content]);
                }
                continue;
            }

            if (type === 'child') {
                grouped.push(currentKeywordLine);
                currentKeywordLine = null;
                grouped.push([lineno, 'child', content]);
            } else if (type === 'keyword') {
                if (currentKeywordLine[0] === lineno) {
                    currentKeywordLine[2].push(content);
                } else {
                    grouped.push(currentKeywordLine);
                    currentKeywordLine = [lineno, 'keywords', [content]];
                }
            } else if (type === 'broken') {
                grouped.push([currentKeywordLine[0], 'keywords_broken', currentKeywordLine[2], content]);
                currentKeywordLine = null;
            } else if (type === 'atl') {
                if (currentKeywordLine[0] === lineno) {
                    grouped.push([lineno, 'keywords_atl', currentKeywordLine[2], content]);
                    currentKeywordLine = null;
                } else {
                    grouped.push(currentKeywordLine);
                    currentKeywordLine = null;
                    grouped.push([lineno, 'keywords_atl', [], content]);
                }
            }
        }

        if (currentKeywordLine != null) {
            grouped.push(currentKeywordLine);
        }

        for (let i = 0; i < grouped.length; i++) {
            const entry = grouped[i];
            if (entry[1] === 'keywords_broken' && entry[0] == null) {
                entry[0] = i !== 0 ? grouped[i - 1][0] + 1 : startLineno;
            }
        }

        if (keywordTag) {
            const firstChildIndex = grouped.findIndex(entry => entry[1] === 'child');
            const firstKeywordIndex = grouped.findIndex((entry, index) => (
                entry[1] === 'keywords'
                && entry[2].length > 0
                && (firstChildIndex === -1 || index < firstChildIndex)
            ));

            if (firstKeywordIndex !== -1) {
                const tagLine = (grouped[firstKeywordIndex][0] ?? blockLineno) + 1;
                grouped.splice(firstKeywordIndex + 1, 0, [tagLine, 'keywords', [['tag', keywordTag]]]);
            } else if (!grouped.length) {
                grouped.push([blockLineno + 1, 'keywords', [['tag', keywordTag]]]);
            } else if (grouped[0][0] > blockLineno + 1) {
                grouped.unshift([blockLineno + 1, 'keywords', [['tag', keywordTag]]]);
            } else {
                grouped.unshift([blockLineno + 1, 'keywords', [['tag', keywordTag]]]);
            }
        }

        if (keywordAs) {
            if (!grouped.length) {
                grouped.push([startLineno, 'keywords', [['as', keywordAs]]]);
            } else if (grouped[0][0] > blockLineno + 1) {
                grouped.unshift([blockLineno + 1, 'keywords', [['as', keywordAs]]]);
            } else if (grouped[0][0] > startLineno) {
                grouped.unshift([startLineno, 'keywords', [['as', keywordAs]]]);
            } else {
                let merged = false;
                for (const entry of grouped) {
                    if (String(entry[1]).startsWith('keywords')) {
                        entry[2].push(['as', keywordAs]);
                        merged = true;
                        break;
                    }
                }
                if (!merged) {
                    grouped.unshift([startLineno, 'keywords', [['as', keywordAs]]]);
                }
            }
        }

        if (immediate_block || !grouped.length || grouped[0][0] !== blockLineno) {
            grouped.unshift([blockLineno, 'keywords', []]);
        }

        return [grouped[0], grouped.slice(1)];
    }

    print_keyword_or_child(item, first_line = false, has_block = false) {
        const [lineno, type, keywordItems] = item;
        let first = true;
        const writeSep = () => {
            this.write(first ? (first_line ? ' ' : '') : ' ');
            first = false;
        };

        if (type === 'child') {
            this.print_node(item[2]);
            return;
        }

        if (!first_line) {
            if (lineno != null) {
                this.advance_to_line(lineno);
            }
            this.indent();
        }

        for (const [name, value] of keywordItems) {
            writeSep();
            this.write(value == null ? String(name) : `${name} ${extractSource(value)}`);
        }

        if (type === 'keywords_atl') {
            writeSep();
            this.write('at transform:');
            this.linenumber = atl.pprint(
                this.out_file,
                item[3],
                this.options,
                this.indent_level,
                this.linenumber,
                this.skip_indent_until_write
            );
            this.skip_indent_until_write = false;
            return;
        }

        if (type === 'keywords_broken') {
            writeSep();
            this.write(String(item[3][0]));
        }

        if (first_line && has_block) {
            this.write(':');
        }
    }
}

/**
 * Helper function to instantiate and run the SL2 decompiler for a given AST.
 * Used when a Screen node is encountered in the main AST.
 */
export function pprint(out_file, ast, options, indent_level, linenumber, skip_indent_until_write) {
    const d = new SL2Decompiler(out_file, options);
    return d.dump(ast, indent_level, linenumber, skip_indent_until_write);
}

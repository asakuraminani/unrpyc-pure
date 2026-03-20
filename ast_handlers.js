/**
 * Core AST node handlers for unrpyc.js
 * Ported from unrpyc/decompiler/__init__.py
 */

import {
    DecompilerBase,
    getNodeName,
    getNodeModule,
    getAttrs,
    string_escape,
    reconstruct_paraminfo,
    reconstruct_arginfo,
    extractSource,
    WordConcatenator,
    First,
    OptionBase,
    StringWriter,
    say_get_code,
    split_logical_lines
} from './util.js';

import * as sl2 from './sl2_handlers.js';
import * as atl from './atl_handlers.js';
import * as testcase from './testcase_handlers.js';

/**
 * Configuration options for the decompiler.
 */
export class Options extends OptionBase {
    constructor(indentation = "    ", log = null,
                 translator = null, init_offset = false,
                 sl_custom_names = null) {
        super(indentation, log);
        this.translator = translator;
        this.init_offset = init_offset;
        this.sl_custom_names = sl_custom_names;
    }
}

function getNodeLine(node) {
    return getAttrs(node)?.linenumber
        ?? node?.linenumber
        ?? getAttrs(node)?.loc?.[1]
        ?? node?.loc?.[1]
        ?? null;
}

/**
 * Main decompiler class handling Ren'Py AST nodes.
 */
export class Decompiler extends DecompilerBase {
    constructor(out_file, options) {
        super(out_file, options);
        
        // State variables for tracking context
        this.paired_with = false; // For 'show ... with ...'
        this.say_inside_menu = null; // (Not fully implemented)
        this.label_inside_menu = null; // (Not fully implemented)
        this.in_init = false; // Are we inside an init block?
        this.missing_init = false; // Did we encounter a node requiring init outside of one?
        this.init_offset = 0; // Current init offset
        this.most_lines_behind = 0; // Stats for debugging
        this.last_lines_behind = 0; // Stats for debugging
        this.seen_label = false; // Have we seen a label yet?
        this.rpy_directive_arguments = []; // Arguments for 'rpy' directive
        
        // Map AST node names to their handler methods
        this.dispatch_map = {
            'Init': this.print_init,
            'Label': this.print_label,
            'Jump': this.print_jump,
            'Call': this.print_call,
            'Return': this.print_return,
            'Pass': this.print_pass,
            'Say': this.print_say,
            'Menu': this.print_menu,
            'Show': this.print_show,
            'Hide': this.print_hide,
            'Scene': this.print_scene,
            'ShowLayer': this.print_showlayer,
            'With': this.print_with,
            'Camera': this.print_camera,
            'Python': this.print_python,
            'EarlyPython': this.print_earlypython,
            'Define': this.print_define,
            'Default': this.print_default,
            'If': this.print_if,
            'While': this.print_while,
            'For': this.print_for,
            'Image': this.print_image,
            'Transform': this.print_transform,
            'UserStatement': this.print_userstatement,
            'Style': this.print_style,
            'Translate': this.print_translate,
            'EndTranslate': this.print_endtranslate,
            'TranslateString': this.print_translatestring,
            'TranslateBlock': this.print_translateblock,
            'TranslateEarlyBlock': this.print_translateblock,
            'TranslateSay': this.print_translate_say,
            'Screen': this.print_screen,
            'Testcase': this.print_testcase,
            'RPY': this.print_rpy
        };
    }

    /**
     * Advances to the target line number, updating stats.
     */
    advance_to_line(linenumber) {
        this.last_lines_behind = Math.max(
            this.linenumber + (this.skip_indent_until_write ? 0 : 1) - linenumber, 0);
        this.most_lines_behind = Math.max(this.last_lines_behind, this.most_lines_behind);
        super.advance_to_line(linenumber);
    }

    /**
     * Saves full decompiler state including context flags.
     */
    save_state() {
        return {
            base: super.save_state(),
            paired_with: this.paired_with,
            say_inside_menu: this.say_inside_menu,
            label_inside_menu: this.label_inside_menu,
            in_init: this.in_init,
            missing_init: this.missing_init,
            most_lines_behind: this.most_lines_behind,
            last_lines_behind: this.last_lines_behind,
            seen_label: this.seen_label,
            rpy_directive_arguments: [...this.rpy_directive_arguments]
        };
    }

    /**
     * Restores full decompiler state.
     */
    rollback_state(state) {
        super.rollback_state(state.base);
        this.paired_with = state.paired_with;
        this.say_inside_menu = state.say_inside_menu;
        this.label_inside_menu = state.label_inside_menu;
        this.in_init = state.in_init;
        this.missing_init = state.missing_init;
        this.most_lines_behind = state.most_lines_behind;
        this.last_lines_behind = state.last_lines_behind;
        this.seen_label = state.seen_label;
        this.rpy_directive_arguments = state.rpy_directive_arguments;
    }

    /**
     * Main entry point. Handles init offset guessing and output header.
     */
    dump(ast) {
        if (this.options.translator) {
            this.options.translator.translate_dialogue(ast);
        }

        if (this.options.init_offset && Array.isArray(ast)) {
            this.set_best_init_offset(ast);
        }

        // skip_indent_until_write avoids an initial blank line
        super.dump(ast, 0, 1, true);

        // if there's anything we wanted to write out but didn't yet, do it now
        for (const m of this.blank_line_queue) {
            m(null);
        }
        this.write("\n# Decompiled by unrpyc: https://github.com/CensoredUsername/unrpyc\n");
        if (this.missing_init) {
            throw new Error("A required init, init label, or translate block was missing");
        }
    }

    commit_state(state) {
        super.commit_state(state.base);
    }

    say_belongs_to_menu(say, menu) {
        const sayAttrs = getAttrs(say);
        const menuAttrs = getAttrs(menu);
        if (!sayAttrs || !menuAttrs || getNodeName(menu) !== 'Menu') {
            return false;
        }

        const items = menuAttrs.items || [];
        return (!sayAttrs.interact
            && sayAttrs.who != null
            && sayAttrs.with_ == null
            && sayAttrs.attributes == null
            && items.length > 0
            && items[0]?.[2] != null
            && !this.should_come_before(say, menu));
    }

    print_say_inside_menu() {
        if (!this.say_inside_menu) {
            return;
        }
        this.print_say(this.say_inside_menu, true);
        this.say_inside_menu = null;
    }

    print_menu_item(label, condition, block, itemArguments) {
        this.indent();
        this.write(`"${string_escape(label)}"`);

        if (itemArguments != null) {
            this.write(reconstruct_arginfo(itemArguments));
        }

        if (block != null) {
            if (condition != null && typeof condition === 'object' && getNodeName(condition) === 'PyExpr') {
                this.write(` if ${extractSource(condition)}`);
            }
            this.write(":");
            this.print_nodes(block, 1);
        }
    }

    get_menu_item_line(index, items, menuLine = null) {
        const firstItemBlock = items[0]?.[2];
        const firstItemBlockLine = Array.isArray(firstItemBlock) && firstItemBlock.length > 0
            ? getNodeLine(firstItemBlock[0])
            : null;
        const itemOffset = firstItemBlockLine != null && menuLine != null && firstItemBlockLine > menuLine + 2 ? 2 : 1;

        const currentBlock = items[index]?.[2];
        if (Array.isArray(currentBlock) && currentBlock.length > 0) {
            const firstBlockLine = getNodeLine(currentBlock[0]);
            if (firstBlockLine != null) {
                const targetLine = firstBlockLine - itemOffset;
                return index === 0 && menuLine != null ? Math.max(menuLine + 1, targetLine) : targetLine;
            }
        }

        for (let i = index + 1; i < items.length; i++) {
            const nextBlock = items[i]?.[2];
            if (Array.isArray(nextBlock) && nextBlock.length > 0) {
                const nextBlockLine = getNodeLine(nextBlock[0]);
                if (nextBlockLine != null) {
                    const targetLine = nextBlockLine - itemOffset;
                    return index === 0 && menuLine != null ? Math.max(menuLine + 1, targetLine) : targetLine;
                }
            }
        }

        return null;
    }

    print_lex(lex) {
        if (!Array.isArray(lex)) {
            return;
        }

        for (const entry of lex) {
            if (!Array.isArray(entry)) {
                continue;
            }

            let linenumber;
            let content;
            let block;

            if (entry.length === 4) {
                [, linenumber, content, block] = entry;
            } else {
                [, linenumber, , content, block] = entry;
            }

            this.advance_to_line(linenumber);
            this.indent();
            this.write(content);
            if (block) {
                const indentScope = this.increase_indent();
                this.print_lex(block);
                indentScope.dispose();
            }
        }
    }

    get_implicit_init_priority(attrs) {
        const parent = this.parent;
        if (getNodeName(parent) !== 'Init') {
            return '';
        }

        const initAttrs = getAttrs(parent);
        const block = initAttrs?.block || [];
        if (block.length !== 1 || this.should_come_before(parent, attrs)) {
            return '';
        }

        const priority = initAttrs.priority ?? 0;
        if (priority === this.init_offset) {
            return '';
        }

        return ` ${priority - this.init_offset}`;
    }

    render_label(node, attrs) {
        this.write(`label ${attrs.name}${reconstruct_paraminfo(attrs.parameters)}${attrs.hide ? ' hide' : ''}:`);
        this.print_nodes(attrs.block || [], 1);
    }

    render_python_source(code) {
        if (!code) {
            return;
        }

        const indented = code[0] === ' ';
        if (indented) {
            this.write(`\n${code}`);
            return;
        }

        const indentScope = this.increase_indent();
        this.write_lines(split_logical_lines(code));
        indentScope.dispose();
    }

    render_init_python(childName, code) {
        this.write(`init${childName === 'EarlyPython' ? ' early' : ''} python:`);
        this.render_python_source(code.startsWith('\n') ? code.slice(1) : code);
    }

    queue_init_offset(offset) {
        const do_set_init_offset = (linenumber) => {
            if (linenumber == null || linenumber - this.linenumber <= 1 || this.indent_level) {
                return true;
            }
            if (offset !== this.init_offset) {
                this.indent();
                this.write(`init offset = ${offset}`);
                this.init_offset = offset;
            }
            return false;
        };

        this.do_when_blank_line(do_set_init_offset);
    }

    /**
     * Heuristic to guess the best global 'init offset' to minimize 'init X:' blocks.
     */
    set_best_init_offset(nodes) {
        const votes = {};
        for (const ast of nodes) {
            if (getNodeName(ast) !== 'Init') continue;
            const attrs = getAttrs(ast);
            let offset = attrs.priority;

            // Keep this block in sync with print_init logic
            if (Array.isArray(attrs.block) && attrs.block.length === 1 && !this.should_come_before(ast, attrs.block[0])) {
                const child = attrs.block[0];
                const childName = getNodeName(child);
                if (childName === 'Screen') offset -= -500;
                else if (childName === 'Testcase') offset -= 500;
                else if (childName === 'Image') offset -= 500;
            }
            votes[offset] = (votes[offset] || 0) + 1;
        }

        if (Object.keys(votes).length > 0) {
            const winner = Number(Object.keys(votes).reduce((best, current) => votes[current] > votes[best] ? current : best));
            if ((votes[0] || 0) + 1 < votes[winner]) {
                this.set_init_offset(winner);
            }
        }
    }

    set_init_offset(offset) {
        this.queue_init_offset(offset);
    }

    should_come_before(first, second) {
        const firstLine = getAttrs(first)?.linenumber ?? first?.linenumber ?? getAttrs(first)?.loc?.[1] ?? first?.loc?.[1];
        const secondLine = getAttrs(second)?.linenumber ?? second?.linenumber ?? getAttrs(second)?.loc?.[1] ?? second?.loc?.[1];
        if (firstLine == null || secondLine == null) {
            return false;
        }
        return firstLine < secondLine;
    }

    print_init(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;

        const inInit = this.in_init;
        this.in_init = true;
        try {
            const block = attrs.block || [];
            const priority = attrs.priority ?? 0;
            const child = block.length === 1 ? block[0] : null;
            const childName = getNodeName(child);
            const childAttrs = getAttrs(child);

            const isImplicitInit = child != null
                && !this.should_come_before(node, child)
                && (
                    ['Define', 'Default', 'Transform'].includes(childName)
                    || (priority === -500 + this.init_offset && childName === 'Screen')
                    || (priority === this.init_offset && childName === 'Style')
                    || (priority === 500 + this.init_offset && childName === 'Testcase')
                    || (priority === this.init_offset && childName === 'UserStatement' && (childAttrs?.line || '').startsWith('layeredimage '))
                    || (priority === 500 + this.init_offset && childName === 'Image')
                );

            const isTranslateStringBlock = block.length > 0
                && priority === this.init_offset
                && block.every((entry) => getNodeName(entry) === 'TranslateString')
                && block.slice(1).every((entry) => getAttrs(entry)?.language === getAttrs(block[0])?.language);

            if (isImplicitInit || isTranslateStringBlock) {
                this.print_nodes(block);
                return;
            }

            this.indent();
            this.write('init');
            if (priority !== this.init_offset) {
                this.write(` ${priority - this.init_offset}`);
            }

            if (child != null && !this.should_come_before(node, child)) {
                this.write(' ');
                this.skip_indent_until_write = true;
                this.print_nodes(block);
            } else {
                this.write(':');
                this.print_nodes(block, 1);
            }
        } finally {
            this.in_init = inInit;
        }
    }

    print_nodes(nodes, extra_indent = 0) {
        super.print_nodes(nodes, extra_indent);
    }

    print_node(ast) {
        const name = getNodeName(ast);
        const attrs = getAttrs(ast);
        const linenumber = attrs?.linenumber ?? ast?.linenumber;

        if (name === 'Say' && this.handle_say_possibly_inside_menu(ast)) {
            return;
        }

        if (linenumber !== undefined && !['TranslateString', 'With', 'Label', 'Pass', 'Return'].includes(name)) {
            this.advance_to_line(linenumber);
        }

        const handler = this.dispatch_map[name];
        if (handler) {
            handler.call(this, ast);
        } else if (typeof ast !== 'string') {
            this.print_unknown(ast);
        }
    }

    dispatch_node(node) {
        const name = getNodeName(node);
        const handler = this.dispatch_map[name];
        if (handler) {
            handler.call(this, node);
        } else {
            this.print_unknown(node);
        }
    }

    print_label(node) {
        const block = this.block;
        const idx = this.index;
        if (idx && getNodeName(block[idx - 1]) === 'Call') {
            return;
        }

        const attrs = getAttrs(node);
        if (!attrs) return;
        this.seen_label = true;

        const isBareLabel = (!attrs.block || attrs.block.length === 0) && attrs.parameters == null;
        const remainingBlocks = block.length - idx;
        let nextAst = null;

        if (isBareLabel && remainingBlocks > 1) {
            nextAst = block[idx + 1];
            const nextAttrs = getAttrs(nextAst);
            if (getNodeName(nextAst) === 'Menu' && nextAttrs?.linenumber === attrs.linenumber) {
                this.label_inside_menu = node;
                return;
            }
        }

        if (isBareLabel && remainingBlocks > 2) {
            nextAst ??= block[idx + 1];
            const nextNextAst = block[idx + 2];
            const nextNextAttrs = getAttrs(nextNextAst);
            if (getNodeName(nextAst) === 'Say'
                && getNodeName(nextNextAst) === 'Menu'
                && nextNextAttrs?.linenumber === attrs.linenumber
                && this.say_belongs_to_menu(nextAst, nextNextAst)) {
                this.label_inside_menu = node;
                return;
            }
        }

        this.advance_to_line(attrs.linenumber);
        this.indent();

        const outFile = this.out_file;
        this.out_file = new StringWriter();
        const missingInit = this.missing_init;
        this.missing_init = false;
        try {
            this.render_label(node, attrs);
        } finally {
            if (this.missing_init) {
                outFile.write('init ');
            }
            this.missing_init = missingInit;
            outFile.write(this.out_file.getvalue());
            this.out_file = outFile;
        }
    }

    print_jump(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(`jump ${attrs.expression ? 'expression ' : ''}${attrs.target}`);
    }

    print_call(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        const words = new WordConcatenator(false);
        words.append('call');
        if (attrs.expression) {
            words.append('expression');
        }
        words.append(attrs.label ?? '?');

        if (attrs.arguments != null) {
            if (attrs.expression) {
                words.append('pass');
            }
            words.append(reconstruct_arginfo(attrs.arguments));
        }

        const nextBlock = this.block[this.index + 1];
        if (getNodeName(nextBlock) === 'Label') {
            const nextAttrs = getAttrs(nextBlock);
            words.append(`from ${nextAttrs?.name}`);
        }

        this.write(words.join());
    }

    print_return(node) {
        const attrs = getAttrs(node);
        const previous = this.index ? this.block[this.index - 1] : null;
        const previousName = getNodeName(previous);
        const previousAttrs = getAttrs(previous);
        if (attrs?.expression == null
            && this.parent == null
            && this.index + 1 === this.block.length
            && this.index
            && (
                attrs.linenumber === previousAttrs?.linenumber
                || previousName === 'Return'
                || previousName === 'Jump'
                || !this.seen_label
            )) {
            return;
        }

        this.advance_to_line(attrs?.linenumber);
        this.indent();
        this.write('return');
        if (attrs?.expression != null) {
            this.write(` ${extractSource(attrs.expression)}`);
        }
    }

    print_pass(node) {
        if (this.index && getNodeName(this.block[this.index - 1]) === 'Call') {
            return;
        }

        if (this.index > 1
            && getNodeName(this.block[this.index - 2]) === 'Call'
            && getNodeName(this.block[this.index - 1]) === 'Label'
            && getAttrs(this.block[this.index - 2])?.linenumber === getAttrs(node)?.linenumber) {
            return;
        }

        this.advance_to_line(getAttrs(node)?.linenumber);
        this.indent();
        this.write('pass');
    }

    print_say(node, inmenu = false) {
        this.indent();
        this.write(say_get_code(node, inmenu));
    }

    print_menu(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;

        this.indent();
        this.write('menu');
        if (this.label_inside_menu != null) {
            this.write(` ${getAttrs(this.label_inside_menu)?.name}`);
            this.label_inside_menu = null;
        }
        if (attrs.arguments != null) {
            this.write(reconstruct_arginfo(attrs.arguments));
        }
        this.write(':');

        const indentScope = this.increase_indent();
        if (attrs.with_ != null) {
            this.indent();
            this.write(`with ${extractSource(attrs.with_)}`);
        }

        if (attrs.set != null) {
            this.indent();
            this.write(`set ${extractSource(attrs.set)}`);
        }

        const items = attrs.items || [];
        const itemArguments = attrs.item_arguments ?? Array(items.length).fill(null);
        for (let i = 0; i < items.length; i++) {
            let [label, condition, block] = items[i];
            const arguments_ = itemArguments[i];

            if (this.options.translator) {
                label = this.options.translator.strings.get(label) ?? label;
            }

            let state = null;
            const conditionLine = getNodeLine(condition);
            const itemLine = conditionLine ?? this.get_menu_item_line(i, items, attrs.linenumber ?? null);
            if (itemLine != null) {
                if (this.say_inside_menu != null && itemLine > this.linenumber + 1) {
                    this.print_say_inside_menu();
                }
                this.advance_to_line(itemLine);
            } else if (this.say_inside_menu != null) {
                state = this.save_state();
                this.most_lines_behind = this.last_lines_behind;
                this.print_say_inside_menu();
            }

            this.print_menu_item(label, condition, block, arguments_);

            if (state != null) {
                if (this.most_lines_behind > state.last_lines_behind) {
                    this.rollback_state(state);
                    this.print_menu_item(label, condition, block, arguments_);
                } else {
                    this.most_lines_behind = Math.max(state.most_lines_behind, this.most_lines_behind);
                    this.commit_state(state);
                }
            }
        }

        if (this.say_inside_menu != null) {
            this.print_say_inside_menu();
        }
        indentScope.dispose();
    }

    print_python(node, early = false) {
        const attrs = getAttrs(node);
        if (!attrs?.code) return;

        this.indent();
        let code = extractSource(attrs.code);
        const indented = code && code[0] === ' ';
        const leadingNewline = code && code[0] === '\n';

        if (!(indented || leadingNewline)) {
            this.write(`$ ${code}`);
            return;
        }

        if (leadingNewline) {
            code = code.slice(1);
        }

        this.write('python');
        if (early) {
            this.write(' early');
        }
        if (attrs.hide) {
            this.write(' hide');
        }
        if ((attrs.store ?? 'store') !== 'store') {
            this.write(' in ');
            this.write(String(attrs.store).replace(/^store\./, ''));
        }
        this.write(':');

        this.render_python_source(code);
    }

    print_earlypython(node) {
        this.print_python(node, true);
    }

    print_define(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        this.indent();

        const priority = this.get_implicit_init_priority(node);
        const index = attrs.index != null ? `[${extractSource(attrs.index)}]` : '';
        const operator = attrs.operator ?? '=';
        const target = (attrs.store ?? 'store') === 'store'
            ? `${attrs.varname}${index}`
            : `${String(attrs.store).replace(/^store\./, '')}.${attrs.varname}${index}`;
        this.write(`define${priority} ${target} ${operator} ${extractSource(attrs.code)}`);
    }

    print_default(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        this.indent();

        const priority = this.get_implicit_init_priority(node);
        const target = (attrs.store ?? 'store') === 'store'
            ? attrs.varname
            : `${String(attrs.store).replace(/^store\./, '')}.${attrs.varname}`;
        this.write(`default${priority} ${target} = ${extractSource(attrs.code)}`);
    }

    print_if(node) {
        const attrs = getAttrs(node);
        const statement = new First('if', 'elif');
        for (let i = 0; i < (attrs?.entries || []).length; i++) {
            const [condition, block] = attrs.entries[i];
            const conditionName = getNodeName(condition);
            if (i + 1 === attrs.entries.length && conditionName !== 'PyExpr') {
                this.indent();
                this.write('else:');
            } else {
                const conditionAttrs = getAttrs(condition);
                if (conditionAttrs?.linenumber !== undefined) {
                    this.advance_to_line(conditionAttrs.linenumber);
                }
                this.indent();
                this.write(`${statement.call()} ${extractSource(condition)}:`);
            }
            this.print_nodes(block || [], 1);
        }
    }

    print_while(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(`while ${extractSource(attrs.condition)}:`);
        this.print_nodes(attrs.block || [], 1);
    }

    print_for(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(`for ${attrs.variable} in ${extractSource(attrs.expression)}:`);
        this.print_nodes(attrs.block || [], 1);
    }

    print_userstatement(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(attrs.line);
        if (attrs.block != null) {
            const indentScope = this.increase_indent();
            this.print_lex(attrs.block);
            indentScope.dispose();
        }
    }

    print_style(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        const keywords = new Map([[attrs.linenumber, new WordConcatenator(false, true)]]);

        if (attrs.parent != null) keywords.get(attrs.linenumber).append(`is ${attrs.parent}`);
        if (attrs.clear) keywords.get(attrs.linenumber).append('clear');
        if (attrs.take != null) keywords.get(attrs.linenumber).append(`take ${attrs.take}`);
        for (const delname of attrs.delattr || []) {
            keywords.get(attrs.linenumber).append(`del ${delname}`);
        }

        if (attrs.variant != null) {
            const variantLine = attrs.variant?.linenumber ?? getAttrs(attrs.variant)?.linenumber ?? attrs.linenumber;
            if (!keywords.has(variantLine)) keywords.set(variantLine, new WordConcatenator(false));
            keywords.get(variantLine).append(`variant ${extractSource(attrs.variant)}`);
        }

        for (const [key, value] of Object.entries(attrs.properties || {})) {
            const valueLine = value?.linenumber ?? getAttrs(value)?.linenumber ?? attrs.linenumber;
            if (!keywords.has(valueLine)) keywords.set(valueLine, new WordConcatenator(false));
            keywords.get(valueLine).append(`${key} ${extractSource(value)}`);
        }

        const entries = Array.from(keywords.entries())
            .map(([line, words]) => [line, words.join()])
            .sort((a, b) => a[0] - b[0]);

        this.indent();
        this.write(`style ${attrs.style_name}`);
        if (entries[0]?.[1]) {
            this.write(` ${entries[0][1]}`);
        }
        if (entries.length > 1) {
            this.write(':');
            const indentScope = this.increase_indent();
            for (const [line, value] of entries.slice(1)) {
                this.advance_to_line(line);
                this.indent();
                this.write(value);
            }
            indentScope.dispose();
        }
    }

    print_translate(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        if (attrs.location_comment) {
            this.indent();
            this.write(attrs.location_comment);
        }
        this.indent();
        this.write(`translate ${attrs.language || 'None'} ${attrs.identifier}:`);
        this.write('\n');
        this.print_nodes(attrs.block || [], 1);
        this.write('\n');
    }

    print_endtranslate() {
        // Implicitly added node; intentionally emits nothing.
    }

    print_translatestring(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        const previous = this.index ? this.block[this.index - 1] : null;
        const sameLanguageAsPrevious = previous
            && getNodeName(previous) === 'TranslateString'
            && getAttrs(previous)?.language === attrs.language;

        if (!sameLanguageAsPrevious) {
            this.indent();
            this.write(`translate ${attrs.language || 'None'} strings:`);
            this.write('\n');
        }

        const indentScope = this.increase_indent();
        if (attrs.location_comment) {
            this.indent();
            this.write(attrs.location_comment);
        }
        if (attrs.linenumber != null) {
            this.advance_to_line(attrs.linenumber);
        }
        this.indent();
        this.write(`old "${string_escape(attrs.old)}"`);
        const newloc = attrs.newloc;
        if (Array.isArray(newloc) && newloc[1] != null) {
            this.advance_to_line(newloc[1]);
        }
        this.indent();
        this.write(`new "${string_escape(attrs.new)}"`);
        this.write('\n');
        indentScope.dispose();
    }

    print_translateblock(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(`translate ${attrs.language || 'None'} `);
        this.skip_indent_until_write = true;

        const inInit = this.in_init;
        const block = attrs.block || [];
        if (block.length === 1 && ['Python', 'Style'].includes(getNodeName(block[0]))) {
            this.in_init = true;
        }
        try {
            this.print_nodes(block);
        } finally {
            this.in_init = inInit;
        }
    }

    print_translate_say(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        if (attrs.language) {
            this.indent();
            this.write(`translate ${attrs.language} ${attrs.identifier}:`);
            const indentScope = this.increase_indent();
            this.print_say(node, true);
            indentScope.dispose();
        } else {
            this.print_say(node);
        }
    }

    format_imspec(imspec) {
        if (!imspec) return false;
        let begin;
        if (imspec[1] != null) {
            begin = `expression ${extractSource(imspec[1])}`;
        } else {
            begin = Array.isArray(imspec[0]) ? imspec[0].join(' ') : String(imspec[0] ?? '');
        }

        const words = new WordConcatenator(begin && !begin.endsWith(' '), true);
        if (imspec[2] != null) {
            words.append(`as ${extractSource(imspec[2])}`);
        }
        if ((imspec[6] || []).length > 0) {
            words.append(`behind ${imspec[6].join(', ')}`);
        }
        if (typeof imspec[4] === 'string') {
            words.append(`onlayer ${imspec[4]}`);
        }
        if (imspec[5] != null) {
            words.append(`zorder ${imspec[5]}`);
        }
        if ((imspec[3] || []).length > 0) {
            words.append(`at ${(imspec[3] || []).map(extractSource).join(', ')}`);
        }

        this.write(begin + words.join());
        return words.needs_space;
    }

    print_show(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write('show ');
        const needsSpace = this.format_imspec(attrs.imspec);
        if (this.paired_with) {
            if (needsSpace) this.write(' ');
            this.write(`with ${this.paired_with}`);
            this.paired_with = true;
        }
        if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_showlayer(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write(`show layer ${attrs.layer}`);
        if (attrs.at_list && attrs.at_list.length) {
            this.write(` at ${attrs.at_list.join(', ')}`);
        }
        if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_hide(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write('hide ');
        const needsSpace = this.format_imspec(attrs.imspec);
        if (this.paired_with) {
            if (needsSpace) this.write(' ');
            this.write(`with ${this.paired_with}`);
            this.paired_with = true;
        }
    }

    print_scene(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write('scene');
        let needsSpace = true;
        if (attrs.imspec == null) {
            if (typeof attrs.layer === 'string') {
                this.write(` onlayer ${attrs.layer}`);
            }
        } else {
            this.write(' ');
            needsSpace = this.format_imspec(attrs.imspec);
        }
        if (this.paired_with) {
            if (needsSpace) this.write(' ');
            this.write(`with ${this.paired_with}`);
            this.paired_with = true;
        }
        if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_with(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        if (attrs.paired != null) {
            const matching = this.block[this.index + 2];
            if (!(getNodeName(matching) === 'With' && extractSource(getAttrs(matching)?.expr) === extractSource(attrs.paired))) {
                throw new Error(`Unmatched paired with ${this.paired_with} != ${extractSource(attrs.expr)}`);
            }
            this.paired_with = extractSource(attrs.paired);
        } else if (this.paired_with) {
            if (this.paired_with !== true) {
                this.write(` with ${extractSource(attrs.expr)}`);
            }
            this.paired_with = false;
        } else {
            this.advance_to_line(attrs.linenumber);
            this.indent();
            this.write(`with ${extractSource(attrs.expr)}`);
            this.paired_with = false;
        }
    }

    print_camera(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.indent();
        this.write('camera');
        if (attrs.layer && attrs.layer !== 'master') {
            this.write(` ${attrs.layer}`);
        }
        if (attrs.at_list && attrs.at_list.length > 0) {
            this.write(` at ${attrs.at_list.join(', ')}`);
        }
        if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_atl(ast) {
        this.linenumber = atl.pprint(
            this.out_file,
            ast,
            this.options,
            this.indent_level,
            this.linenumber,
            this.skip_indent_until_write
        );
        this.skip_indent_until_write = false;
    }

    handle_say_possibly_inside_menu(ast) {
        if (this.index + 1 < this.block.length && this.say_belongs_to_menu(ast, this.block[this.index + 1])) {
            this.say_inside_menu = ast;
            return true;
        }
        return false;
    }

    require_init() {
        if (!this.in_init) {
            this.missing_init = true;
        }
    }

    print_image(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        this.indent();
        this.write(`image ${Array.isArray(attrs.imgname) ? attrs.imgname.join(' ') : attrs.imgname}`);
        if (attrs.code != null) {
            this.write(` = ${extractSource(attrs.code)}`);
        } else if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_transform(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        this.indent();
        const priority = this.get_implicit_init_priority(node);
        this.write(`transform${priority} ${attrs.varname}`);
        if (attrs.parameters != null) {
            this.write(reconstruct_paraminfo(attrs.parameters));
        }
        if (attrs.atl != null) {
            this.write(':');
            this.print_atl(attrs.atl);
        }
    }

    print_testcase(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        this.indent();
        this.write(`testcase ${attrs.label}:`);
        if (attrs.test?.block) {
            this.linenumber = testcase.pprint(
                this.out_file,
                attrs.test.block,
                this.options,
                this.indent_level + 1,
                this.linenumber,
                this.skip_indent_until_write
            );
            this.skip_indent_until_write = false;
        }
    }

    print_rpy(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        const rest = attrs.rest;
        const [command, arg] = Array.isArray(rest) ? rest : [];
        if (command !== 'python') {
            throw new Error(`Unsupported rpy directive: ${command}`);
        }

        this.rpy_directive_arguments.push(arg);
        const next = this.block[this.index + 1];
        const nextAttrs = getAttrs(next);
        const nextRest = nextAttrs?.rest;
        if (getNodeName(next) === 'RPY'
            && attrs.linenumber === nextAttrs?.linenumber
            && Array.isArray(nextRest)
            && nextRest[0] === command) {
            return;
        }

        this.indent();
        this.write(`rpy ${command} ${this.rpy_directive_arguments.join(', ')}`);
        this.rpy_directive_arguments = [];
    }

    print_screen(node) {
        const attrs = getAttrs(node);
        if (!attrs) return;
        this.require_init();
        if (attrs.screen) {
            this.linenumber = sl2.pprint(
                this.out_file,
                attrs.screen,
                this.options,
                this.indent_level,
                this.linenumber,
                this.skip_indent_until_write
            );
            this.skip_indent_until_write = false;
        }
    }

}

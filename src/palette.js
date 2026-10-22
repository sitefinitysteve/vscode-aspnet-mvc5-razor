'use strict';
/**
 * Visual Studio 2026 Dark colours as TextMate rules, scoped to MVC 5 Razor views.
 *
 * Themes rank a rule by how specifically it matches the token's own scope before parent scopes are
 * considered, so a short rule like `text.aspnetmvc5razor storage` loses to a theme's `storage.type.var`.
 * Emitting one rule per concrete scope name (`text.aspnetmvc5razor storage.type.var.cs`) ties on
 * specificity and then wins on the parent, whatever theme is active.
 */

const ROOT = 'text.aspnetmvc5razor';

const TEXT = '#DCDCDC';
const KEYWORD = '#569CD6';
const CONTROL = '#D8A0DF';
const TYPE = '#4EC9B0';
const FUNCTION = '#DCDCAA';
const LOCAL = '#9CDCFE';
const STRING = '#D69D85';
const NUMBER = '#B5CEA8';
const COMMENT = '#57A64A';
const OPERATOR = '#B4B4B4';
const TAG_PUNCTUATION = '#808080';
const ATTRIBUTE_VALUE = '#C8C8C8';
const ENTITY = '#1A9A98';
const CSS_SELECTOR = '#D7BA7D';
const CSS_VALUE = '#C8C8C8';

// First match wins, so specific categories come before general ones.
const CATEGORIES = [
    [/^comment\b|^punctuation\.definition\.comment\b/, COMMENT],
    [/^entity\.name\.function\.htmlhelper\.razor$/, TEXT],
    [/^(string|punctuation\.definition\.string)\b.*\.html$/, ATTRIBUTE_VALUE],
    [/^(string|punctuation\.definition\.string|punctuation\.definition\.(interpolated-)?(char|string))\b/, STRING],
    [/^constant\.character\.escape\b/, '#FFD68F'],
    [/^constant\.character\.entity\b|^punctuation\.definition\.entity\b/, ENTITY],
    // Embedded <style>: VS colours selectors gold, property names light blue, values plain
    [/^(entity\.name\.tag|entity\.other\.attribute-name|entity\.other\.keyframe-offset)\b.*\.css$|^meta\.selector\.css$/, CSS_SELECTOR],
    [/^(support\.type\.(vendored\.)?property-name|meta\.property-name)\b.*\.css$/, LOCAL],
    [/^(support\.constant|constant\.numeric|keyword\.other\.unit|support\.function|constant\.other\.color|meta\.property-value)\b.*\.css$/, CSS_VALUE],
    [/^keyword\.control\.at-rule\b.*\.css$/, KEYWORD],
    [/^constant\.numeric\b/, NUMBER],
    [/^keyword\.control\.razor\.directive\.(model|functions|helper|inherits|section|layout)\b/, TEXT],
    [/^keyword\.control\.razor\.directive\b/, KEYWORD],
    [/^keyword\.control\.(cshtml|razor)\b/, TEXT],
    [/^keyword\.control\b/, CONTROL],
    [/^keyword\.operator\.(expression|new)\b/, KEYWORD],
    [/^keyword\.operator\b/, OPERATOR],
    [/^(keyword|storage|constant\.language)\b/, KEYWORD],
    [/^entity\.name\.function\b|^support\.function\b/, FUNCTION],
    [/^entity\.name\.type\.namespace\b|^entity\.name\.namespace\b/, TEXT],
    [/^entity\.name\.(type|class)\b|^support\.(type|class)\b|^storage\.type\.cs$/, TYPE],
    [/^entity\.name\.tag\b/, KEYWORD],
    [/^entity\.other\.attribute-name\b/, LOCAL],
    [/^punctuation\.definition\.tag\b/, TAG_PUNCTUATION],
    [/^entity\.name\.variable\.(local|parameter)\b|^variable\.parameter\b|^entity\.name\.variable\.tuple-element\b/, LOCAL],
    [/^variable\.other\.(object|readwrite)\.cs$/, LOCAL],
    [/^variable\b|^entity\.name\.variable\b/, TEXT],
    [/^punctuation\b|^meta\b|^source\b|^text\b/, TEXT]
];

// Rules that depend on the parent: `@using (...)` is a statement (purple in VS), `@using X;` a directive (blue).
const CONTEXT_RULES = [
    { scope: `${ROOT} meta.statement.using.razor keyword.other.using.cs`, foreground: CONTROL }
];

function colourFor(scope) {
    for (const [pattern, colour] of CATEGORIES) {
        if (pattern.test(scope)) {
            return colour;
        }
    }
    return null;
}

/** Source text of capture group k (0 = whole pattern) in a TextMate regex, or null. */
function groupSource(regex, k) {
    if (k === 0) {
        return regex;
    }
    let count = 0;
    for (let i = 0; i < regex.length; i++) {
        const c = regex[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '[') {
            while (i < regex.length && regex[i] !== ']') {
                i += regex[i] === '\\' ? 2 : 1;
            }
            continue;
        }
        if (c !== '(') {
            continue;
        }
        // Capturing: a plain or named group, not (?: (?= (?! (?<= (?<!
        const named = /^\(\?<[A-Za-z_]/.test(regex.slice(i, i + 4));
        if (regex[i + 1] === '?' && !named) {
            continue;
        }
        count++;
        if (count !== k) {
            continue;
        }
        let depth = 0;
        for (let j = i; j < regex.length; j++) {
            if (regex[j] === '\\') {
                j++;
            } else if (regex[j] === '(') {
                depth++;
            } else if (regex[j] === ')' && --depth === 0) {
                const inner = regex.slice(i + 1, j);
                return named ? inner.replace(/^\?<[A-Za-z_]\w*>/, '') : inner;
            }
        }
        return null;
    }
    return null;
}

/** Words a simple alternation like `bool|s?byte|n?u?int` can match, or null if it is not that simple. */
function expandAlternation(source) {
    const body = source.replace(/^\\b|\\b$/g, '');
    if (!/^[A-Za-z|?-]+$/.test(body)) {
        return null;
    }
    const words = [];
    for (const alt of body.split('|')) {
        let variants = [''];
        for (let i = 0; i < alt.length; i++) {
            const optional = alt[i + 1] === '?';
            const ch = alt[i];
            variants = optional ? variants.flatMap(v => [v, v + ch]) : variants.map(v => v + ch);
            if (optional) {
                i++;
            }
        }
        words.push(...variants.filter(Boolean));
    }
    return words;
}

/**
 * Scope names with capture placeholders (`keyword.type.$1.cs`) are expanded from the regex's alternatives
 * (`keyword.type.string.cs`, `keyword.type.long.cs`...). When the regex is too complex to expand, the
 * prefix before the placeholder is used instead, so the token still gets a (less specific) rule.
 */
function expandName(name, regex) {
    const m = name.match(/\$(\d+)/);
    if (!m) {
        return [name];
    }
    const source = typeof regex === 'string' ? groupSource(regex, Number(m[1])) : null;
    const words = source ? expandAlternation(source) : null;
    if (words) {
        return words.map(w => name.replace(m[0], w.toLowerCase()));
    }
    const prefix = name.slice(0, name.indexOf(m[0])).replace(/\.$/, '');
    return prefix ? [prefix] : [];
}

/** Collects every scope name a TextMate grammar can assign, with placeholders expanded. */
function scopesOf(grammar) {
    const found = new Set();
    const addAll = (value, regex) => {
        if (typeof value !== 'string') {
            return;
        }
        value.split(/\s+/).filter(Boolean).forEach(n => expandName(n, regex).forEach(s => found.add(s)));
    };
    const visit = node => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') {
            return;
        }
        addAll(node.name, node.match || node.begin);
        addAll(node.contentName, node.begin);
        const captureSets = [['captures', node.match || node.begin], ['beginCaptures', node.begin], ['endCaptures', node.end], ['whileCaptures', node.while]];
        for (const [key, regex] of captureSets) {
            for (const capture of Object.values(node[key] || {})) {
                addAll(capture && capture.name, regex);
            }
        }
        Object.values(node).forEach(visit);
    };
    visit(grammar);
    return found;
}

/** Builds textMateRules for the given grammars (parsed JSON objects). */
function buildRules(grammars) {
    const byColour = new Map();
    const scopes = new Set();
    grammars.forEach(g => scopesOf(g).forEach(s => scopes.add(s)));
    for (const scope of [...scopes].sort()) {
        const colour = colourFor(scope);
        if (!colour) {
            continue;
        }
        if (!byColour.has(colour)) {
            byColour.set(colour, []);
        }
        byColour.get(colour).push(`${ROOT} ${scope}`);
    }
    const rules = [{ scope: ROOT, settings: { foreground: TEXT } }];
    for (const [foreground, scope] of byColour) {
        rules.push({ scope, settings: { foreground } });
    }
    for (const r of CONTEXT_RULES) {
        rules.push({ scope: r.scope, settings: { foreground: r.foreground } });
    }
    return rules;
}

/** True for rules this extension owns, so re-applying replaces them instead of piling up. */
function isOwnRule(rule) {
    const scopes = Array.isArray(rule && rule.scope) ? rule.scope : [rule && rule.scope];
    return scopes.length > 0 && scopes.every(s => typeof s === 'string' && (s === ROOT || s.startsWith(ROOT + ' ')));
}

module.exports = { buildRules, isOwnRule, colourFor, scopesOf, expandName, ROOT };

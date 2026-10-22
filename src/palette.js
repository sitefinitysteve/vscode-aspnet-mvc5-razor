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

// First match wins, so specific categories come before general ones.
const CATEGORIES = [
    [/^comment\b|^punctuation\.definition\.comment\b/, COMMENT],
    [/^entity\.name\.function\.htmlhelper\.razor$/, TEXT],
    [/^(string|punctuation\.definition\.string)\b.*\.html$/, ATTRIBUTE_VALUE],
    [/^(string|punctuation\.definition\.string|punctuation\.definition\.(interpolated-)?(char|string))\b/, STRING],
    [/^constant\.character\.escape\b/, '#FFD68F'],
    [/^constant\.character\.entity\b|^punctuation\.definition\.entity\b/, ENTITY],
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

/** Collects every literal scope name a TextMate grammar can assign. */
function scopesOf(grammar) {
    const found = new Set();
    const visit = node => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') {
            return;
        }
        for (const key of ['name', 'contentName']) {
            if (typeof node[key] === 'string') {
                node[key].split(/\s+/).filter(s => s && !s.includes('$')).forEach(s => found.add(s));
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

module.exports = { buildRules, isOwnRule, colourFor, ROOT };

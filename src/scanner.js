'use strict';
/**
 * Lightweight Razor (System.Web.Razor / MVC5) span scanner.
 *
 * TextMate grammars cannot paint backgrounds, so this finds the spans Visual Studio paints:
 *  - transitions: `@`, `@(` + `)`, `@{` + `}`, `@*` + `*@`   (yellow in VS)
 *  - code:        C# owned by Razor, minus nested markup       (grey in VS)
 *  - text:        HTML text nodes                              (bold in VS)
 *
 * It is a best-effort parser of the MVC5 rules, not the Razor compiler: malformed input never
 * throws, it just stops colouring. All spans are [start, end) offsets into the document text.
 */

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const CONTROL_KEYWORDS = new Set(['if', 'for', 'foreach', 'while', 'switch', 'lock', 'using', 'try', 'do']);
const LINE_DIRECTIVES = new Set(['model', 'using', 'inherits', 'layout', 'sessionstate', 'implements', 'namespace', 'page', 'inject']);
// Previous non-whitespace characters after which `<` inside C# starts a markup element.
const MARKUP_AFTER = new Set(['{', '}', ';', ':', '>']);

function isIdStart(c) {
    return c !== undefined && /[A-Za-z_]/.test(c);
}

function isId(c) {
    return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

function isWs(c) {
    return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

function scan(text) {
    const n = text.length;
    const transitions = [];
    const code = [];
    const textRuns = [];

    function mark(list, a, b) {
        if (b > a) {
            list.push([a, b]);
        }
    }

    function skipWs(i) {
        while (i < n && isWs(text[i])) {
            i++;
        }
        return i;
    }

    // Whitespace plus `//` and `/* */` comments, e.g. `@if (x) // why` before the `{`.
    function skipWsAndComments(i) {
        for (;;) {
            const j = skipWs(i);
            if (text[j] === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) {
                i = skipCSharpLiteral(j);
                continue;
            }
            return j;
        }
    }

    function readWord(i) {
        let j = i;
        while (j < n && isId(text[j])) {
            j++;
        }
        return text.slice(i, j);
    }

    function prevNonWs(i) {
        let j = i - 1;
        while (j >= 0 && isWs(text[j])) {
            j--;
        }
        return j >= 0 ? text[j] : undefined;
    }

    // Skips a C# string/char/comment starting at i; returns i unchanged if none starts there.
    function skipCSharpLiteral(i) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            const e = text.indexOf('\n', i);
            return e < 0 ? n : e;
        }
        if (c === '/' && text[i + 1] === '*') {
            const e = text.indexOf('*/', i + 2);
            return e < 0 ? n : e + 2;
        }
        let j = i;
        let verbatim = false;
        while (text[j] === '$' || text[j] === '@') {
            verbatim = verbatim || text[j] === '@';
            j++;
        }
        if (j > i && text[j] !== '"') {
            return i;
        }
        const q = text[j];
        if (q !== '"' && q !== '\'') {
            return i;
        }
        j++;
        while (j < n) {
            const ch = text[j];
            if (!verbatim && ch === '\\') {
                j += 2;
                continue;
            }
            if (ch === q) {
                if (verbatim && text[j + 1] === q) {
                    j += 2;
                    continue;
                }
                return j + 1;
            }
            if (!verbatim && ch === '\n') {
                return j;
            }
            j++;
        }
        return n;
    }

    // i at an opening bracket; returns the index just past its match (pure C#, no markup).
    function skipBalanced(i) {
        const open = text[i];
        const close = open === '(' ? ')' : open === '[' ? ']' : '}';
        let depth = 0;
        let j = i;
        while (j < n) {
            const k = skipCSharpLiteral(j);
            if (k !== j) {
                j = k;
                continue;
            }
            const ch = text[j];
            if (ch === open) {
                depth++;
            } else if (ch === close) {
                depth--;
                if (depth === 0) {
                    return j + 1;
                }
            }
            j++;
        }
        return n;
    }

    // `<` at j starts markup when it begins a statement: first on its line, after a statement
    // terminator, or right after a nested transition/markup that ended at `seg`.
    function startsStatement(j, seg) {
        if (MARKUP_AFTER.has(prevNonWs(j) || '{')) {
            return true;
        }
        if (/^\s*$/.test(text.slice(seg, j))) {
            return true;
        }
        const lineStart = text.lastIndexOf('\n', j - 1) + 1;
        return /^[ \t]*$/.test(text.slice(lineStart, j));
    }

    // C# statement body. i just past `{`; returns the index of the closing `}` (or n).
    // Emits code spans itself and hands nested markup to scanElement / single-line markup.
    function codeBody(i) {
        let depth = 0;
        let seg = i;
        let j = i;
        while (j < n) {
            const k = skipCSharpLiteral(j);
            if (k !== j) {
                j = k;
                continue;
            }
            const ch = text[j];
            if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                if (depth === 0) {
                    mark(code, seg, j);
                    return j;
                }
                depth--;
            } else if (ch === '<' && (isIdStart(text[j + 1]) || text[j + 1] === '!') && startsStatement(j, seg)) {
                mark(code, seg, j);
                j = scanElement(j);
                seg = j;
                continue;
            } else if (ch === '@' && (isIdStart(text[j + 1]) || text[j + 1] === '(')) {
                // `@Html.Raw(...)` etc. as a statement inside a code block
                mark(code, seg, j);
                j = transition(j);
                seg = j;
                continue;
            } else if (ch === '@' && text[j + 1] === ':') {
                mark(code, seg, j);
                mark(transitions, j, j + 2);
                const eol = text.indexOf('\n', j);
                j = markup(j + 2, { kind: 'line', end: eol < 0 ? n : eol });
                seg = j;
                continue;
            } else if (ch === '@' && text[j + 1] === '*') {
                mark(code, seg, j);
                j = comment(j);
                seg = j;
                continue;
            }
            j++;
        }
        mark(code, seg, n);
        return n;
    }

    // `{ ... }` block owned by C#. i at `{`. Returns index just past `}`.
    function braceBlock(i, braceIsTransition) {
        mark(braceIsTransition ? transitions : code, i, i + 1);
        const close = codeBody(i + 1);
        if (close < n) {
            mark(braceIsTransition ? transitions : code, close, close + 1);
            return close + 1;
        }
        return n;
    }

    function comment(i) {
        mark(transitions, i, i + 2);
        const e = text.indexOf('*@', i + 2);
        if (e < 0) {
            return n;
        }
        mark(transitions, e, e + 2);
        return e + 2;
    }

    // i at the first char of a control keyword (after `@`). Returns index after the construct.
    function controlStructure(i, word) {
        let j = i + word.length;
        mark(code, i, j);
        const clause = (from) => {
            let k = skipWsAndComments(from);
            if (text[k] === '(') {
                const e = skipBalanced(k);
                mark(code, k, e);
                k = skipWsAndComments(e);
                mark(code, e, k);
            }
            if (text[k] === '{') {
                return braceBlock(k, false);
            }
            return from;
        };
        j = clause(j);
        for (;;) {
            const k = skipWs(j);
            const w = readWord(k);
            const continues =
                (w === 'else' && (word === 'if' || word === 'else')) ||
                ((w === 'catch' || w === 'finally') && (word === 'try' || word === 'catch')) ||
                (w === 'while' && word === 'do');
            if (!continues) {
                return j;
            }
            mark(code, k, k + w.length);
            word = w;
            let after = k + w.length;
            if (w === 'else') {
                const k2 = skipWs(after);
                if (readWord(k2) === 'if') {
                    mark(code, k2, k2 + 2);
                    after = k2 + 2;
                    word = 'if';
                }
            }
            if (w === 'while') {
                let k2 = skipWs(after);
                if (text[k2] === '(') {
                    const e = skipBalanced(k2);
                    mark(code, k2, e);
                    k2 = e;
                }
                if (text[k2] === ';') {
                    mark(code, k2, k2 + 1);
                    k2++;
                }
                return k2;
            }
            j = clause(after);
        }
    }

    // Implicit expression after `@`: identifier(.identifier | (...) | [...])*
    function implicitExpression(i) {
        let j = i + readWord(i).length;
        for (;;) {
            const c = text[j];
            if (c === '(' || c === '[') {
                j = skipBalanced(j);
            } else if (c === '.' && isIdStart(text[j + 1])) {
                j++;
                j += readWord(j).length;
            } else {
                return j;
            }
        }
    }

    // i at `@` in markup context. Returns the index to continue scanning markup from.
    function transition(i) {
        const next = text[i + 1];
        if (next === '@') {
            return i + 2;
        }
        if (isId(text[i - 1]) && isId(next)) {
            // e-mail address: Razor leaves it as literal text
            return i + 1;
        }
        if (next === '*') {
            return comment(i);
        }
        if (next === '(') {
            mark(transitions, i, i + 2);
            const e = skipBalanced(i + 1);
            mark(code, i + 2, e - 1);
            if (e <= n && text[e - 1] === ')') {
                mark(transitions, e - 1, e);
            }
            return e;
        }
        if (next === '{') {
            mark(transitions, i, i + 1);
            return braceBlock(i + 1, true);
        }
        if (!isIdStart(next)) {
            return i + 1;
        }
        mark(transitions, i, i + 1);
        const start = i + 1;
        const word = readWord(start);
        const afterWord = skipWs(start + word.length);

        if (CONTROL_KEYWORDS.has(word) && !(word === 'using' && text[afterWord] !== '(')) {
            return controlStructure(start, word);
        }
        if (word === 'functions') {
            if (text[afterWord] !== '{') {
                mark(code, start, start + word.length);
                return start + word.length;
            }
            const e = skipBalanced(afterWord);
            mark(code, start, e);
            return e;
        }
        if (word === 'helper') {
            let k = afterWord + readWord(afterWord).length;
            k = skipWs(k);
            if (text[k] === '(') {
                k = skipBalanced(k);
            }
            mark(code, start, k);
            k = skipWs(k);
            return text[k] === '{' ? braceBlock(k, false) : k;
        }
        if (word === 'section') {
            let k = afterWord + readWord(afterWord).length;
            mark(code, start, k);
            k = skipWs(k);
            if (text[k] !== '{') {
                return k;
            }
            mark(code, k, k + 1);
            const close = markup(k + 1, { kind: 'brace' });
            if (close < n) {
                mark(code, close, close + 1);
                return close + 1;
            }
            return n;
        }
        if (LINE_DIRECTIVES.has(word)) {
            const eol = text.indexOf('\n', start);
            const end = eol < 0 ? n : eol;
            mark(code, start, end);
            return end;
        }
        const e = implicitExpression(start);
        mark(code, start, e);
        return e;
    }

    // Tag at i (`<`). Scans attributes (handling @ inside them). Returns {end, name, selfClosing, closing}.
    function scanTag(i) {
        let j = i + 1;
        const closing = text[j] === '/';
        if (closing) {
            j++;
        }
        if (text[j] === '!') {
            const e = text.indexOf('>', j);
            return { end: e < 0 ? n : e + 1, name: '!', selfClosing: true, closing: false };
        }
        const name = readWord(j).toLowerCase();
        j += name.length;
        let quote = null;
        while (j < n) {
            const ch = text[j];
            if (ch === '@') {
                j = transition(j);
                continue;
            }
            if (quote) {
                if (ch === quote) {
                    quote = null;
                }
            } else if (ch === '"' || ch === '\'') {
                quote = ch;
            } else if (ch === '>') {
                return { end: j + 1, name, selfClosing: text[j - 1] === '/', closing };
            }
            j++;
        }
        return { end: n, name, selfClosing: true, closing };
    }

    // Whole element starting at `<`, used when markup is nested in C#. Returns index past it.
    function scanElement(i) {
        if (text.startsWith('<!--', i)) {
            const e = text.indexOf('-->', i + 4);
            return e < 0 ? n : e + 3;
        }
        const tag = scanTag(i);
        if (tag.selfClosing || tag.closing || VOID_ELEMENTS.has(tag.name)) {
            return tag.end;
        }
        return markup(tag.end, { kind: 'element', name: tag.name, raw: RAW_TEXT_ELEMENTS.has(tag.name) });
    }

    // Markup context. Modes: eof (top level), brace (@section body, returns index of `}`),
    // element (returns index past the matching close tag), line (`@:` to end of line).
    function markup(i, mode) {
        let depth = 1;
        let braceDepth = 0;
        let runStart = -1;
        let runEnd = -1;
        const raw = !!mode.raw;
        const flush = () => {
            if (runStart >= 0 && !raw) {
                mark(textRuns, runStart, runEnd);
            }
            runStart = -1;
        };
        let j = i;
        const limit = mode.kind === 'line' ? mode.end : n;
        while (j < limit) {
            const ch = text[j];
            if (ch === '@') {
                const marked = transitions.length;
                const k = transition(j);
                // `@@`, e-mail addresses and stray `@` are literal text, not Razor
                if (transitions.length === marked) {
                    if (runStart < 0) {
                        runStart = j;
                    }
                    runEnd = k;
                } else {
                    flush();
                }
                j = k;
                continue;
            }
            if (ch === '<' && !raw && text.startsWith('<!--', j)) {
                flush();
                const e = text.indexOf('-->', j + 4);
                j = e < 0 ? n : e + 3;
                continue;
            }
            if (ch === '<' && (isIdStart(text[j + 1]) || text[j + 1] === '/' || text[j + 1] === '!')) {
                if (raw && !(text[j + 1] === '/' && readWord(j + 2).toLowerCase() === mode.name)) {
                    j++;
                    continue;
                }
                flush();
                const tag = scanTag(j);
                j = tag.end;
                if (mode.kind === 'element' && tag.name === mode.name) {
                    if (tag.closing) {
                        depth--;
                        if (depth === 0) {
                            return j;
                        }
                    } else if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) {
                        depth++;
                    }
                } else if (!tag.closing && !tag.selfClosing && RAW_TEXT_ELEMENTS.has(tag.name)) {
                    j = markup(j, { kind: 'element', name: tag.name, raw: true });
                }
                continue;
            }
            if (mode.kind === 'brace') {
                if (ch === '{') {
                    braceDepth++;
                } else if (ch === '}') {
                    if (braceDepth === 0) {
                        flush();
                        return j;
                    }
                    braceDepth--;
                }
            }
            if (!isWs(ch)) {
                if (runStart < 0) {
                    runStart = j;
                }
                runEnd = j + 1;
            }
            j++;
        }
        flush();
        return j;
    }

    markup(0, { kind: 'eof' });
    return {
        transitions,
        code: splitTrimmed(text, code),
        text: textRuns
    };
}

// VS paints code backgrounds per line, from first to last non-whitespace character.
function splitTrimmed(text, spans) {
    // Pieces separated only by spaces/tabs on one line paint as one band
    const merged = [];
    for (const span of [...spans].sort((x, y) => x[0] - y[0])) {
        const last = merged[merged.length - 1];
        if (last && /^[ \t]*$/.test(text.slice(last[1], span[0]))) {
            last[1] = Math.max(last[1], span[1]);
        } else {
            merged.push([span[0], span[1]]);
        }
    }
    const out = [];
    for (const [a, b] of merged) {
        let s = a;
        while (s < b) {
            let e = text.indexOf('\n', s);
            if (e < 0 || e > b) {
                e = b;
            }
            let x = s;
            let y = e;
            while (x < y && isWs(text[x])) {
                x++;
            }
            while (y > x && isWs(text[y - 1])) {
                y--;
            }
            if (y > x) {
                out.push([x, y]);
            }
            s = e + 1;
        }
    }
    return out;
}

module.exports = { scan };

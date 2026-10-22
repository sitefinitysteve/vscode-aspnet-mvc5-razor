'use strict';
/**
 * Convention-based stand-in for Visual Studio's semantic colouring of member-chain roots, which
 * TextMate cannot see (it scopes `Model`, `Util` and `feed` identically):
 *  - Razor page properties (Model, Html, Url, ViewBag...)  -> plain text
 *  - namespace chains (roots from @using/@model + settings) -> plain, `Ns.Type.Method(` makes Type a type
 *  - any other PascalCase root                              -> type (static class: Util, Math, String)
 *  - camelCase roots are locals and keep their TextMate colour
 * Spans are [start, end) document offsets, like the scanner's.
 */

const PAGE_PROPERTIES = new Set([
    'Model', 'Html', 'Url', 'Ajax', 'ViewBag', 'ViewData', 'TempData', 'Request', 'Response', 'Session',
    'Server', 'Context', 'User', 'Layout', 'Page', 'PageData', 'Culture', 'UICulture', 'Output', 'Href',
    'IsPost', 'IsAjax', 'Cache', 'Profile', 'App', 'AppState', 'ViewContext', 'WebPageContext', 'VirtualPath'
]);
const DEFAULT_NAMESPACE_ROOTS = ['System', 'Microsoft'];
const LITERALS = /@"(?:[^"]|"")*"|\$?"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const DIRECTIVE_ROOT = /^[ \t]*@(?:using|model|inherits)[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([A-Za-z_]\w*)\./gm;
const CHAIN_ROOT = /(?<![\w.@$])([A-Za-z_]\w*)(?=\s*\.\s*[A-Za-z_])/g;
const IDENTIFIER = /[A-Za-z_]\w*/g;

// Masks string/char literals and comments with spaces so identifiers inside them are ignored.
function maskLiterals(code) {
    return code.replace(LITERALS, m => ' '.repeat(m.length));
}

/** Namespace roots used by this view: first segments of @using / @model / @inherits, plus extras. */
function namespaceRoots(text, extra) {
    const roots = new Set(DEFAULT_NAMESPACE_ROOTS.concat(extra || []));
    for (const m of text.matchAll(DIRECTIVE_ROOT)) {
        roots.add(m[1]);
    }
    return roots;
}

function classify(text, codeSpans, extraRoots) {
    const roots = namespaceRoots(text, extraRoots);
    const plain = [];
    const types = [];
    for (const [a, b] of codeSpans) {
        const code = maskLiterals(text.slice(a, b));
        // `@using X.Y;` / `@model X.Y` lines are directives: the grammar already colours them
        if (/^\s*(using|model|inherits)\b/.test(code) && !/^\s*using\s*\(/.test(code)) {
            continue;
        }
        let skipUntil = 0;
        for (const m of code.matchAll(CHAIN_ROOT)) {
            if (m.index < skipUntil) {
                continue;
            }
            const name = m[1];
            const start = a + m.index;
            if (PAGE_PROPERTIES.has(name)) {
                plain.push([start, start + name.length]);
            } else if (roots.has(name)) {
                // Ns.Ns.Type.Member: segments stay plain; the one before a call is the type
                const rest = code.slice(m.index + name.length);
                const chain = /^(?:\s*\.\s*[A-Za-z_]\w*)*/.exec(rest)[0];
                const segs = [[m.index, name]];
                for (const s of chain.matchAll(IDENTIFIER)) {
                    segs.push([m.index + name.length + s.index, s[0]]);
                }
                const callsLast = /^\s*\(/.test(rest.slice(chain.length));
                segs.forEach(([off, seg], k) => {
                    const span = [a + off, a + off + seg.length];
                    if (callsLast && k === segs.length - 2 && /^[A-Z]/.test(seg)) {
                        types.push(span);
                    } else if (k < segs.length - 1 || !callsLast) {
                        plain.push(span);
                    }
                });
                skipUntil = m.index + name.length + chain.length;
            } else if (/^[A-Z]/.test(name)) {
                types.push([start, start + name.length]);
            }
        }
    }
    return { plain, types };
}

module.exports = { classify, namespaceRoots, PAGE_PROPERTIES };

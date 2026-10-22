'use strict';
// node scripts/check-views.js <folder>
// Scans every .cshtml under <folder> and reports likely misparses: HTML painted as C# code,
// and C# shown as markup text. Use after changing src/scanner.js.
const fs = require('fs');
const path = require('path');
const { scan } = require('../src/scanner');

const root = process.argv[2];
if (!root) {
    console.error('usage: node scripts/check-views.js <folder>');
    process.exit(2);
}
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && !/^(node_modules|bin|obj|\.git)$/.test(e.name)) {
            walk(p);
        } else if (e.name.endsWith('.cshtml')) {
            files.push(p);
        }
    }
})(root);

const csharpLike = /^(var |foreach|if \(|else\b|return |\}$|\{$)|\);\s*$|=>/;
let problems = 0;
let slowest = 0;
for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const started = process.hrtime.bigint();
    const r = scan(t);
    slowest = Math.max(slowest, Number(process.hrtime.bigint() - started) / 1e6);
    const at = a => path.relative(root, f) + ':' + t.slice(0, a).split('\n').length;
    for (const [a, b] of r.code) {
        if (/^<\/?[A-Za-z]/.test(t.slice(a, b))) {
            problems++;
            console.log('markup as code  ' + at(a) + '  ' + t.slice(a, Math.min(b, a + 70)));
        }
    }
    for (const [a, b] of r.text) {
        const s = t.slice(a, b).trim();
        if (csharpLike.test(s) && !/^\{\{|\}\}$/.test(s)) {
            problems++;
            console.log('C# as text      ' + at(a) + '  ' + s.slice(0, 70));
        }
    }
}
console.log(files.length + ' views, ' + problems + ' suspect spans, slowest ' + slowest.toFixed(1) + ' ms');

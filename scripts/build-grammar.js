'use strict';
// Regenerates syntaxes/aspnetmvc5razor.tmLanguage.json from the Razor grammar that ships in the
// installed C# extension (ms-dotnettools.csharp, MIT, originally from dotnet/razor).
// Usage: node scripts/build-grammar.js [path-to-aspnetcorerazor.tmLanguage.json]
const fs = require('fs');
const os = require('os');
const path = require('path');

function findInstalledGrammar() {
    const root = path.join(os.homedir(), '.vscode', 'extensions');
    const dirs = fs.readdirSync(root)
        .filter(d => d.startsWith('ms-dotnettools.csharp-'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const d of dirs.reverse()) {
        const p = path.join(root, d, 'src', 'razor', 'syntaxes', 'aspnetcorerazor.tmLanguage.json');
        if (fs.existsSync(p)) {
            return p;
        }
    }
    throw new Error('No installed ms-dotnettools.csharp Razor grammar found under ' + root);
}

const source = process.argv[2] || findInstalledGrammar();
const grammar = JSON.parse(fs.readFileSync(source, 'utf8'));

grammar.name = 'ASP.NET MVC 5 Razor';
grammar.scopeName = 'text.aspnetmvc5razor';
grammar.fileTypes = ['cshtml'];

// @helper is MVC5-only (removed in ASP.NET Core), so the Core grammar has no rule for it.
grammar.repository['helper-directive'] = {
    name: 'meta.directive.block',
    begin: '(@)(helper)\\b\\s+([_[:alpha:]][_[:alnum:]]*)',
    beginCaptures: {
        1: { patterns: [{ include: '#transition' }] },
        2: { name: 'keyword.control.razor.directive.helper' },
        3: { name: 'entity.name.function.cs' }
    },
    patterns: [
        { include: 'source.cs#parenthesized-parameter-list' },
        { include: '#csharp-code-block' }
    ],
    end: '(?<=})'
};
const directives = grammar.repository.directives.patterns;
if (!directives.some(p => p.include === '#helper-directive')) {
    directives.unshift({ include: '#helper-directive' });
}

// VS colours `@model Foo.Bar.Baz` as namespace `Foo.Bar.` + type `Baz`; the Core grammar makes it all type.
const qualifiedType = [
    {
        match: '([_[:alpha:]][_[:alnum:]]*)(\\.)(?=[_[:alpha:]])',
        captures: {
            1: { name: 'entity.name.type.namespace.cs' },
            2: { name: 'punctuation.accessor.cs' }
        }
    },
    { include: 'source.cs#type' }
];
for (const key of ['model-directive', 'inherits-directive']) {
    grammar.repository[key].captures[3] = { patterns: qualifiedType };
}

const out = path.join(__dirname, '..', 'syntaxes', 'aspnetmvc5razor.tmLanguage.json');
fs.writeFileSync(out, JSON.stringify(grammar, null, 2) + '\n');
console.log('Wrote ' + out + ' from ' + source);

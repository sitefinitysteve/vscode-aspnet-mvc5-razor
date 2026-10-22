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

// VS shows HtmlHelper calls (`Html.Partial(`, `Html.Raw(`) in plain text colour, unlike other method calls.
// Left-priority injection so it wins over the C# grammar's invocation rule.
grammar.repository['htmlhelper-method'] = {
    match: '(?<=\\bHtml\\.)[_[:alpha:]][_[:alnum:]]*(?=\\s*[(<])',
    name: 'entity.name.function.htmlhelper.razor'
};
// Same, anchored at `Html` so it wins inside a capture, where the C# expression rule would start there first.
grammar.repository['htmlhelper-call'] = {
    match: '\\b(Html)(\\.)([_[:alpha:]][_[:alnum:]]*)(?=\\s*[(<])',
    captures: {
        1: { name: 'variable.other.object.cs' },
        2: { name: 'punctuation.accessor.cs' },
        3: { name: 'entity.name.function.htmlhelper.razor' }
    }
};
grammar.injections['L:source.cs - string - comment'] = {
    patterns: [{ include: '#htmlhelper-method' }]
};

// Razor still runs inside <script> and <style> (`var url = '@Url.Action(...)'`, `@* note *@`), but the Core
// grammar only injects into HTML attribute strings and C#, so those regions were coloured as plain JS/CSS.
// The Core #implicit-expression is a begin/end region that recurses forever inside embedded JS, so script and
// style get a single-match version: `@ident` + `.ident` / `(...)` / `[...]` (one nesting level), C# inside.
grammar.repository['implicit-expression-embedded'] = {
    match: '(?<![[:alnum:]_.])(@)([_[:alpha:]][_[:alnum:]]*(?:\\.[_[:alpha:]][_[:alnum:]]*|\\((?:[^()]|\\([^()]*\\))*\\)|\\[[^\\[\\]]*\\])*)',
    name: 'meta.expression.implicit.cshtml',
    captures: {
        1: { patterns: [{ include: '#transition' }] },
        2: { name: 'source.cs', patterns: [{ include: '#htmlhelper-call' }, { include: 'source.cs#expression' }] }
    }
};
grammar.injections['L:source.js, L:source.css'] = {
    patterns: [
        { include: '#razor-comment' },
        { include: '#escaped-transition' },
        { include: '#explicit-razor-expression' },
        { include: '#razor-codeblock' },
        { include: '#transitioned-csharp-control-structures' },
        { include: '#implicit-expression-embedded' }
    ]
};

const out = path.join(__dirname, '..', 'syntaxes', 'aspnetmvc5razor.tmLanguage.json');
fs.writeFileSync(out, JSON.stringify(grammar, null, 2) + '\n');
console.log('Wrote ' + out + ' from ' + source);

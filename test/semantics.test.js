'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scan } = require('../src/scanner');
const { classify } = require('../src/semantics');

function roles(src) {
    const r = classify(src, scan(src).code);
    const show = list => list.map(([a, b]) => src.slice(a, b));
    return { plain: show(r.plain), types: show(r.types) };
}

test('static classes are types, page properties plain, locals untouched', () => {
    const src = '<input value="@Util.CurrentReturnUrl" /><p>@Model.Entry.Title @feed.Key @Math.Ceiling(4.0)</p>';
    const r = roles(src);
    assert.deepStrictEqual(r.types, ['Util', 'Math']);
    assert.deepStrictEqual(r.plain, ['Model']);
});

test('identifiers inside strings are ignored', () => {
    const r = roles('<p>@Html.Raw("Util.Foo")</p>');
    assert.deepStrictEqual(r.types, []);
    assert.deepStrictEqual(r.plain, ['Html']);
});

test('namespace chain from @using: segments plain, type before a call is a type', () => {
    const src = '@using Medportal.Sitefinity.Controls;\n<div>@Html.Raw(Medportal.Sitefinity.Controls.RpPortfolio.DetailModel.DisplayHtml(Model.Text))</div>';
    const r = roles(src);
    assert.deepStrictEqual(r.types, ['DetailModel']);
    assert.deepStrictEqual(r.plain, ['Html', 'Medportal', 'Sitefinity', 'Controls', 'RpPortfolio', 'Model']);
});

test('using statement and code blocks are classified', () => {
    const src = '@using (Html.BeginForm("A", "B", FormMethod.Post)) { }\n@{ var x = String.Format("{0}", StringComparer.Ordinal); }';
    const r = roles(src);
    assert.deepStrictEqual(r.types, ['FormMethod', 'String', 'StringComparer']);
});

test('roots from .cs namespaces, web.config and NuGet ids', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { collectRoots } = require('../src/roots');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc5razor-'));
    const cs = path.join(dir, 'A.cs');
    const cfg = path.join(dir, 'packages.config');
    const web = path.join(dir, 'web.config');
    fs.writeFileSync(cs, 'using System;\nnamespace Acme.Web.Models\n{\n}\n');
    fs.writeFileSync(cfg, '<packages><package id="ServiceStack.Text" version="1" /></packages>');
    fs.writeFileSync(web, '<namespaces><add namespace="Kendo.Mvc.UI" /></namespaces>');
    const roots = collectRoots([cs], [cfg, web]);
    assert.deepStrictEqual([...roots].sort(), ['Acme', 'Kendo', 'ServiceStack']);
    fs.rmSync(dir, { recursive: true, force: true });
});

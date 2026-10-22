'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scan } = require('../src/scanner');

// Renders spans back to their text so expectations read like the source.
function spans(src) {
    const r = scan(src);
    const show = list => list.map(([a, b]) => src.slice(a, b));
    return { transitions: show(r.transitions), code: show(r.code), text: show(r.text) };
}

test('implicit expression in an attribute', () => {
    const r = spans('<a data-slug="@p.UrlName" href="#">Go</a>');
    assert.deepStrictEqual(r.transitions, ['@']);
    assert.deepStrictEqual(r.code, ['p.UrlName']);
    assert.deepStrictEqual(r.text, ['Go']);
});

test('implicit expression with invocation stops at markup', () => {
    const r = spans('<div>@RenderMFItem(Model.Mf1)</div>');
    assert.deepStrictEqual(r.code, ['RenderMFItem(Model.Mf1)']);
});

test('explicit expression marks @( and ) as transitions, strings stay code', () => {
    const r = spans('<li class="@(Model.SelectedMF == 1 ? "active" : "")">x</li>');
    assert.deepStrictEqual(r.transitions, ['@(', ')']);
    assert.deepStrictEqual(r.code, ['Model.SelectedMF == 1 ? "active" : ""']);
});

test('if / else if / else with nested markup', () => {
    const src = [
        '@if (Model.Entry.CommentCount == 1)',
        '{',
        '    <h2 class="t">1 Comment</h2>',
        '}',
        'else if (Model.Entry.CommentCount > 1)',
        '{',
        '    <h2>@Model.Entry.CommentCount Comments</h2>',
        '}',
        'else',
        '{',
        '    <h2>Comments</h2>',
        '}',
        '<p>after</p>'
    ].join('\n');
    const r = spans(src);
    assert.deepStrictEqual(r.code, [
        'if (Model.Entry.CommentCount == 1)', '{', '}',
        'else if (Model.Entry.CommentCount > 1)', '{', 'Model.Entry.CommentCount', '}',
        'else', '{', '}'
    ]);
    assert.deepStrictEqual(r.text, ['1 Comment', 'Comments', 'Comments', 'after']);
});

test('foreach with lambda and nested elements', () => {
    const src = '@foreach (var c in Model.Comments.OrderBy(x => x.Date))\n{\n  <div><span>@c.Text</span></div>\n}\n';
    const r = spans(src);
    assert.deepStrictEqual(r.code, ['foreach (var c in Model.Comments.OrderBy(x => x.Date))', '{', 'c.Text', '}']);
});

test('razor comments mark both delimiters only', () => {
    const r = spans('@* note *@<b>x</b>');
    assert.deepStrictEqual(r.transitions, ['@*', '*@']);
    assert.deepStrictEqual(r.code, []);
});

test('functions block is all code, including braces in strings', () => {
    const src = '@functions {\n  object Row(Item p)\n  {\n    return new { url = String.Format("/x/{0}", p.Id) };\n  }\n}\n<p>t</p>';
    const r = spans(src);
    assert.deepStrictEqual(r.code, ['functions {', 'object Row(Item p)', '{', 'return new { url = String.Format("/x/{0}", p.Id) };', '}', '}']);
    assert.deepStrictEqual(r.text, ['t']);
});

test('helper with markup body and nested statements', () => {
    const src = '@helper Render(List<Item> items)\n{\n  <table>@if (items == null) { <tr><td>None</td></tr> }</table>\n}\n<p>t</p>';
    const r = spans(src);
    assert.deepStrictEqual(r.code, ['helper Render(List<Item> items)', '{', 'if (items == null) {', '}', '}']);
    assert.deepStrictEqual(r.text, ['None', 't']);
});

test('code block @{ } braces are transitions', () => {
    const src = '@{\n    var x = "a}b";\n    <p>@x</p>\n}\n';
    const r = spans(src);
    assert.deepStrictEqual(r.transitions, ['@', '{', '@', '}']);
    assert.deepStrictEqual(r.code, ['var x = "a}b";', 'x']);
});

test('line directives, escaped @@ and e-mail addresses', () => {
    const src = '@model Foo.Bar\n@using System.Linq;\n<p>steve@medportal.ca @@home</p>';
    const r = spans(src);
    assert.deepStrictEqual(r.code, ['model Foo.Bar', 'using System.Linq;']);
    assert.deepStrictEqual(r.text, ['steve@medportal.ca @@home']);
});

test('@: single-line markup and @Html calls inside script', () => {
    const src = '@if (a) {\n  @:Hello @name\n}\n<script>var u = "@Url.Content("~/x")";</script>';
    const r = spans(src);
    assert.ok(r.transitions.includes('@:'));
    assert.ok(r.code.includes('Url.Content("~/x")'));
    assert.ok(!r.text.some(t => t.includes('var u')));
});

test('markup after in-code @expr, // comment and @* *@ inside a block', () => {
    const src = [
        '@if (a) // trailing why',
        '{',
        '    @Html.Raw(Model.MenuHtml)',
        '    <li>One</li>',
        '    //ABSENT',
        '    <td></td>',
        '    @* note *@',
        '    <b>Two</b>',
        '}'
    ].join('\n');
    const r = spans(src);
    assert.deepStrictEqual(r.code, ['if (a) // trailing why', '{', 'Html.Raw(Model.MenuHtml)', '//ABSENT', '}']);
    assert.deepStrictEqual(r.text, ['One', 'Two']);
});

test('section body is markup', () => {
    const r = spans('@section Scripts {\n  <p>hi</p>\n}\n<b>x</b>');
    assert.deepStrictEqual(r.code, ['section Scripts {', '}']);
    assert.deepStrictEqual(r.text, ['hi', 'x']);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { expandName, scopesOf, colourFor } = require('../src/palette');

test('placeholder scopes expand from the regex alternatives', () => {
    const words = expandName('keyword.type.$1.cs', '\\b(bool|s?byte|n?u?int|u?long|string)\\b');
    assert.deepStrictEqual(words, [
        'keyword.type.bool.cs', 'keyword.type.byte.cs', 'keyword.type.sbyte.cs',
        'keyword.type.int.cs', 'keyword.type.uint.cs', 'keyword.type.nint.cs', 'keyword.type.nuint.cs',
        'keyword.type.long.cs', 'keyword.type.ulong.cs', 'keyword.type.string.cs'
    ]);
});

test('placeholders in capture names use their own regex; complex ones fall back to the prefix', () => {
    const grammar = {
        patterns: [
            { match: '(?<!\\.)\\b(public|static)\\b', name: 'storage.modifier.$1.cs' },
            { match: '(&)((a(s(ymp)?)))', captures: { 2: { name: 'constant.character.entity.named.$2.html' } } }
        ]
    };
    const scopes = [...scopesOf(grammar)].sort();
    assert.deepStrictEqual(scopes, ['constant.character.entity.named', 'storage.modifier.public.cs', 'storage.modifier.static.cs']);
});

test('Visual Studio colours for C#, embedded CSS and JS scopes', () => {
    assert.strictEqual(colourFor('keyword.type.string.cs'), '#569CD6');
    assert.strictEqual(colourFor('entity.other.attribute-name.class.css'), '#D7BA7D');
    assert.strictEqual(colourFor('support.type.property-name.css'), '#9CDCFE');
    assert.strictEqual(colourFor('entity.name.function.js'), '#DCDCAA');
    assert.strictEqual(colourFor('entity.name.function.htmlhelper.razor'), '#DCDCDC');
});

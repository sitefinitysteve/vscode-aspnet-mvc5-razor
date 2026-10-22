'use strict';
const vscode = require('vscode');
const { scan } = require('./scanner');

const LANGUAGE_ID = 'aspnetmvc5razor';
// Languages VS Code (or the C# extension) may have picked for a .cshtml before we take it over.
const TAKEOVER_FROM = new Set(['razor', 'aspnetcorerazor', 'html', 'plaintext']);

let decorations = null;
const timers = new Map();
// URIs already switched once this session, so a manual language pick is never fought.
const switched = new Set();

function createDecorations() {
    const config = vscode.workspace.getConfiguration('aspnetMvc5Razor');
    return {
        code: vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('aspnetMvc5Razor.codeBackground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        }),
        transition: vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('aspnetMvc5Razor.transitionBackground'),
            color: new vscode.ThemeColor('aspnetMvc5Razor.transitionForeground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        }),
        text: vscode.window.createTextEditorDecorationType({
            fontWeight: config.get('boldMarkupText') ? 'bold' : undefined
        })
    };
}

function disposeDecorations() {
    if (decorations) {
        Object.values(decorations).forEach(d => d.dispose());
        decorations = null;
    }
}

function decorate(editor) {
    if (!decorations || editor.document.languageId !== LANGUAGE_ID) {
        return;
    }
    const doc = editor.document;
    const result = scan(doc.getText());
    const toRanges = list => list.map(([a, b]) => new vscode.Range(doc.positionAt(a), doc.positionAt(b)));
    editor.setDecorations(decorations.code, toRanges(result.code));
    editor.setDecorations(decorations.transition, toRanges(result.transitions));
    editor.setDecorations(decorations.text, toRanges(result.text));
}

function decorateDocument(document, delay) {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        vscode.window.visibleTextEditors
            .filter(e => e.document === document)
            .forEach(decorate);
    }, delay));
}

function maybeTakeOver(document) {
    const key = document.uri.toString();
    if (!document.fileName.toLowerCase().endsWith('.cshtml') || switched.has(key)) {
        return;
    }
    if (!TAKEOVER_FROM.has(document.languageId)) {
        return;
    }
    if (!vscode.workspace.getConfiguration('aspnetMvc5Razor').get('takeOverCshtml')) {
        return;
    }
    switched.add(key);
    vscode.languages.setTextDocumentLanguage(document, LANGUAGE_ID);
}

function activate(context) {
    decorations = createDecorations();
    context.subscriptions.push(
        { dispose: disposeDecorations },
        vscode.workspace.onDidOpenTextDocument(maybeTakeOver),
        vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(decorate)),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === LANGUAGE_ID) {
                decorateDocument(e.document, 120);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aspnetMvc5Razor')) {
                disposeDecorations();
                decorations = createDecorations();
                vscode.window.visibleTextEditors.forEach(decorate);
            }
        })
    );
    vscode.workspace.textDocuments.forEach(maybeTakeOver);
    vscode.window.visibleTextEditors.forEach(decorate);
}

function deactivate() {
    disposeDecorations();
}

module.exports = { activate, deactivate };

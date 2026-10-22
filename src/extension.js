'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { scan } = require('./scanner');
const { classify } = require('./semantics');
const { buildRules, isOwnRule } = require('./palette');
const { collectRootsAsync } = require('./roots');

const LANGUAGE_ID = 'aspnetmvc5razor';
// Languages VS Code (or the C# extension) may have picked for a .cshtml before we take it over.
const TAKEOVER_FROM = new Set(['razor', 'aspnetcorerazor', 'html', 'plaintext']);

let decorations = null;
const timers = new Map();
// URIs already switched once this session, so a manual language pick is never fought.
const switched = new Set();
// Namespace roots declared in the workspace (.cs, web.config, NuGet ids); filled in the background.
let workspaceRoots = [];
const EXCLUDE = '**/{bin,obj,node_modules,packages,.git,dist}/**';

function createDecorations() {
    const config = vscode.workspace.getConfiguration('aspnetMvc5Razor');
    return {
        code: vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('aspnetMvc5Razor.codeBackground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        }),
        // VS paints transitions like a highlighter: only the text cell, not the full line height.
        // backgroundColor would fill the line, so the background goes on the inline span via CSS.
        transition: vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; background-color: var(--vscode-aspnetMvc5Razor-transitionBackground)',
            color: new vscode.ThemeColor('aspnetMvc5Razor.transitionForeground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        }),
        text: vscode.window.createTextEditorDecorationType({
            fontWeight: config.get('boldMarkupText') ? 'bold' : undefined
        }),
        // Member-chain roots TextMate scopes alike: static classes vs page properties (see semantics.js)
        type: vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('aspnetMvc5Razor.staticType')
        }),
        plain: vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('aspnetMvc5Razor.plainIdentifier')
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
    const roots = workspaceRoots.concat(vscode.workspace.getConfiguration('aspnetMvc5Razor').get('namespaceRoots') || []);
    const roles = classify(doc.getText(), result.code, roots);
    editor.setDecorations(decorations.type, toRanges(roles.types));
    editor.setDecorations(decorations.plain, toRanges(roles.plain));
}

async function discoverRoots() {
    const [cs, configs] = await Promise.all([
        vscode.workspace.findFiles('**/*.cs', EXCLUDE, 20000),
        vscode.workspace.findFiles('**/{web.config,Web.config,packages.config,*.csproj}', EXCLUDE, 2000)
    ]);
    const roots = await collectRootsAsync(cs.map(u => u.fsPath), configs.map(u => u.fsPath));
    workspaceRoots = [...roots];
    vscode.window.visibleTextEditors.forEach(decorate);
}

function readGrammar(extensionPath, relative) {
    try {
        return JSON.parse(fs.readFileSync(path.join(extensionPath, relative), 'utf8'));
    } catch (e) {
        return null;
    }
}

// Grammars whose scopes can appear in a view: ours plus the built-in ones it embeds (C#, HTML, <script>, <style>).
function viewGrammars(context) {
    const grammars = [readGrammar(context.extensionPath, 'syntaxes/aspnetmvc5razor.tmLanguage.json')];
    for (const id of ['vscode.csharp', 'vscode.html', 'vscode.javascript', 'vscode.css']) {
        const ext = vscode.extensions.getExtension(id);
        const contributed = ext && ext.packageJSON.contributes && ext.packageJSON.contributes.grammars;
        (contributed || []).forEach(g => grammars.push(readGrammar(ext.extensionPath, g.path)));
    }
    return grammars.filter(Boolean);
}

/** Writes the Visual Studio palette into user tokenColorCustomizations, replacing only our own rules. */
async function applyVisualStudioColours(context, force) {
    const config = vscode.workspace.getConfiguration('aspnetMvc5Razor');
    if (!force && !config.get('visualStudioColors')) {
        return;
    }
    const editor = vscode.workspace.getConfiguration('editor');
    const current = editor.inspect('tokenColorCustomizations').globalValue || {};
    const others = (current.textMateRules || []).filter(r => !isOwnRule(r));
    const ours = buildRules(viewGrammars(context));
    const next = Object.assign({}, current, { textMateRules: others.concat(ours) });
    if (JSON.stringify(next) === JSON.stringify(current)) {
        return;
    }
    await editor.update('tokenColorCustomizations', next, vscode.ConfigurationTarget.Global);
    if (force) {
        vscode.window.showInformationMessage('ASP.NET MVC 5 Razor: Visual Studio colours applied to .cshtml views.');
    }
}

async function removeVisualStudioColours() {
    const editor = vscode.workspace.getConfiguration('editor');
    const current = editor.inspect('tokenColorCustomizations').globalValue || {};
    const rules = (current.textMateRules || []).filter(r => !isOwnRule(r));
    await editor.update('tokenColorCustomizations', Object.assign({}, current, { textMateRules: rules }), vscode.ConfigurationTarget.Global);
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
        vscode.commands.registerCommand('aspnetMvc5Razor.applyVisualStudioColors', () => applyVisualStudioColours(context, true)),
        vscode.commands.registerCommand('aspnetMvc5Razor.removeVisualStudioColors', removeVisualStudioColours),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aspnetMvc5Razor.visualStudioColors')) {
                const on = vscode.workspace.getConfiguration('aspnetMvc5Razor').get('visualStudioColors');
                (on ? applyVisualStudioColours(context, false) : removeVisualStudioColours()).catch(() => undefined);
            }
            if (e.affectsConfiguration('aspnetMvc5Razor')) {
                disposeDecorations();
                decorations = createDecorations();
                vscode.window.visibleTextEditors.forEach(decorate);
            }
        })
    );
    vscode.workspace.textDocuments.forEach(maybeTakeOver);
    vscode.window.visibleTextEditors.forEach(decorate);
    applyVisualStudioColours(context, false).catch(() => undefined);
    discoverRoots().catch(() => undefined);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => discoverRoots().catch(() => undefined)));
}

function deactivate() {
    disposeDecorations();
}

module.exports = { activate, deactivate };

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (`SitefinitySteve.vscode-aspnet-mvc5-razor`) that makes ASP.NET MVC 5 / System.Web.Razor
`.cshtml` views look like they do in Visual Studio 2026 Dark, without a language server. Plain CommonJS, no
build step, no runtime dependencies. The goal of most changes is **parity with Visual Studio**: the user
compares side-by-side screenshots, so "close enough" is judged visually against VS.

## Commands

```bash
npm test                                            # all tests (node:test, auto-discovers test/*.test.js)
node --test test/scanner.test.js                    # one file
node --test --test-name-pattern="helper"            # tests matching a name (do not pass a folder path)
npm run check-views -- C:/GitHub/Medportal/Medportal.Sitefinity   # scan a real MVC 5 codebase for misparses
npm run build-grammar                               # regenerate syntaxes/ from the installed C# extension
npm run package                                     # dist/vscode-aspnet-mvc5-razor.vsix
npm run install-local                               # package + code --install-extension --force
```

After `install-local` the user must run **Developer: Reload Window**; bump the version in `package.json` when
the change should be visibly distinguishable in the Extensions panel.

`check-views` is the regression test that matters most. Expected baseline on Medportal: 666 views, 1 suspect
span (the prose "return to", a known false positive). Any new "markup as code" or "C# as text" hit is a bug.

## Architecture

Colour comes from three independent layers. Most bugs are a question of which layer owns the token.

| Layer | Files | Controls |
|---|---|---|
| TextMate grammar | `syntaxes/` (generated), `language-configuration.json` | token scopes -> foreground colours |
| Token palette | `src/palette.js` -> user `editor.tokenColorCustomizations` | which colour each scope gets |
| Decorations | `src/scanner.js`, `src/semantics.js`, `src/roots.js`, wired in `src/extension.js` | backgrounds, transitions, bold text, member-chain root colours |

- **Grammar is generated, never hand-edited.** `scripts/build-grammar.js` copies the C# extension's
  `aspnetcorerazor` grammar, renames the scope to `text.aspnetmvc5razor`, and applies MVC 5 patches
  (`@helper` directive, `@model`/`@inherits` namespace splitting, an `L:` injection that scopes `Html.X(`
  method names). Change the patch code, then run `npm run build-grammar`.
- **Scanner (`src/scanner.js`)** is a best-effort MVC 5 Razor parser that returns `[start, end)` spans for
  `transitions` (yellow, highlighter style), `code` (grey background, split per line and trimmed like VS) and
  `text` (bold HTML text). Directive keywords in `META_KEYWORDS` (`model`, `helper`, `section`...) plus their
  trailing space are transitions, because Razor 3 emits them as MetaCode. Markup inside C# is detected by
  statement position (`startsStatement`), not by the preceding character. It must never throw.
- **Semantics (`src/semantics.js`)** exists because TextMate scopes `Model`, `Util` and `feed` identically.
  It classifies the root of each member chain: page properties plain, camelCase locals left to the palette
  (light blue), other PascalCase roots teal (static types), and namespace chains plain except the type before
  a call. Namespace roots come from the view's `@using`/`@model` lines plus `src/roots.js`, which scans the
  workspace in the background (`namespace` in `.cs`, `<add namespace>` in `web.config`, NuGet ids).
- **Palette (`src/palette.js`)** generates one rule per concrete scope name found in the installed Razor, C#
  and HTML grammars, each prefixed `text.aspnetmvc5razor `. This is deliberate: themes rank rules by how
  specifically they match the token's own scope before parents, so short rules (`text.aspnetmvc5razor
  storage`) lose to a theme's `storage.type.var`. `extension.js` writes these into the user's global settings
  on activation (setting `aspnetMvc5Razor.visualStudioColors`), replacing only rules where every scope starts
  with `text.aspnetmvc5razor` (`isOwnRule`).
- **Language takeover.** A `.cshtml` opened as `razor`/`aspnetcorerazor`/`html`/`plaintext` is switched to
  `aspnetmvc5razor` once per URI per session (so a manual language pick is respected). The Explorer icon only
  appears with a `files.associations` entry for `aspnetmvc5razor`; the takeover cannot affect unopened files.

### Hard-won constraints

- Transition backgrounds use `textDecoration: 'none; background-color: var(--vscode-...)'`, not
  `backgroundColor`: the latter fills the full line height and merges adjacent lines, VS paints only the text
  cell. Theme colours are contributed in `package.json` `contributes.colors`.
- `language-configuration.json` must not list `<` `>` as brackets (a C# `>` turns red as an unmatched bracket),
  and the grammar contribution must not set `unbalancedBracketScopes` to the root scope (it disables bracket
  colouring for everything outside embedded C#).
- To see what scope VS Code assigns a token, tokenize with `vscode-textmate` + `vscode-oniguruma` loading
  `syntaxes/aspnetmvc5razor.tmLanguage.json` and the built-in `csharp`/`html`/`javascript`/`css` grammars from
  the VS Code install; don't guess scopes from the grammar JSON. After any grammar change, tokenize every view
  of a real codebase too: a bad injection recurses forever and would hang VS Code, and `check-views` (which
  only runs the JS scanner) cannot catch that.
- Razor is injected into `<script>`/`<style>` (`L:source.js, L:source.css`) with a single-match
  `implicit-expression-embedded` rule. Do not inject the Core `#implicit-expression` there: its begin/end region
  recurses infinitely inside embedded JS.
- Grammar scope names can contain capture placeholders (`keyword.type.$1.cs`). `palette.js` expands them from
  the regex alternatives; a placeholder that is skipped means that token silently takes the theme's colour.
- A security hook in this environment rejects any written file containing the RegExp exec method call (it
  mistakes it for `child_process`). Use `String.match` / `matchAll` instead, as the existing code does.

## Conventions

- Braces on every `if`/`else`/loop, body on its own line, even for one-line returns.
- Plain ASCII in code, comments and docs: no em dashes.
- Inline `//` comments state the constraint in 1-3 lines; longer rationale goes in the file header (see
  `scanner.js`, `semantics.js`, `palette.js`).
- Fix a misparse by adding the construct to `test/scanner.test.js` first, then fix, then rerun `check-views`.
- User-visible changes get a `CHANGELOG.md` entry (Keep a Changelog format; the Marketplace shows it).

## Releasing

Follow `RELEASING.md`. Publishing is a **manual VSIX upload** on the Marketplace manage page, not
`vsce publish`: global Azure DevOps PATs retire on 2026-12-01 and the user does not want the Azure CLI. Before
uploading, confirm `Publisher="SitefinitySteve"` and the version inside the VSIX's `extension.vsixmanifest`.
Repo-only files (tests, scripts, plans, screenshots, `RELEASING.md`, this file) are kept out of the VSIX via
`.vscodeignore`.

`plans/` holds design documents, e.g. `plans/language-server-design.md` for a possible Razor 3 + Roslyn
language server (hover, definition, completion, diagnostics) - a design, not implemented code.

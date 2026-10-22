<p align="center">
  <img src="images/icon.png" width="96" alt="">
</p>

<h1 align="center">ASP.NET MVC 5 Razor (.NET Framework)</h1>

<p align="center">
  Visual Studio-style highlighting for <b>ASP.NET MVC 5 / System.Web.Razor</b> <code>.cshtml</code> views in VS Code,<br>
  without the false errors from the ASP.NET Core Razor language server.
</p>

---

## The problem

The C# extension's Razor support only understands **ASP.NET Core** Razor. Open a view from an MVC 5 /
.NET Framework 4.x project and it compiles the view against the wrong page model, so every line goes red
(`CS1025` and friends) even though the view runs fine.

The usual workaround, mapping `*.cshtml` to VS Code's built-in `razor` mode, stops the errors but leaves you
with a very basic grammar and none of the Razor look you get in Visual Studio.

## What this extension does

It adds a dedicated **ASP.NET MVC 5 Razor** language (`aspnetmvc5razor`) for `.cshtml` files:

| | |
|---|---|
| **Full Razor grammar** | The C# extension's Razor TextMate grammar, with C# and HTML embedded, plus MVC 5's `@helper` directive (removed in ASP.NET Core). |
| **Visual Studio's Razor look** | Grey background behind C# code, yellow transitions (`@`, `@(` `)`, `@{` `}`, `@*` `*@`) and bold HTML text. TextMate themes can't paint backgrounds, so these come from a small built-in Razor scanner. |
| **No language server** | Nothing compiles the view, so there are no false errors. |
| **File icon** | A Visual Studio-style `.cshtml` icon instead of the generic HTML one. |
| **Emmet** | HTML abbreviations work in views. |

### What it does not do

No hover, go-to-definition, IntelliSense or real diagnostics inside views. Those need a compiler that
understands `Views/web.config` and `System.Web.Mvc.WebViewPage`, and only Visual Studio's legacy Razor
editor has one. Microsoft has never brought it to VS Code. Your `.cs` files are unaffected and keep full
C# tooling.

Identifier colouring is a heuristic, not binding. TextMate scopes `Model`, `Util` and `feed` identically,
so the extension classifies the root of each member chain itself: Razor page properties (`Model`, `Html`,
`Url`, `ViewBag`...) plain, camelCase locals light blue, and any other PascalCase root (`Util`, `Math`,
`String`, `FormMethod`) as a static type. Namespace roots are learned from the workspace (`namespace` in
`.cs` files, `<add namespace>` in `web.config`, NuGet package ids), so `Medportal.Foo.Bar` and
`ServiceStack.Text.JsonSerializer` read as namespaces, and in `Ns.Type.Method(` only `Type` is a type.

## Install

**From a release:** download `vscode-aspnet-mvc5-razor.vsix` from [Releases](https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/releases), then run `code --install-extension vscode-aspnet-mvc5-razor.vsix` (or Extensions view → `...` → Install from VSIX).

**From source:**

```bash
git clone https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor.git
cd vscode-aspnet-mvc5-razor
npm run install-local
```

`install-local` packages `dist/vscode-aspnet-mvc5-razor.vsix` and installs it with `code --install-extension`.
Requires Node.js and the `code` command on your PATH. Reload VS Code afterwards.

## How `.cshtml` files get this language

For the right **file icon in Explorer** (before a file is opened), associate `.cshtml` with this language. A
workspace association wins over the user one, so put it in the repo:

```jsonc
// .vscode/settings.json
"files.associations": { "*.cshtml": "aspnetmvc5razor" }
```

Without an association, `aspnetMvc5Razor.takeOverCshtml` (on by default) still switches a `.cshtml` that opens
as `razor`, `aspnetcorerazor`, `html` or `plaintext`, once per file per session, so highlighting works either
way; only the Explorer icon needs the association. A language you pick from the status bar is left alone.

## Settings

| Setting | Default | Description |
|---|---|---|
| `aspnetMvc5Razor.takeOverCshtml` | `true` | Switch `.cshtml` files to this language when they open. |
| `aspnetMvc5Razor.boldMarkupText` | `true` | Show HTML text in bold, as Visual Studio does. |
| `aspnetMvc5Razor.visualStudioColors` | `true` | Keep the Visual Studio palette in your user token colours (views only). Off removes it. |
| `aspnetMvc5Razor.namespaceRoots` | `[]` | Extra namespace roots the workspace scan cannot find. |

## Colours

The background colours are theme colours, overridable in `workbench.colorCustomizations`. Dark defaults were
sampled from Visual Studio 2026.

| Colour | Dark | Light |
|---|---|---|
| `aspnetMvc5Razor.codeBackground` | `#464646` | `#F4F4F4` |
| `aspnetMvc5Razor.transitionBackground` | `#D0D294` | `#FFFF96` |
| `aspnetMvc5Razor.transitionForeground` | `#000000` | `#000000` |
| `aspnetMvc5Razor.staticType` | `#4EC9B0` | `#2B91AF` |
| `aspnetMvc5Razor.plainIdentifier` | `#DCDCDC` | `#000000` |

Token colours (keywords, strings, types...) are written for you. On start the extension generates Visual
Studio 2026 Dark rules from the installed Razor, C# and HTML grammars, one per concrete scope and every one
scoped to `text.aspnetmvc5razor`, and keeps them in your user `editor.tokenColorCustomizations`. Nothing
outside `.cshtml` views changes, and other rules you have there are left alone.

Why one rule per scope: themes rank a rule by how specifically it matches the token's own scope before
looking at parents, so a short `text.aspnetmvc5razor storage` loses to a theme's `storage.type.var`.
Matching the full scope name ties on specificity, and the `text.aspnetmvc5razor` parent then wins.

Commands: **ASP.NET MVC 5 Razor: Apply Visual Studio Colours** and **Remove Visual Studio Colours**.

## How it works

```
.cshtml ──► TextMate grammar (syntaxes/)     ──► token colours (your theme)
        └─► Razor scanner (src/scanner.js)   ──► decorations: code background, transitions, bold text
```

`src/semantics.js` classifies member-chain roots (see above), `src/roots.js` learns namespace roots, and
`src/palette.js` builds the token colour rules.

`src/scanner.js` is a best-effort parser of MVC 5's rules for where C# starts and ends: implicit and explicit
expressions, code blocks, `if`/`else`/`foreach`/`using`/`try` and friends, `@functions`, `@helper`,
`@section`, `@:` and markup nested inside C#. It is not the Razor compiler: on malformed input it never throws,
it just stops colouring. A large view scans in about 2 ms, and decorations refresh 120 ms after you stop typing.

## Development

| Command | |
|---|---|
| `npm test` | Scanner unit tests (`node:test`, no dependencies) |
| `npm run check-views -- <folder>` | Scan every `.cshtml` in a codebase and list likely misparses |
| `npm run build-grammar` | Regenerate `syntaxes/` from the installed C# extension's Razor grammar |
| `npm run package` | Build `dist/vscode-aspnet-mvc5-razor.vsix` |
| `npm run install-local` | Package and install into VS Code |

When a view highlights wrongly, reproduce the construct in `test/scanner.test.js` first, then fix the scanner,
then run `check-views` against a real codebase to make sure nothing else moved.

## Credits

The grammar is generated from the Razor grammar in the C# extension
([dotnet/vscode-csharp](https://github.com/dotnet/vscode-csharp)), which comes from
[dotnet/razor](https://github.com/dotnet/razor). Both are MIT-licensed.

## License

[MIT](LICENSE)

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

Type colouring is also approximate. Visual Studio knows `Util` is a class and `Model` is a property because
it compiles the view; a grammar can only guess from position.

## Install

There is no Marketplace release yet. Build and install the VSIX:

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

## Colours

The background colours are theme colours, overridable in `workbench.colorCustomizations`. Dark defaults were
sampled from Visual Studio 2026.

| Colour | Dark | Light |
|---|---|---|
| `aspnetMvc5Razor.codeBackground` | `#464646` | `#F4F4F4` |
| `aspnetMvc5Razor.transitionBackground` | `#D0D294` | `#FFFF96` |
| `aspnetMvc5Razor.transitionForeground` | `#000000` | `#000000` |

Token colours come from your theme, which can differ a lot from Visual Studio (some themes colour method
calls purple, attribute values orange). To pin Visual Studio 2026 Dark inside views only, add this to your user
settings. Every rule is scoped to `text.aspnetmvc5razor`, so nothing else in VS Code changes:

```jsonc
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": ["text.aspnetmvc5razor", "text.aspnetmvc5razor variable", "text.aspnetmvc5razor variable.other.object.property.cs", "text.aspnetmvc5razor entity.name.type.namespace.cs"], "settings": { "foreground": "#DCDCDC" } },
    { "scope": ["text.aspnetmvc5razor entity.name.variable", "text.aspnetmvc5razor variable.parameter"], "settings": { "foreground": "#9CDCFE" } },
    { "scope": ["text.aspnetmvc5razor keyword", "text.aspnetmvc5razor storage", "text.aspnetmvc5razor constant.language", "text.aspnetmvc5razor keyword.operator.expression"], "settings": { "foreground": "#569CD6" } },
    { "scope": ["text.aspnetmvc5razor keyword.operator"], "settings": { "foreground": "#B4B4B4" } },
    { "scope": ["text.aspnetmvc5razor keyword.control"], "settings": { "foreground": "#D8A0DF" } },
    { "scope": ["text.aspnetmvc5razor keyword.control.razor.directive", "text.aspnetmvc5razor keyword.other.using.cs"], "settings": { "foreground": "#569CD6" } },
    { "scope": ["text.aspnetmvc5razor keyword.control.razor.directive.model", "text.aspnetmvc5razor keyword.control.razor.directive.functions", "text.aspnetmvc5razor keyword.control.razor.directive.helper", "text.aspnetmvc5razor keyword.control.razor.directive.inherits", "text.aspnetmvc5razor keyword.control.razor.directive.section"], "settings": { "foreground": "#DCDCDC" } },
    { "scope": ["text.aspnetmvc5razor entity.name.function"], "settings": { "foreground": "#DCDCAA" } },
    { "scope": ["text.aspnetmvc5razor entity.name.function.htmlhelper.razor"], "settings": { "foreground": "#DCDCDC" } },
    { "scope": ["text.aspnetmvc5razor entity.name.type"], "settings": { "foreground": "#4EC9B0" } },
    { "scope": ["text.aspnetmvc5razor entity.name.type.namespace.cs"], "settings": { "foreground": "#DCDCDC" } },
    { "scope": ["text.aspnetmvc5razor constant.numeric"], "settings": { "foreground": "#B5CEA8" } },
    { "scope": ["text.aspnetmvc5razor string.quoted.double.cs", "text.aspnetmvc5razor string.quoted.single.cs", "text.aspnetmvc5razor punctuation.definition.string.begin.cs", "text.aspnetmvc5razor punctuation.definition.string.end.cs"], "settings": { "foreground": "#D69D85" } },
    { "scope": ["text.aspnetmvc5razor comment", "text.aspnetmvc5razor comment.block.razor"], "settings": { "foreground": "#57A64A" } },
    { "scope": ["text.aspnetmvc5razor punctuation.definition.tag"], "settings": { "foreground": "#808080" } },
    { "scope": ["text.aspnetmvc5razor entity.name.tag"], "settings": { "foreground": "#569CD6" } },
    { "scope": ["text.aspnetmvc5razor entity.other.attribute-name"], "settings": { "foreground": "#9CDCFE" } },
    { "scope": ["text.aspnetmvc5razor string.quoted.double.html", "text.aspnetmvc5razor string.quoted.single.html"], "settings": { "foreground": "#C8C8C8" } },
    { "scope": ["text.aspnetmvc5razor constant.character.entity"], "settings": { "foreground": "#1A9A98" } }
  ]
}
```

## How it works

```
.cshtml ──► TextMate grammar (syntaxes/)     ──► token colours (your theme)
        └─► Razor scanner (src/scanner.js)   ──► decorations: code background, transitions, bold text
```

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

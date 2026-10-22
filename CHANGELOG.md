# Changelog

All notable changes to this extension. Versions follow [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-22

### Added
- **Razor inside `<script>` and `<style>`.** `@Model.X`, `@Html.Raw(...)`, `'@Url.Action(...)'` inside a JS
  string, `@if (...) { <text>...</text> }` and `@* comments *@` are now recognised in inline JavaScript and
  CSS. Before, they were coloured as JavaScript (a `@*` comment read as a decorator and a multiplication).
- Visual Studio colours for inline CSS (gold selectors, light-blue property names) and JavaScript.

### Fixed
- C# type keywords (`string`, `long`, `int`, `bool`, `object`...) and modifiers (`public`, `static`...) could
  take the colour theme's colour, for example red casts like `(string)item.Title`. Their grammar scope names
  use capture placeholders (`keyword.type.$1.cs`), which the palette now expands into concrete rules.

## [0.3.1] - 2026-10-22

### Fixed
- Bracket-pair colours inside Razor code (`@foreach (...)`, `@if (...)`, LINQ chains in code blocks). The
  grammar contribution marked the view's root scope as "unbalanced", which made VS Code ignore every bracket
  outside an embedded C# region.

## [0.3.0] - 2026-10-22

### Added
- **Static-class colouring.** The root of each member chain is classified the way Visual Studio colours it:
  Razor page properties (`Model`, `Html`, `Url`, `ViewBag`...) plain, camelCase locals and parameters light
  blue, PascalCase roots (`Util`, `Math`, `String`, `FormMethod`) as types.
- **Workspace namespace discovery.** Namespace roots are learned in the background from `namespace` declarations
  in `.cs` files, `<add namespace>` in `web.config` and NuGet package ids, so `Medportal.Foo.Bar` and
  `ServiceStack.Text.JsonSerializer` read as namespaces. In `Ns.Type.Method(`, only `Type` is coloured as a type.
- `aspnetMvc5Razor.namespaceRoots` setting for roots the scan cannot find.
- **Apply / Remove Visual Studio Colours** commands and the `aspnetMvc5Razor.visualStudioColors` setting.

### Fixed
- Colour themes no longer override the palette (for example `var` and `if` showing red). Rules are now
  generated per concrete scope from the installed grammars, which outranks a theme's specific rules.

## [0.2.0] - 2026-10-22

### Added
- `@model`, `@inherits`, `@helper`, `@section`, `@functions` and `@layout` keywords, with their trailing space,
  are painted like a transition (Razor 3 MetaCode), as in Visual Studio.
- `Html.X(` method names render plain, as Visual Studio shows HtmlHelper calls.
- Full Visual Studio 2026 Dark palette documented in the README.

### Fixed
- Bracket-pair colouring restored after the 0.1.x `>` fix had switched it off.

## [0.1.x] - 2026-10-22

### Added
- Transitions are painted like a highlighter (text-cell height only), matching Visual Studio.
- `@model` / `@inherits`: namespace segments scoped as namespaces and only the last segment as the type.
- README guidance for the Explorer file icon, which needs a `files.associations` entry.

### Fixed
- A C# `>` (for example `Count() > 0`) no longer shows red as an unmatched bracket.

## [0.1.0] - 2026-10-22

### Added
- Initial release: a dedicated **ASP.NET MVC 5 Razor** language for `.cshtml` files, with the C# extension's
  Razor grammar plus MVC 5's `@helper` directive, and no language server (so no false ASP.NET Core errors).
- Visual Studio-style decorations: grey code background, yellow transitions (`@`, `@(` `)`, `@{` `}`, `@*` `*@`)
  and bold HTML text.
- Takes over `.cshtml` files opened as `razor` / `aspnetcorerazor` / `html` / `plaintext`.
- Visual Studio-style file icon, Emmet support.

[0.4.0]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/releases/tag/v0.4.0
[0.3.1]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/releases/tag/v0.3.1
[0.3.0]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/compare/571f266...00ea7b8
[0.2.0]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/compare/26f3df7...571f266
[0.1.x]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/compare/50d3550...26f3df7
[0.1.0]: https://github.com/sitefinitysteve/vscode-aspnet-mvc5-razor/commit/50d3550

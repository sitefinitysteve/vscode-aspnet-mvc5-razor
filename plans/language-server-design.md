# Language server design: real IntelliSense for ASP.NET MVC 5 Razor views in VS Code

Status: design, nothing built. Written 2026-10-22 against extension v0.3.1. Reviewed the same day:
Medportal facts spot-checked (web.config Razor section, no `Views/web.config`, `System.Linq.Async`
remove, `/langversion:7.3`, `ChangelogWidgetModel.Heading`); corrected the bin size (350 DLLs, not
654) and the HTML IntelliSense claims.

The extension today is highlighting-only (TextMate grammar + the JS scanner in `src/scanner.js`
driving decorations, the camelCase/PascalCase heuristic in `src/semantics.js`, namespace-root
discovery in `src/roots.js`, the VS 2026 Dark palette in `src/palette.js`). This document designs
the piece that is missing: a language server that compiles each `.cshtml` the way `System.Web.Razor`
+ `System.Web.Mvc` do at runtime, and answers hover / definition / completion / diagnostics from a
real Roslyn compilation.

Facts marked "(verified)" were checked against sources cited inline or against a real MVC 5 site
(`C:\GitHub\Medportal\Medportal.Sitefinity`, Sitefinity 15.4 on .NET 4.8, read-only). Facts marked
"(unverified)" are stated as assumptions and get a spike in section 8.

## 1. Goal and non-goals

Goal: open a `.cshtml` from an MVC 5 / .NET Framework site in VS Code and get, with Visual Studio
fidelity for C# inside the view:

- diagnostics (only real ones, no CS1025 noise),
- hover with the symbol signature and XML doc,
- go to definition into the site's own `.cs` files,
- completion for members, locals, `Html.` helpers, the `@model` type,
- optionally semantic tokens so the colouring stops being a guess.

Non-goals:

- Replacing the JS highlighting. The grammar, scanner decorations and palette stay exactly as they
  are and keep working when the server is absent, disabled or crashed. The server only adds
  language features; it never paints.
- Cross-platform. The server is a Windows-only .NET Framework 4.8 exe. MVC 5 sites are built and run
  on Windows; `System.Web` does not exist elsewhere. The untargeted VSIX stays highlighting-only on
  macOS / Linux.
- HTML / CSS / JS IntelliSense inside the view. Today views get HTML colouring (embedded grammar)
  and Emmet, but not HTML completion: VS Code registers those providers on the `html` language id,
  not on embedded scopes. The server leaves HTML regions alone; HTML completion would be a separate
  piece (request forwarding to a virtual HTML document, as the Core Razor extension does).
- Loading the solution through MSBuild. See the OmniSharp failure in section 4; references come from
  the site's compiled `bin`.
- Razor Pages, Blazor, ASP.NET Core Razor. Those have Microsoft's own server.
- Editing `.cs` files. The C# extension keeps owning them.

## 2. Architecture

```
 VS Code (extension host, JS)                                   Windows only, .NET Framework 4.8
+--------------------------------------------+   stdio/LSP   +------------------------------------+
| src/extension.js                           |<------------->| server/Mvc5RazorServer.exe         |
|  - grammar + decorations (unchanged)       |               |  LSP layer                         |
|  - vscode-languageclient 11.x              |               |   OmniSharp.Extensions.LanguageSrv |
|    documentSelector: aspnetmvc5razor       |               |   (or StreamJsonRpc, see 6.3)      |
|    serverOptions: { command: exe, stdio }  |               |  SiteModel (per web.config root)   |
|  - server download/health UI               |               |   - WebConfigReader                |
|  - semantics.js stays as fallback when     |               |   - ReferenceSet (bin + framework) |
|    the server reports no semantic tokens   |               |   - RoslynProject (AdhocWorkspace) |
+--------------------------------------------+               |  ViewDocument (per open .cshtml)   |
                                                             |   - RazorCodeGen (design-time)     |
                                                             |   - SpanMap (view <-> C#)          |
                                                             |   - Roslyn Document                |
                                                             |  Features: diagnostics, hover,     |
                                                             |   definition, completion, tokens   |
                                                             |  SourceIndex (workspace .cs types) |
                                                             +------------------------------------+
         ^                                                                      ^
         | file events (textDocument/didChange,                                 | reads
         | workspace/didChangeWatchedFiles for bin/*.dll, web.config)           v
                                                              site folder: web.config, Views/**,
                                                              bin/*.dll, *.cs (for definition)
```

Process boundary: one server process per VS Code window, started lazily on the first
`aspnetmvc5razor` document, killed on deactivate. The server owns everything that needs .NET
(Razor codegen, Roslyn); the extension owns everything that needs the VS Code API (decorations,
settings, commands, progress UI). The two never share state outside LSP messages.

LSP messages used:

| Direction | Message | Use |
|---|---|---|
| client -> server | `initialize` / `initialized` | capabilities, workspace folders, settings (`binPath`, `enabled`, `semanticTokens`) |
| client -> server | `textDocument/didOpen` / `didChange` / `didClose` | full-text sync (`TextDocumentSyncKind.Full`; views are small and regeneration is whole-file anyway) |
| client -> server | `workspace/didChangeWatchedFiles` | `**/bin/*.dll`, `**/web.config`, `**/App_Code/**/*.cshtml`, `**/*.cs` (for the source index) |
| client -> server | `workspace/didChangeConfiguration` | settings changes |
| server -> client | `textDocument/publishDiagnostics` | push model; simpler than pull and fine at this scale |
| client -> server | `textDocument/hover`, `definition`, `completion`, `completionItem/resolve` | Phase 1-2 |
| client -> server | `textDocument/semanticTokens/full` (+ `/range`) | Phase 3 |
| server -> client | `window/showMessage`, `window/logMessage`, `$/progress` | "bin not found", "loading 350 references" |
| custom | `mvc5razor/showGeneratedCode` | debugging aid: returns the generated C# for the active view (like the C# extension's "Razor: Show Razor CSharp") |

Component responsibilities:

- `WebConfigReader`: finds the site root (nearest ancestor with a `web.config` containing
  `<system.web.webPages.razor>` or `<system.web>`), reads `pageBaseType`, `<namespaces>`,
  `<host factoryType>`, `<compilation><assemblies>` add/remove, `system.codedom` `/langversion`.
  Applies the ASP.NET inheritance order (root first, then each `web.config` down to the view's folder).
- `ReferenceSet`: builds the `MetadataReference` list once per site and shares it across views.
- `RazorCodeGen`: `.cshtml` text -> generated C# text + `SpanMap`, using the Razor v3 engine in
  design-time mode.
- `RoslynProject`: one `AdhocWorkspace` project per site; one `Document` per open view (+ App_Code
  helper documents). Views never reference each other in MVC 5 (sections, layouts and `RenderBody`
  are untyped), so no cross-view analysis is needed; each document is independent.
- `SourceIndex`: workspace `.cs` files parsed once with Roslyn's syntax parser into a
  `fully-qualified type name -> (file, span)` map for go-to-definition.
- Feature handlers: thin, each one is "map position, ask Roslyn, map result back".

## 3. The view -> C# pipeline

### 3.1 Host configuration from web.config

The real runtime path is `WebRazorHostFactory.CreateHostFromConfig(virtualPath)`, which calls
`WebConfigurationManager.GetSection("system.web.webPages.razor/host", virtualPath)` and the same for
`pages` (verified: https://github.com/aspnet/AspNetWebStack/blob/main/src/System.Web.WebPages.Razor/WebRazorHostFactory.cs).
Outside IIS `HostingEnvironment.IsHosted` is false and `WebConfigurationManager.GetSection` falls
back to the process's own config, so that overload is useless to us. The factory has an overload
that takes the section group directly, `CreateHostFromConfig(RazorWebSectionGroup config, string
virtualPath, string physicalPath)` (verified, same file), and `EnsureAppRelative` only prefixes
`~/` when not hosted, so the host itself is usable outside ASP.NET.

Two ways to get a `RazorWebSectionGroup`:

1. `WebConfigurationManager.OpenMappedWebConfiguration(fileMap, "/")` with a
   `WebConfigurationFileMap` pointing at the site. Parses the whole `web.config` through
   `System.Configuration`, including `<configSections>` whose handler types (Sitefinity, Telerik,
   EF, ServiceStack) are not loadable in our process. Section-type resolution is lazy, so it may
   work, but a 1,200-line enterprise `web.config` is exactly where it will not. Rejected as the
   primary path; keep as an experiment in the spike.
2. Parse the XML ourselves with `XDocument` and mirror `WebRazorHostFactory.ApplyConfigurationToHost`:
   set `host.DefaultPageBaseClass = pages@pageBaseType`, add each `<namespaces><add namespace>` via
   `host.NamespaceImports.Add`, honour `<clear/>` and `<remove>`. This is the chosen path. It reads
   only what we need and cannot be broken by an unrelated section.

Concrete values from the sample site (verified by reading
`C:\GitHub\Medportal\Medportal.Sitefinity\web.config` lines 104-114):

```xml
<system.web.webPages.razor>
  <host factoryType="System.Web.Mvc.MvcWebRazorHostFactory, System.Web.Mvc, Version=5.0.0.0, ..." />
  <pages pageBaseType="System.Web.Mvc.WebViewPage">
    <namespaces>
      <add namespace="System.Web.Mvc" /> ... System.Web.Mvc.Ajax, System.Web.Mvc.Html, System.Web.Routing
```

Notable: this site has NO `Views/web.config` at all (verified, `find` over the whole site returns
only the root and `Files/web.config`); the Razor section lives in the root `web.config`. A standard
MVC 5 template puts it in `Views/web.config` instead. The reader must therefore walk from the
view's folder up to the site root and merge every `web.config` it meets, root first, nearer ones
overriding `pageBaseType` and appending namespaces. Both layouts come out right.

Host selection from `factoryType`:
- `System.Web.Mvc.MvcWebRazorHostFactory` (or absent while `System.Web.Mvc.dll` is in bin) ->
  `new MvcWebPageRazorHost(virtualPath, physicalPath)`.
- absent and no MVC -> `WebPageRazorHost` (plain WebPages site).
- anything else (a custom factory in the site's own assembly) -> fall back to the MVC host and emit
  one warning diagnostic on line 1. Loading arbitrary site code into the server is out of scope.

`MvcWebPageRazorHost` (verified: https://github.com/aspnet/AspNetWebStack/blob/main/src/System.Web.Mvc/Razor/MvcWebPageRazorHost.cs)
sets `DefaultPageBaseClass = typeof(WebViewPage).FullName`, registers `_ViewStart` as
`ViewStartPage`, removes the `System.Web.WebPages.Html` import, and swaps in
`MvcCSharpRazorCodeParser` (which implements `@model`) and `MvcCSharpRazorCodeGenerator`. It has no
`HttpContext` / `HostingEnvironment` dependency of its own. Its base `WebPageRazorHost` touches
`HostingEnvironment.IsHosted` only in `GlobalAsaxTypeName` (falls back to `System.Web.HttpApplication`
when not hosted) and `MapPhysicalPath` (verified: .../System.Web.WebPages.Razor/WebPageRazorHost.cs).
Both are safe outside IIS. Set `host.EnableInstrumentation = false` explicitly.

Other host settings:
- `host.DesignTimeMode = true` (section 3.3).
- `host.DefaultClassName` is derived from the virtual path (`_Page_Views_Home_Index_cshtml`), which
  is also what `GetClassName` produces at runtime; keep it so error text matches VS.
- Virtual path = view path relative to the site root with `~/` prefix; physical path = the file.

### 3.2 Generation

```csharp
var host = new MvcWebPageRazorHost(virtualPath, physicalPath) { DesignTimeMode = true, EnableInstrumentation = false };
ApplyWebConfig(host, mergedConfig);                              // 3.1
var engine = new RazorTemplateEngine(host);
GeneratorResults results = engine.GenerateCode(new StringReader(viewText),
    className: null, rootNamespace: null, sourceFileName: physicalPath);   // nulls = host defaults
// results.Success, results.ParserErrors (RazorError: Location, Length, Message)
// results.GeneratedCode : CodeCompileUnit
// results.DesignTimeLineMappings : IDictionary<int, GeneratedCodeMapping>
```

(signatures verified: https://github.com/aspnet/AspNetWebStack/blob/main/src/System.Web.Razor/RazorTemplateEngine.cs;
`DesignTimeLineMappings` is only populated when `Host.DesignTimeMode` is true.)

The output is CodeDOM, so it is rendered to text with the framework's own
`Microsoft.CSharp.CSharpCodeProvider` (`GenerateCodeFromCompileUnit`, `System.CodeDom` in .NET 4.8,
no Roslyn involved). Use `BracingStyle = "C"`, `IndentString = "    "`. The renderer is deterministic,
which matters because the span map is computed against the rendered text.

Razor parser errors (`results.ParserErrors`) become diagnostics directly: their `SourceLocation`
is already in view coordinates. Example: an unterminated `@{`.

### 3.3 Design-time mode: what it changes and why it is the right mode

This is what Visual Studio's legacy Razor editor used, and the differences versus runtime mode are
exactly what an editor wants (all verified in the Razor generator sources,
https://github.com/aspnet/AspNetWebStack/tree/main/src/System.Web.Razor/Generator):

- Markup emits nothing. `MarkupCodeGenerator` only emits `WriteLiteral(...)` when
  `!context.Host.DesignTimeMode`. The generated class therefore contains only the C# the author
  wrote, which keeps it small and keeps every C# error attributable to a span the author typed.
- Implicit and explicit expressions become assignments to a private static `object __o` field:
  `__o = Model.Heading;` instead of `Write(Model.Heading);` (`ExpressionCodeGenerator`:
  `context.EnsureExpressionHelperVariable(); cw.WriteStartAssignment("__o")`). So `@Model.Foo.` with
  a trailing dot generates `__o = Model.Foo.;`, which Roslyn parses as an incomplete member access
  and completes normally. This is the standard IDE trick and the reason completion works mid-typing.
- Directive spans (`@model`, `@inherits`, `@using`) are mapped through a generated private method
  `__RazorDesignTimeHelpers__` (`CodeGeneratorContext.AddDesignTimeHelperStatement`), so hover and
  definition on the `@model` type work too.
- Line pragmas carry a mapping id instead of a line number: in design-time mode
  `GenerateLinePragma` calls `AddCodeMapping(start, generatedCodeStart, codeLength)` and returns
  `new CodeLinePragma(SourceFile, mappingId)`. The ids start at 1 and index
  `DesignTimeLineMappings`. In runtime mode the pragma holds `start.LineIndex + 1` and no mappings
  are recorded.

`GeneratedCodeMapping` (verified: .../Generator/GeneratedCodeMapping.cs and CodeGeneratorContext.cs)
has `StartLine`, `StartColumn`, `StartGeneratedColumn`, `CodeLength`, `StartOffset`. `AddCodeMapping`
stores `LineIndex + 1`, `CharacterIndex + 1`, `generatedCodeStart + 1`, so the stored values are
1-based; `StartOffset` is the raw 0-based absolute index into the view. (`SourceLocation.LineIndex`
carries a comment saying 1-based while `SourceLocation.Zero` is `(0,0,0)`; the generator code adds 1,
so treat `SourceLocation` as 0-based and the mapping as 1-based. Spike item S2 confirms with a real
view.)

### 3.4 Position mapping

The `#line <id> "<file>"` pragma that precedes each mapped statement is the anchor. Procedure:

1. Render the CodeDOM to text.
2. Scan the text line by line. On a line matching `#line (\d+) "..."`, look up mapping `id`. The
   mapped generated code starts on the NEXT line at column `StartGeneratedColumn` (1-based) and runs
   for `CodeLength` characters (it can span lines; the code is copied verbatim, so the length is
   identical on both sides). The view side starts at (`StartLine`, `StartColumn`) or, simpler and
   exact, at absolute offset `StartOffset`.
3. Record `Span { ViewStart = StartOffset, GenStart = <generated absolute offset>, Length = CodeLength }`.
4. Replace every `#line` line (and `#line default` / `#line hidden`) with an empty line so Roslyn's
   own line numbers are plain text lines and the `#line` directives cannot confuse diagnostics. Line
   count is preserved, so step 2's offsets stay valid.

Mapping is then a constant offset inside a span: `gen = GenStart + (view - ViewStart)` when the view
position falls inside `[ViewStart, ViewStart + Length]`, and back the same way. Positions in markup map
to nothing (hover returns null, completion falls through to HTML). Results from Roslyn that fall in
unmapped generated code (the `__o` field, the class header, `__RazorDesignTimeHelpers__` scaffolding)
are dropped, except diagnostics, which are reported once at line 1 with a `[generated]` prefix so a
real problem is never silently lost.

Explicitly NOT using runtime `#line N` pragmas: they map lines only, not columns, and they are
absent for the expression bodies we care most about. The design-time dictionary gives
column-accurate, length-bounded spans, which is what VS used.

### 3.5 What `@model` generates

`MvcCSharpRazorCodeParser` maps `model` to `SetModelTypeCodeGenerator(model, "{0}<{1}>")`, i.e. the
base class becomes `<pageBaseType><ModelType>` = `System.Web.Mvc.WebViewPage<Medportal...Model>`;
it also reports `MvcRazorCodeParser_CannotHaveModelAndInheritsKeyword` if both appear (verified:
.../System.Web.Mvc/Razor/MvcCSharpRazorCodeParser.cs). The sample site uses `@model` in 448 of 532
views and `@inherits` in none, `@helper` in 28, `@functions` in 2 (verified by grep).

`@helper Name(args) { ... }` becomes a `public static System.Web.WebPages.HelperResult Name(args)`
method on the generated class with the body's code and markup inside a `new HelperResult(__razor_helper_writer => { ... })`
lambda. In design-time mode the markup inside is omitted and the C# inside is mapped like any other
block, so locals in a helper body get hover/completion.

### 3.6 Language version

The site's `system.codedom` compiler line says `/langversion:7.3` (verified, web.config line 1188).
Parse the generated document with `CSharpParseOptions(LanguageVersion.CSharp7_3)` when that option
is present, else `LanguageVersion.Default`. Without this, Roslyn 5.x would accept C# 14 syntax that
the site's compiler rejects at runtime.

## 4. Reference resolution

### 4.1 Sources, in order

1. `bin\*.dll` of the site root. ASP.NET's own rule is "everything in bin is referenced", and the
   `<compilation><assemblies>` element adds GAC assemblies and can `<remove>` one. The sample site
   does both: it adds `System.ServiceModel`, `netstandard`, `Telerik.OpenAccess` and REMOVES
   `System.Linq.Async` with a comment explaining why views must not see it (verified, web.config
   line 209). The server honours `add`/`remove`/`clear` exactly, because that `remove` is the
   difference between a clean view and an ambiguous-call error on every `.Where(`.
2. .NET Framework assemblies. Resolve each `<add assembly="Name, Version=4.0.0.0, ...">` and the
   implicit defaults (`mscorlib`, `System`, `System.Core`, `System.Web`, `System.Xml`,
   `System.Configuration`, `System.Data`, `System.Web.Extensions`, `System.Runtime`, `netstandard`,
   `Microsoft.CSharp`, `System.Drawing`, `System.Web.Services`, `System.EnterpriseServices`) from,
   in order of preference:
   - `%ProgramFiles(x86)%\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8` if present
     (it is on a dev box with VS; verified present here, v4.8 and v4.8.1),
   - else the `Microsoft.NETFramework.ReferenceAssemblies.net48` NuGet layout if the extension
     downloaded it (41 MB of DLLs, verified from the 1.0.3 package in the local cache; MIT, see 7),
   - else the running framework's implementation assemblies in
     `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319` (278 DLLs, always present when .NET 4.8 is
     installed, which the server itself requires). Implementation assemblies work as metadata
     references; they just expose a few internals-as-public differences. This is the no-download
     default and what the Phase 0 spike uses.
   Bin wins over framework on a name clash (same as ASP.NET's probing), with `netstandard.dll` and
   facade assemblies deduplicated by assembly identity.
3. Nothing else. No `packages\` folder walk, no csproj, no MSBuild. The csproj's HintPaths only tell
   you what was copied to bin, and bin is ground truth for what the view compiles against at runtime.

Why not MSBuild: OmniSharp 1.39.14 on this machine dies loading VS 2026 MSBuild (18.10 / 18.12)
with `MissingMethodException: FrozenSet.Create(IEqualityComparer, ReadOnlySpan)` because it ships
`System.Collections.Immutable` 9.0 while MSBuild 18 needs 10.0. Any in-process MSBuild evaluation
inherits the VS install's assembly graph and breaks whenever VS moves. Reading bin inherits nothing.

### 4.2 Building the Roslyn project

```csharp
var host = MefHostServices.Create(MefHostServices.DefaultAssemblies);   // Workspaces only; no Features needed in Phase 1
var ws = new AdhocWorkspace(host);
var refs = referenceSet.Metadata;  // ImmutableArray<MetadataReference>, built once per site, each via MetadataReference.CreateFromFile(path, documentation: XmlDocumentationProvider.CreateFromFile(xml) when the .xml exists)
var project = ws.AddProject(ProjectInfo.Create(id, VersionStamp.Create(), siteName, siteName, LanguageNames.CSharp,
    compilationOptions: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, nullableContextOptions: NullableContextOptions.Disable),
    parseOptions: new CSharpParseOptions(langVersion),
    metadataReferences: refs));
```

One project per site, one `Document` per open view. Roslyn shares the assembly symbols for identical
`MetadataReference` instances across the project's compilations, so the 350-DLL load happens once and
each view's compilation is cheap. The sample site's bin is 350 DLLs (654 files including `.xml`/`.pdb`, 575 MB; verified); the XML doc
files next to the DLLs (`System.Web.Mvc.xml`, `Medportal.*.xml` where present) feed hover docs.

Memory expectation (unverified, spike S3): 300-600 MB working set for a bin of that size. That is in
line with what OmniSharp used for the same solution and acceptable for a dev box; the server exits
with the window.

### 4.3 App_Code, `_ViewStart`, layouts, `@helper`

- `App_Code\*.cshtml` (shared `@helper` files, MVC 5 feature): generated with `WebCodeRazorHost`
  (static class named after the file, same design-time rules) and added as extra documents to the
  site project, regenerated on change. The sample site has no App_Code (verified). Phase 3.
- `_ViewStart.cshtml`: generated as a normal document with base class `ViewStartPage` (the host does
  this via `RegisterSpecialFile`). It gets the same features. Nothing flows from `_ViewStart` into
  other views at the type level, so no cross-document work.
- Layouts, sections, `RenderBody`, `ViewBag`: all dynamic / untyped in MVC 5. A view does not know its
  layout's type, so there is nothing to resolve across files. This is simpler than ASP.NET Core Razor
  and is why one-document-at-a-time is correct here.
- Local `@helper` and `@functions`: members of the view's own generated class, handled by codegen.
- Precompiled view assemblies (RazorGenerator.Mvc): the sample site ships
  `Medportal.Sitefinity.ResourcePackages.Medportal.dll` built by `RazorGenerator.MsBuild` 2.4.1
  (verified in `packages.config`). Those classes sit in bin and are referenced like anything else;
  they do not interfere because each open view is its own class in its own document.

### 4.4 Stale or missing bin

- Missing bin (fresh clone): the site project is created with framework references only. Every
  `@model` type and site helper is unresolved; rather than drown the view in red, the server
  reports ONE information diagnostic on line 1 ("bin folder not found at <path>; build the site for
  full IntelliSense") and downgrades every `CS0246`/`CS0234`/`CS0103`/`CS1061` in that site to
  `Hint` severity until a bin appears. BCL hover/completion still works.
- Stale bin (a `.cs` changed, site not rebuilt): errors are real relative to what will run, which is
  what VS also shows until you build. No special handling beyond the file watcher.
- Partial bin (a DLL locked or half-written during `bun run build`): `MetadataReference.CreateFromFile`
  reads lazily; a truncated file surfaces as a `BadImageFormatException` at first use. Catch per
  reference, drop that reference, log, and retry on the next watcher event.

### 4.5 File watching and incremental updates

- `bin/*.dll`, `bin/*.xml`: debounce 1.5 s (a site build touches hundreds of files), then rebuild
  `ReferenceSet` and swap project references via `Solution.WithProjectMetadataReferences`. Open views
  get re-diagnosed.
- `web.config` (any level inside the site): drop and rebuild the `SiteModel` for that root.
- `.cshtml` didChange: regenerate that document only (Razor parse ~1-5 ms for a 500-line view;
  CodeDOM render ~ms; `Document.WithText`; diagnostics debounced 300 ms after the last change).
- `.cs` create/change/delete: update the `SourceIndex` entry for that file (section 5.3).

### 4.6 Caching

- `ReferenceSet` per site root, keyed by path, rebuilt on watcher events only.
- Generated text + `SpanMap` per document version; a request for a stale version is answered against
  the latest and the client reconciles (standard LSP behaviour).
- `SourceIndex` persisted to `%LOCALAPPDATA%\vscode-aspnet-mvc5-razor\index\<hash-of-root>.json` with
  file mtimes so a second start of a 3,000-file workspace is instant. Phase 2.
- No on-disk compilation cache; Roslyn metadata loading is already memory-mapped and fast enough
  (spike S3 measures it).

## 5. LSP features

Fidelity statements compare with Visual Studio's legacy Razor editor on the same view.

### 5.1 Diagnostics (Phase 1)

Sources: Razor parser errors (view coordinates, as-is) + Roslyn `Compilation.GetDiagnostics()` for
the document's syntax tree, filtered to mapped spans and mapped back. Suppressions copied from the
site's compiler line (`/nowarn:1659;1699;1701;612;618` on the sample site) and the standard
view-noise set VS also hides (`CS0219` unused `__o`-style locals in helpers, `CS1702`, `CS1701`).
Severity map: Razor errors -> Error; Roslyn Error -> Error; Warning -> Warning; Hidden -> dropped.
Fidelity: equal to VS for C# inside the view; HTML problems are not reported (VS reported few).

### 5.2 Hover (Phase 1)

Map position -> `SemanticModel.GetSymbolInfo` / `GetTypeInfo` at the generated position (prefer the
innermost token's symbol, fall back to candidate symbols when overload resolution failed) ->
`ISymbol.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat)` in a C# code fence plus
`GetDocumentationCommentXml()` converted to Markdown (summary / params / returns). No Features
package needed. Fidelity: the signature matches VS; doc text matches when the `.xml` sits next to the
DLL, otherwise there is none (same as VS).

### 5.3 Go to definition (Phase 2)

Three cases, in order:

1. Symbol declared in the same view (a local, a `@helper`, a `@functions` member): map the
   `Location.SourceSpan` of the declaring syntax back through the `SpanMap`.
2. Symbol from the site's own assemblies (anything whose containing assembly path is under `bin`
   and whose `.pdb` or name matches a workspace project): look it up in the `SourceIndex`, a map
   built by parsing every `.cs` under the workspace (excluding `bin`, `obj`, `packages`,
   `node_modules`) with `CSharpSyntaxTree.ParseText` and recording each type declaration's
   fully-qualified name and each member's name + parameter count + span. Lookup is
   `symbol.ContainingType.ToDisplayString()` then member name/arity. The parse is syntax-only, so
   ~3,000 files take low single-digit seconds on a background thread and the index is persisted
   (4.6). This is what `roots.js` does for namespaces, done properly.
   Why not PDBs: the sample site builds with `<DebugType>full</DebugType>` (verified), i.e. Windows
   PDBs (MSF 7.00 header, verified), which need `Microsoft.DiaSymReader` native binaries to read.
   Portable PDBs with SourceLink would be readable with `System.Reflection.Metadata`, but most MVC 5
   sites do not have them. The source index needs nothing from the build and also works when bin is
   stale.
3. Everything else (framework, NuGet packages): no source. Return a `textDocument/definition`
   result pointing at a virtual document `mvc5razor-metadata:/<assembly>/<type>.cs` that the
   extension serves through a `TextDocumentContentProvider` with the symbol's public signature
   rendered by `ISymbol.ToDisplayString` for the type and all members (the "[from metadata]"
   experience without ILSpy). Phase 3 polish; Phase 2 just returns nothing for this case.

Fidelity: VS navigates into source for solution projects and shows metadata otherwise; case 2
reproduces the first when the `.cs` is in the workspace, case 3 approximates the second.

### 5.4 Completion (Phase 2)

Two tiers:

- Phase 2 without the Features package: `Recommender.GetRecommendedSymbolsAtPositionAsync(semanticModel, position, workspace)`
  (lives in `Microsoft.CodeAnalysis.Workspaces`) gives the accessible symbols at a position, which
  covers member access after `.`, locals, parameters, types in scope through `@using` and
  web.config namespaces, and extension methods (`Html.` helpers resolve because
  `System.Web.Mvc.Html` is imported). Convert to `CompletionItem` with kind from `SymbolKind`,
  `detail` = display string, `documentation` resolved lazily on `completionItem/resolve`. Keywords
  come from a static list filtered by context (after `@` only directives + `if/for/foreach/...`).
- Phase 3 with `Microsoft.CodeAnalysis.CSharp.Features`: `CompletionService.GetService(document)`
  gives the exact VS provider set (snippets excluded), overload-aware filtering, `nameof`, object
  initialisers, and `QuickInfoService` for richer hover. Costs ~20 MB more on disk (netstandard2.0
  build verified on NuGet, 2.98 MB nupkg for the C# part plus `Microsoft.CodeAnalysis.Features` and
  a MEF composition of 25 dependencies).

Trigger characters: `.`, `@`, `(`, `<`. The `@` trigger needs care: completion after `@` in markup
should offer `Model`, `Html`, `Url`, `ViewBag`, locals, directives; the server asks Razor to
re-parse with a synthetic identifier (`@__completion__`) when the character after `@` is not an
identifier yet, so the parser produces an expression span to anchor on. Razor directive completion
(`@model`, `@using`, `@helper`, `@section`) is a static list.

Fidelity: Phase 2 covers what people actually type in a view; Phase 3 reaches VS parity for C#.

### 5.5 Semantic tokens (Phase 3)

`Classifier.GetClassifiedSpansAsync(document, span)` (Workspaces) over every mapped span, mapped
back and encoded as LSP semantic tokens with the standard token types (`class`, `struct`, `enum`,
`interface`, `namespace`, `method`, `property`, `variable`, `parameter`, `keyword`, `string`,
`number`, `comment`) and modifiers (`static`, `readonly`, `declaration`). The extension's
`semantics.js` decorations are suppressed for a document the moment semantic tokens arrive for it,
and resume if the server goes away. Fidelity: this IS the VS classification (same classifier), so
`Util` vs `Model` vs `feed` get the colour they get in VS, with no heuristic.

### 5.6 Not planned

Signature help, rename, references, code actions. Each is doable later with the same mapping
layer; none is needed for the "write a view without guessing" goal.

## 6. Packaging, size, startup, build tooling, release flow

### 6.1 What ships, and the licensing-driven decision about the Razor DLLs

The server's own code compiles against the `Microsoft.AspNet.Razor` 3.3.0, `Microsoft.AspNet.WebPages`
3.3.0 and `Microsoft.AspNet.Mvc` 5.3.0 packages, but those five DLLs (`System.Web.Razor`,
`System.Web.WebPages`, `System.Web.WebPages.Razor`, `System.Web.Helpers`, `System.Web.Mvc`) are NOT
shipped in the VSIX (`Private=false`). At runtime an `AppDomain.AssemblyResolve` handler loads them
from the site's own `bin`, which every MVC 5 site has (verified on the sample site: `System.Web.Razor`
3.0.0.0 file 3.0.61130.707, `System.Web.Mvc` 5.3.0.0, `System.Web.WebPages[.Razor]` 3.0.0.0,
`Microsoft.Web.Infrastructure` 1.0.0.0).

Reasons:
- Licensing: the NuGet binaries carry the Microsoft .NET Library EULA (section 7), not an OSS
  licence. Not shipping them removes the question entirely.
- Fidelity: the server then parses with exactly the Razor build the site runs. An MVC 4 / Razor 2
  site (`System.Web.Razor` 2.0.0.0) resolves to its own assemblies; the `AssemblyResolve` handler
  returns whatever version bin holds and the CLR accepts it. API surface used here is identical
  across Razor 2 and 3 (unverified for Razor 1 / MVC 3; out of scope).
- If bin has no `System.Web.Razor.dll` the server cannot generate code: it reports that once and
  stays idle for that site (highlighting still works).

The fallback for when this turns out to be fragile (spike S1): build the three assemblies from
https://github.com/aspnet/AspNetWebStack, which is Apache-2.0, and ship those. Same code, OSS licence,
more build work.

Everything else shipped is MIT (section 7).

### 6.2 Size

Measured from the NuGet cache on this box (netstandard2.0 libs, 4.14.0; 5.9.0 is the same order):

| Component | On disk | Notes |
|---|---|---|
| Microsoft.CodeAnalysis.dll | 4.8 MB | required |
| Microsoft.CodeAnalysis.CSharp.dll | 6.8 MB | required |
| Microsoft.CodeAnalysis.Workspaces.Common + CSharp.Workspaces | ~8 MB | required (AdhocWorkspace, Recommender, Classifier); (unverified, not in cache) |
| BCL shims (System.Collections.Immutable 10, System.Reflection.Metadata 10, System.Memory, System.Composition, Bcl.AsyncInterfaces, Threading.Channels, IO.Pipelines, ...) | ~6 MB | required on net48 |
| LSP library (OmniSharp.Extensions.LanguageServer 0.19.x + Microsoft.Extensions.*, Newtonsoft.Json, MediatR) | ~5 MB | or StreamJsonRpc ~1 MB |
| Server exe + Humanizer.Core | ~1 MB | |
| Phase 1-2 total | ~30 MB uncompressed, ~10-12 MB zipped | |
| + Microsoft.CodeAnalysis[.CSharp].Features (Phase 3 option) | +~20 MB | +~7 MB zipped |
| Reference assemblies net48 | 41 MB | NOT shipped; framework dir used, or downloaded on demand |

The current VSIX is 30 KB (verified). The Windows VSIX would be ~11-20 MB. Startup JIT of Roslyn on
.NET Framework is the real cost, not bytes on disk.

Marketplace size limit: not documented on the publishing page (verified, the page has no size
statement). One blog post reports a 26.6 MB VSIX being rejected as "malformed/corrupted" and an
undocumented limit being the cause (https://levelup.gitconnected.com/reducing-a-visual-studio-extension-vsix-file-size-86ed72fbcf39,
secondhand, that was the Visual Studio marketplace, not necessarily VS Code). Large VS Code
extensions (the C# extension itself bundles a .NET runtime and Roslyn, well over 100 MB) clearly
publish, so the limit is either high or absent; spike S6 answers it by uploading. Plan B is
download-on-first-run from the GitHub release (section 6.5).

### 6.3 Server libraries

- LSP: `OmniSharp.Extensions.LanguageServer` 0.19.11 (netstandard2.0, last published 2026-10-07,
  verified on nuget.org; licence not shown on the page, repository is MIT - unverified). It gives
  typed handlers, capability registration and the semantic-tokens plumbing. Alternative:
  `StreamJsonRpc` 2.26.x (MIT, netstandard2.0, verified) plus hand-written LSP types; smaller,
  more code. Start with OmniSharp.Extensions; swap only if its dependency tree (Microsoft.Extensions.*
  10.x) fights .NET Framework binding redirects in the spike.
- Roslyn: `Microsoft.CodeAnalysis.CSharp.Workspaces` 5.9.0, which still includes a netstandard2.0
  build (verified: nuget.org lists ".NET Standard 2.0" and "net10.0" as included targets, published
  2026-08-17; `net472` shows as computed-compatible). `Microsoft.CodeAnalysis.CSharp` 5.9.0 likewise
  (11.6 MB nupkg, MIT). netstandard2.0 needs .NET Framework 4.7.2+, and the server targets 4.8.
  Roslyn's own guidance only says net461+ is "computed"; the real floor is whatever
  `System.Collections.Immutable` 10 and `System.Memory` need, which is 4.6.2+. Pin the exact Roslyn
  version in the csproj; do not float, because every Roslyn bump moves the BCL shim versions and
  that is the OmniSharp failure class.
- App.config binding redirects are generated by `AutoGenerateBindingRedirects` for an exe. Verify
  with `bun run audit`-style tooling later; Phase 0 just runs it.

### 6.4 Build tooling

The server is one SDK-style project, `server/Mvc5RazorServer.csproj`, `<TargetFramework>net48</TargetFramework>`,
`PackageReference` only, `AnyCPU` (one exe runs on win32-x64 and natively on win32-arm64 under .NET
4.8.1, which has native ARM64 support). No `packages.config`, no `nuget.exe`.

Two ways to build it, both wired as npm scripts that call `scripts/build-server.ps1`:

1. `MSBuild.exe -restore -p:Configuration=Release` from a VS 2026 install located with `vswhere`
   (verified present: `C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe`, and
   MSBuild 18.12 under `...\18\Insiders\MSBuild\Current\Bin`). This is the same toolchain the main
   site's `build.ps1` uses. Restore of PackageReference projects is built into MSBuild; no
   `nuget restore` step.
2. `dotnet build -c Release` with any .NET SDK (SDK 11.0.100-rc.2 is installed here). The SDK builds
   `net48` on Windows and auto-restores `Microsoft.NETFramework.ReferenceAssemblies` when the VS
   reference assemblies are absent.

Plain statement: `dotnet build` is the pragmatic default for THIS repo. It needs nothing but the SDK,
it is what GitHub Actions `windows-latest` has, and the "never run dotnet" rule belongs to the
Medportal repo's classic packages.config build, where `dotnet` genuinely cannot build the site. The
script prefers MSBuild via vswhere when VS is installed (so local output is identical to the site's
toolchain) and falls back to `dotnet build`. Either way the output goes to `server/bin/Release/net48/`
and the packaging script copies it to `server/dist/` which `.vscodeignore` includes only for the
Windows targets.

Optional: a GitHub Actions workflow on `windows-latest` that builds the server and attaches the
targeted VSIXs to the release. Not required by the manual-upload release flow in `RELEASING.md`.

### 6.5 Platform-specific VSIX and the release flow

`vsce package --target win32-x64` / `--target win32-arm64` produce platform VSIXs; VS Code 1.61+
picks the matching one and a package published without `--target` is the fallback for every other
platform (verified: https://code.visualstudio.com/api/working-with-extensions/publishing-extension,
"Platform-specific extensions"; targets include `win32-x64`, `win32-arm64`, `linux-*`, `darwin-*`,
`web`). That maps exactly onto the goal:

| Package | Contains | Behaviour |
|---|---|---|
| `vscode-aspnet-mvc5-razor-win32-x64.vsix` | JS + `server/dist/` | full IntelliSense |
| `vscode-aspnet-mvc5-razor-win32-arm64.vsix` | same bytes (AnyCPU) | full IntelliSense |
| `vscode-aspnet-mvc5-razor.vsix` (no target) | JS only | highlighting-only, today's behaviour |

All three carry the same version. `RELEASING.md` changes:

- Step 3 gains `npm run build-server` and the server's test run.
- Step 4 becomes three `npm run package` variants (`package`, `package:win32-x64`,
  `package:win32-arm64`); the identity check runs on each.
- Step 6 uploads three files on the manage page (the page accepts platform VSIXs the same way).
- Step 8 attaches all three to the GitHub release.
- `engines.vscode` bumps from `^1.90.0` to `^1.91.0` because `vscode-languageclient` 11.0.0
  requires it (verified: registry.npmjs.org, version 11.0.0, `engines.vscode ^1.91.0`, depends on
  `vscode-languageserver-protocol` 3.18.5).

Download-on-first-run (Plan B, only if S6 shows the Marketplace rejects the size): the untargeted
VSIX ships a `server/manifest.json` with the release URL + SHA-256; on first `.cshtml` on Windows the
extension offers "Download IntelliSense server (12 MB)", fetches to `globalStorageUri`, verifies the
hash, and starts it. Explicit permission before any download, as the extension must never fetch
silently. Prefer bundling: fewer moving parts, works offline, and the version pairing is implicit.

### 6.6 Startup time (unverified, spike S3 measures)

- Process start + Roslyn JIT: 1-2 s on .NET Framework (no ReadyToRun available for net48; NGEN is
  not an option for a user-installed extension).
- First reference load for a 350-DLL bin: 2-5 s to materialise assembly symbols on first semantic
  query. Shown as `$/progress`. Later views are instant.
- Per keystroke: Razor + CodeDOM + `Document.WithText` + diagnostics well under 150 ms for a
  500-line view.

### 6.7 Extension-side wiring (`src/extension.js`)

```js
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const exe = path.join(context.extensionPath, 'server', 'dist', 'Mvc5RazorServer.exe');
if (process.platform === 'win32' && fs.existsSync(exe) && config.get('server.enabled')) {
    client = new LanguageClient('aspnetMvc5Razor', 'ASP.NET MVC 5 Razor', 
        { command: exe, args: ['--stdio'], transport: TransportKind.stdio },
        { documentSelector: [{ scheme: 'file', language: 'aspnetmvc5razor' }],
          synchronize: { fileEvents: [workspace.createFileSystemWatcher('**/bin/*.dll'), workspace.createFileSystemWatcher('**/web.config'), workspace.createFileSystemWatcher('**/*.cs')] },
          initializationOptions: { binPath: config.get('server.binPath') } });
    await client.start();
}
```

No `middleware` is needed: the document language id is ours (`aspnetmvc5razor`) and the server
answers for the C# regions, so there is no embedded-language forwarding to another server. (HTML
completion is not provided today either: VS Code's HTML providers are registered on the `html`
language id, so they do not run in an `aspnetmvc5razor` document. Out of scope, see section 1.) `middleware.provideDocumentSemanticTokens` is the one hook used in
Phase 3 to switch the JS decorations off per document once tokens arrive.

New settings: `aspnetMvc5Razor.server.enabled` (default true), `aspnetMvc5Razor.server.binPath`
(override the auto-detected bin), `aspnetMvc5Razor.server.trace` (`off|messages|verbose`), and a
command `ASP.NET MVC 5 Razor: Show Generated C#`.

## 7. Licensing findings

| Component | Licence | How it affects shipping | Source |
|---|---|---|---|
| `Microsoft.AspNet.Razor` 3.3.0, `Microsoft.AspNet.WebPages` 3.3.0, `Microsoft.AspNet.Mvc` 5.3.0 NuGet binaries | "MICROSOFT SOFTWARE LICENSE TERMS - MICROSOFT .NET LIBRARY" (proprietary, `requireLicenseAcceptance=true`, `<license type="file">NET_Library_EULA_ENU.txt</license>`) | Redistribution of object code is allowed as "Distributable Code" but only "in your programs and not as a standalone distribution", requires "your valid copyright notice", requires that you "indemnify, defend, and hold harmless Microsoft from any claims", and forbids altering notices or using Microsoft trademarks. A VSIX bundling them would qualify as "your program" but carries the indemnity clause and needs a third-party notice. The design avoids it by loading from the site's bin (6.1). | nuget.org licence pages for 3.3.0 and 5.3.0 (verified 2026-10-22), `.nuspec` and `NET_Library_EULA_ENU.txt` in the local package cache (verified, clause 3.a quoted above) |
| `aspnet/AspNetWebStack` repository (same source) | Apache License 2.0, copyright .NET Foundation | Building the DLLs from source would give Apache-licensed binaries. Documented as the fallback. | https://github.com/aspnet/AspNetWebStack/blob/main/LICENSE.txt (verified) |
| `Microsoft.CodeAnalysis.*` 5.9.0 | MIT | ship freely with the licence text | nuget.org package pages (verified) |
| `Microsoft.NETFramework.ReferenceAssemblies.net48` 1.0.3 | MIT (licence URL -> microsoft/dotnet LICENSE, MIT) | shippable, but not shipped (6.2) | nuspec in local cache + https://github.com/microsoft/dotnet/blob/main/LICENSE (verified) |
| `StreamJsonRpc` 2.26.x | MIT | fine | nuget.org (verified) |
| `OmniSharp.Extensions.LanguageServer` 0.19.11 | MIT per GitHub repo (unverified on nuget page, which only links "License Info") | fine, confirm in S4 | nuget.org (partially verified) |
| `vscode-languageclient` 11.0.0 | MIT | fine | npm registry (verified version/engine; licence field not fetched, project is MIT) |
| RazorGenerator (prior art, not a dependency) | Apache-2.0 | n/a | https://github.com/RazorGenerator/RazorGenerator (verified) |

The licence URL vs repository licence difference the brief asked about is real: NuGet says .NET
Library EULA, GitHub says Apache-2.0 for the identical code. The NuGet-published binaries are
governed by the EULA they ship with; only self-built binaries from the repo inherit Apache-2.0.

## 8. Risks and open questions

| # | Risk / question | Mitigation or spike |
|---|---|---|
| R1 | Loading `System.Web.Razor`/`System.Web.Mvc` from the site's bin at runtime: version binding, strong-name mismatch against the compile-time 3.3.0/5.3.0 references, and MVC 4 sites. | Spike S1: `AssemblyResolve` handler returning bin assemblies; run against the sample site (Razor 3.0.0.0) and a synthetic MVC 4 bin. Fallback: build from the Apache source and ship. |
| R2 | Design-time mapping coordinates (1-based columns, `StartOffset` semantics, multi-line spans, `@helper` bodies, `@section`, `@:` lines). | Spike S2: generate for 20 real views, assert every mapping's generated text equals the view substring at `StartOffset..+CodeLength`. Any mismatch is a bug in step 3.4 and is fixed before Phase 1. |
| R3 | Memory and first-load time with a 350-DLL bin. | Spike S3: measure working set and time-to-first-diagnostic on the sample site. If above 800 MB or 10 s, reference only DLLs whose names appear in `<compilation><assemblies>`, `@using` roots and `bin` DLLs that reference `System.Web.Mvc` (lazy expansion on unresolved-type diagnostics). |
| R4 | OmniSharp.Extensions.LanguageServer dependency tree (Microsoft.Extensions.* 10.x, MediatR) on .NET Framework 4.8 binding redirects. | Spike S4: boot the server with the library and answer `initialize` from VS Code. If it fights, switch to StreamJsonRpc. |
| R5 | `__o = expr;` design-time code produces diagnostics VS hid (CS0414 `__o` assigned but never used, CS0219). | Known list from VS: suppress CS0414, CS0219, CS1702, CS1701, CS0169 on the `__o` field; keep everything else. Verified against real views in S2. |
| R6 | Marketplace rejects a ~15 MB VSIX, or platform-specific upload is not available in the manual upload UI. | Spike S6: package `win32-x64` with the Phase 0 exe and upload it as a pre-release. If rejected, Plan B download-on-first-run (6.5). |
| R7 | Sitefinity-specific view locations (`ResourcePackages\<pkg>\MVC\Views`) and the precompiled `Medportal.Sitefinity.ResourcePackages.Medportal.dll`. | Nothing special in codegen; the site root detection must accept views under any folder of the site, not only `Views\`. Test with the sample site's 134 ResourcePackage views (verified count). |
| R8 | `WebPageRazorHost` or `MvcWebPageRazorHost` touching `HttpRuntime`/`BuildManager` in a path not read here (e.g. `InstrumentationService`, `GetCodeLanguage`). | S1 runs the generator in a console app with no HttpRuntime; any `HttpException` shows up immediately. `EnableInstrumentation = false` is set defensively. |
| R9 | Two VS Code windows on the same site each start a server and each load bin: 2x memory. | Accept for v1. Later: a per-site server keyed on the root path with a named pipe, as the C# extension does. |
| R10 | Roslyn 5.9 netstandard2.0 build could be dropped in a future major (Roslyn has kept it because VS itself runs Roslyn on .NET Framework, but that is policy, not a promise; no public statement found - unverified). | Pin the version. Even if netstandard2.0 disappears later, a pinned 5.x keeps working against C# 7.3 views forever; the server never needs a newer compiler. |
| R11 | Views that compile only with site-specific `web.config` `<compilation>` tweaks (`<remove assembly="System.Linq.Async"/>` on the sample site). | The reader implements add/remove/clear; the sample site is the regression test. |
| R12 | Users on macOS/Linux expecting IntelliSense. | README states Windows-only explicitly; the untargeted VSIX shows a one-time "IntelliSense needs Windows (.NET Framework)" info message when a `.cshtml` opens. |
| Q1 | Is `@helper` in `App_Code` worth Phase 3 at all? | The sample site has none. Ship Phase 3 without it unless an issue asks. |
| Q2 | Hover docs for site assemblies without `.xml` files. | None, same as VS. The source index (5.3) could extract `///` comments from the `.cs` later. |

## 9. Phased plan

Effort assumes one developer who already knows the extension and the Razor/Roslyn APIs from this
document; add 30% otherwise. No phase requires changes to any site.

### Phase 0: spike (console app, 2-3 days)

- [ ] `server/spike/` console project (net48, SDK-style) referencing Razor 3.3.0 / MVC 5.3.0 with
      `Private=false`, Roslyn `CSharp.Workspaces` 5.9.0, built with `scripts/build-server.ps1`.
- [ ] S1: `AssemblyResolve` loads the five Razor/MVC DLLs from `<site>\bin`; generate code for one
      sample view with `MvcWebPageRazorHost` in design-time mode; print the C#.
- [ ] S2: for 20 views (mix of `@model`, `@helper`, `@section`, `@:`, nested markup in `if`),
      assert `view.Substring(StartOffset, CodeLength) == generated.Substring(genStart, CodeLength)`
      for every mapping. Document any surprise in this file.
- [ ] S3: build the `ReferenceSet` from the sample site's bin + framework dir; compile; print
      diagnostics mapped back to view coordinates; print the symbol at a given view position
      (`--view <path> --line L --col C`). Record working set and time-to-first-diagnostic.
- [ ] S4: minimal LSP `initialize` + `hover` through OmniSharp.Extensions over stdio, driven by a
      throwaway `vscode-languageclient` branch of `extension.js`. Confirm the handshake works.
- [ ] S6: package a `win32-x64` VSIX with the spike exe inside and upload it to the Marketplace as a
      pre-release under a `-spike` version, or confirm the upload UI accepts it without publishing.
- Exit criteria: for `Mvc\Views\Changelog\Changelog.cshtml`, the console prints zero false
  diagnostics, and asks for the symbol under `Model.Heading` return
  `string ChangelogWidgetModel.Heading` with mapping offsets verified. R1-R4, R6, R8 answered.

### Phase 1: diagnostics + hover (1-1.5 weeks)

- [ ] `server/Mvc5RazorServer` project: `SiteModel`, `WebConfigReader` (merge order, add/remove/clear,
      langversion), `ReferenceSet`, `RazorCodeGen`, `SpanMap`, `RoslynProject`.
- [ ] LSP: `initialize`, full text sync, `publishDiagnostics` (debounced), `hover`,
      `mvc5razor/showGeneratedCode`, `window/showMessage` for missing bin / missing Razor DLLs.
- [ ] File watching: bin, web.config, cshtml.
- [ ] Stale/missing-bin behaviour (4.4).
- [ ] Extension: `vscode-languageclient` 11, `engines.vscode ^1.91.0`, server start/stop,
      `server.enabled` / `server.binPath` / `server.trace` settings, "Show Generated C#" command,
      output channel.
- [ ] Tests: xUnit/MSTest project over the generator + mapper with checked-in sample views (no site
      needed), and one opt-in test that runs against `C:\GitHub\Medportal\Medportal.Sitefinity`
      when present, asserting zero false errors across all 666 views (532 + 134, verified counts).
- [ ] `RELEASING.md`, README ("What it does not do" rewritten), CHANGELOG, `.vscodeignore`,
      `package:win32-x64` / `package:win32-arm64` scripts.
- Exit criteria: open any view in the sample site; errors appear only where VS shows them; hover on
  `Model.X`, `Html.ActionLink`, a local, a `Util.` static shows the VS signature; server survives
  a `bun run build` of the site (bin rewrite) and re-diagnoses. Published as 0.4.0 to the Marketplace
  with the three VSIXs.

### Phase 2: definition + completion (1.5-2 weeks)

- [ ] `SourceIndex` (syntax-only parse of workspace `.cs`, persisted, watcher-maintained).
- [ ] `textDocument/definition` cases 1 and 2 (5.3).
- [ ] `textDocument/completion` via `Recommender` + static keyword/directive lists, `completionItem/resolve`
      for docs; trigger characters; the `@` synthetic-identifier re-parse.
- [ ] Completion inside `@helper` bodies and `@functions`.
- [ ] Tests: definition into a checked-in fake site with `.cs` sources; completion lists for 10
      positions compared to golden files.
- Exit criteria: F12 on `Util.SomeMethod(` lands on the method in `Medportal.Sitefinity.Controls`;
  typing `@Model.` lists the model's members; `@Html.` lists the HtmlHelper extensions including
  the site's own (`Html.ScriptVersioned`). Published as 0.5.0.

### Phase 3: semantic tokens and polish (1 week)

- [ ] Semantic tokens full + range from `Classifier`; extension suppresses `semantics.js` decorations
      per document when tokens arrive, restores on server loss.
- [ ] Optional `Features` package behind a build flag: `CompletionService` + `QuickInfoService`;
      measure size and decide whether to keep it.
- [ ] Metadata-as-signature virtual documents for definition case 3.
- [ ] App_Code `@helper` files (only if asked, Q1).
- [ ] Memory/time telemetry in the output channel (no network telemetry).
- Exit criteria: colouring of `Util` / `Model` / `feed` in the README screenshot comes from the
  server, not the heuristic, and matches VS; no regressions in `npm test` and the sample-site check.
  Published as 0.6.0.

## 10. Recommendation

Build it, in the order above, and decide after Phase 0.

Why it is worth doing: every piece of the hard problem already exists and is open. The Razor v3
engine's design-time mode is literally what Visual Studio used, and its span dictionary gives
column-exact mappings, so there is no parser to write. Roslyn on .NET Framework is still fully
supported through the netstandard2.0 build, and reading the site's bin instead of evaluating
projects removes the one dependency (MSBuild in-process) that keeps breaking OmniSharp on this
machine. MVC 5 views are independent compilation units, so the server never needs the cross-document
machinery that makes ASP.NET Core Razor tooling complicated. The site that motivated this has 666
views and a 350-DLL bin and is a realistic worst case; it is also the regression suite.

Why Phase 0 is a real gate and not a formality: three things are unverified and each could change
the design - loading Razor from the site's bin instead of shipping it (R1), the exact semantics of
the mapping dictionary on real views (R2), and whether a 350-reference Roslyn project is acceptable
on a laptop (R3). All three are answered by a two-day console app that does not touch the extension.
If R1 fails, ship Apache-built binaries; if R3 fails, trim references; only if R2 reveals the
mappings are unusable (they were good enough for VS for a decade, so unlikely) does the approach
itself need rethinking.

Why not the alternatives:
- Forwarding to the C# extension's Roslyn server through virtual documents (the way the Razor
  extension does it): a third party cannot inject documents into its projects; a virtual `.cs` lands
  in "miscellaneous files" with no site references, so site types never resolve. Rejected.
- Waiting for Microsoft: the Razor language server has never supported `System.Web.Razor` (the 2018
  preview announcement scoped it to ASP.NET Core, https://devblogs.microsoft.com/aspnet/razor-support-in-visual-studio-code-now-in-preview,
  and nothing since has changed that; the only workaround found in the wild is a product shimming
  its base class to placate the Core compiler, https://2sxc.org/en/blog/post/major-intellisense-enhancements-in-v21-05).
  Rejected.
- Rider: JetBrains documents ASP.NET and ASP.NET Core support but no statement about `System.Web.Razor`
  views was found (unverified); it is a different editor anyway.

Prior art learned from: RazorGenerator (Apache-2.0, last release 2018) proves `MvcWebPageRazorHost`
runs fine outside IIS at build time and is already what the sample site uses to precompile its
ResourcePackage views; the OmniSharp project showed that `Recommender` + `SemanticModel` without the
Features package is enough for a usable first completion; the C# extension's "Show Razor CSharp"
command is the single most useful debugging aid and is copied here as `mvc5razor/showGeneratedCode`.
No existing open-source MVC 5 Razor language server was found (searched 2026-10-22; unverified that
none exists).

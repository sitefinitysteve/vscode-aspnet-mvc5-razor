# Releasing

Maintainer notes for shipping a new version to the VS Code Marketplace and GitHub.

- **Publisher:** `SitefinitySteve`, manage page: https://marketplace.visualstudio.com/manage/publishers/SitefinitySteve
- **Extension ID:** `SitefinitySteve.vscode-aspnet-mvc5-razor`

## Why it's a manual upload

Publishing is done by uploading the `.vsix` on the Marketplace manage page, not with `vsce publish`:

- `vsce publish` needs an Azure DevOps Personal Access Token with **All accessible organizations** scope.
  Microsoft retires those global PATs on **1 December 2026**.
- The replacement (`vsce publish --azure-credential`) needs the Azure CLI and an Entra sign-in, which brings
  the risk of authenticating against the wrong tenant.
- The upload uses the browser session you already manage the publisher with. Where the extension goes is set
  by the `publisher` field inside the `.vsix`, so it cannot land on another publisher: a non-member upload is
  just refused.

## Checklist

1. **Bump the version** in `package.json` ([semver](https://semver.org/): fix = patch, feature = minor):

   ```bash
   npm version patch --no-git-tag-version
   ```

2. **Add a `CHANGELOG.md` entry** for the new version at the top (Added / Fixed), plus its link at the bottom.
   The Marketplace shows this file on the extension's Changelog tab.

3. **Test**, including a scan of a real MVC 5 codebase:

   ```bash
   npm test
   ```

   ```bash
   npm run check-views -- C:/GitHub/Medportal/Medportal.Sitefinity
   ```

   Expect `0 fail`, and only the one known "C# as text" false positive (`return to`, which is prose).

4. **Package and check the identity** inside the VSIX:

   ```bash
   npm run package
   ```

   ```bash
   unzip -p dist/vscode-aspnet-mvc5-razor.vsix extension.vsixmanifest | grep -o "<Identity[^>]*>"
   ```

   It must say `Publisher="SitefinitySteve"` and the new `Version`.

5. **Try it locally** before anyone else gets it, then reload VS Code (Developer: Reload Window):

   ```bash
   code --install-extension dist/vscode-aspnet-mvc5-razor.vsix --force
   ```

6. **Upload to the Marketplace:** open the manage page above, click **...** next to the extension →
   **Update**, and upload `dist/vscode-aspnet-mvc5-razor.vsix`. (First release only: **+ New extension** →
   **Visual Studio Code**.) Validation takes a few minutes; installed copies pick it up through auto-update.

7. **Commit, tag and push:**

   ```bash
   git add -A
   git commit -m "Release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push && git push origin vX.Y.Z
   ```

8. **GitHub release** with the VSIX attached, for people who install without the Marketplace. Paste the
   version's CHANGELOG section as the notes:

   ```bash
   gh release create vX.Y.Z dist/vscode-aspnet-mvc5-razor.vsix --title "vX.Y.Z" --notes-file notes.md
   ```

## When the grammar changes upstream

The Razor grammar is generated from the C# extension's copy. After a C# extension update that fixes Razor
highlighting, regenerate it, run the checklist from step 3, and note it in the CHANGELOG:

```bash
npm run build-grammar
```

## README screenshot

`images/screenshot-comparison.png` is the same lines of one view in Visual Studio (left) and VS Code (right),
scaled to the same height so rows line up. Retake it when the look changes noticeably. It is excluded from the
VSIX by `.vscodeignore`, so its size does not matter to the package.

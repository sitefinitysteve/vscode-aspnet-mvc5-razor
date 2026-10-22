'use strict';
/**
 * Namespace roots a project can see, so `Medportal.Foo.Bar` and `ServiceStack.Text.X` are read as
 * namespaces rather than static classes. Visual Studio knows this from references; we approximate it from
 * the files that declare them: `namespace X` in .cs, `<add namespace>` in web.config, and NuGet package ids.
 */
const fs = require('fs');

const HEAD_BYTES = 4096;

function readHead(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(HEAD_BYTES);
        const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
        return buf.toString('utf8', 0, n);
    } catch (e) {
        return '';
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

function readAll(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (e) {
        return '';
    }
}

function firstSegment(name) {
    const m = name.match(/^([A-Za-z_]\w*)/);
    return m ? m[1] : null;
}

/** csFiles: paths of .cs files; configFiles: web.config, packages.config and *.csproj paths. */
function collectRoots(csFiles, configFiles) {
    const roots = new Set();
    const add = name => {
        const root = firstSegment(name);
        if (root) {
            roots.add(root);
        }
    };
    for (const file of csFiles) {
        // file-scoped or block namespaces both start with `namespace X`
        const m = readHead(file).match(/^\s*namespace\s+([A-Za-z_][\w.]*)/m);
        if (m) {
            add(m[1]);
        }
    }
    for (const file of configFiles) {
        const text = readAll(file);
        for (const m of text.matchAll(/<add\s+namespace\s*=\s*"([^"]+)"/gi)) {
            add(m[1]);
        }
        for (const m of text.matchAll(/<package\s+id\s*=\s*"([^"]+)"/gi)) {
            add(m[1]);
        }
        for (const m of text.matchAll(/<(?:PackageReference|Reference)\s+Include\s*=\s*"([^",]+)/gi)) {
            add(m[1]);
        }
    }
    return roots;
}

/** Same as collectRoots, yielding between batches so a large repo never blocks the extension host. */
async function collectRootsAsync(csFiles, configFiles, batchSize = 200) {
    const roots = collectRoots([], configFiles);
    for (let i = 0; i < csFiles.length; i += batchSize) {
        collectRoots(csFiles.slice(i, i + batchSize), []).forEach(r => roots.add(r));
        await new Promise(resolve => setImmediate(resolve));
    }
    return roots;
}

module.exports = { collectRoots, collectRootsAsync };

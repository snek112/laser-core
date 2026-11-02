const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

test('the package includes every local dependency of the Electron entry points', () => {
  const pending = [pkg.main, 'preload.js', 'splash-preload.js'];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(pkg.build.files.includes(file), `Missing packaged module: ${file}`);
    const absolute = path.join(root, file);
    const source = fs.readFileSync(absolute, 'utf8');
    // Production CommonJS modules use literal relative requires. Follow the
    // dependency graph without executing main.js or starting Electron/a node.
    for (const match of source.matchAll(/require\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
      const dependency = require.resolve(path.resolve(path.dirname(absolute), match[2]));
      const relative = path.relative(root, dependency).split(path.sep).join('/');
      assert.ok(!relative.startsWith('../'), `Dependency outside the app: ${relative}`);
      pending.push(relative);
    }
  }
});

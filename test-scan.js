// node test-scan.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { scan, APP_EXT, IMG_EXT } = require('./scan');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-'));
const touch = f => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), ''); };
['Game.exe', 'Tools/Paint/Paint.exe', 'Tools/Paint/unins000.exe', 'Deep/a/b/Too.exe',
 'Pics/a.JPG', 'Pics/trip/b.png', 'notes.txt', 'node_modules/x.exe'].forEach(touch);
fs.mkdirSync(path.join(d, 'Calc.app'));

const names = l => l.map(p => path.relative(d, p).split(path.sep).join('/')).sort();
assert.deepStrictEqual(names(scan(d, APP_EXT, 2, 100)), ['Calc.app', 'Game.exe', 'Tools/Paint/Paint.exe']);
assert.deepStrictEqual(names(scan(d, IMG_EXT, 5, 100)), ['Pics/a.JPG', 'Pics/trip/b.png']);
assert.strictEqual(scan(d, IMG_EXT, 5, 1).length, 1);
assert.deepStrictEqual(scan(path.join(d, 'missing'), APP_EXT, 2, 100), []);
fs.rmSync(d, { recursive: true });
console.log('scan ok');

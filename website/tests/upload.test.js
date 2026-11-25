// Unit tests of lib/upload.js: what a file really is, and the name that the users see.
// Equivalence partitioning (testing laboratory, section 5): one test for each kind of input.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectType, cleanName, filePath } = require('../lib/upload');

const bytes = (...b) => Buffer.from(b);

test('a PDF, a JPG and a PNG are recognized by their first bytes', () => {
    assert.equal(detectType(Buffer.from('%PDF-1.7\n...')).type, 'PDF');
    assert.equal(detectType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)).type, 'JPG');
    assert.equal(detectType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)).type, 'PNG');
});

test('other files are refused, also when they are only renamed', () => {
    assert.equal(detectType(Buffer.from('MZ this is an .exe called report.pdf')), null);
    assert.equal(detectType(Buffer.from('<html><script>alert(1)</script>')), null);
    assert.equal(detectType(Buffer.from('PK\u0003\u0004 a zip or docx file')), null);
});

test('files that are too short are refused (boundary values)', () => {
    assert.equal(detectType(Buffer.alloc(0)), null);
    assert.equal(detectType(Buffer.from('%PDF')), null, '4 of the 5 bytes of a PDF');
    assert.equal(detectType(bytes(0xff, 0xd8)), null, '2 of the 3 bytes of a JPG');
    assert.equal(detectType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)), null, '7 of the 8 bytes of a PNG');
});

test('the name of a file loses its folder and its control characters', () => {
    assert.equal(cleanName('C:\\Users\\me\\Desktop\\mill-cert.pdf'), 'mill-cert.pdf');
    assert.equal(cleanName('../../etc/passwd'), 'passwd');
    assert.equal(cleanName('re\u0000port\u001f.pdf'), 'report.pdf');
    assert.equal(cleanName(''), 'document');
    assert.equal(cleanName(undefined), 'document');
});

test('a Chinese name sent as UTF-8 and read as Latin-1 is converted back', () => {
    const sent = Buffer.from('出廠證明.pdf', 'utf8').toString('latin1');     // what multer gives us
    assert.equal(cleanName(sent), '出廠證明.pdf');
});

test('a long name keeps its last 150 characters (so the extension stays)', () => {
    const name = cleanName('a'.repeat(300) + '.pdf');
    assert.equal(name.length, 150);
    assert.ok(name.endsWith('.pdf'));
});

test('only stored names made by the website can be opened', () => {
    assert.ok(filePath('0123456789abcdef0123456789abcdef.pdf'));
    assert.equal(filePath('../config.js'), null);
    assert.equal(filePath('0123456789abcdef0123456789abcdef.exe'), null);
    assert.equal(filePath('0123456789ABCDEF0123456789ABCDEF.pdf'), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { localClientResource } from '../web/local_client_resource.mjs';

test('resolves real Wowser resource paths under local /client route', () => {
  assert.equal(localClientResource('Wowser\\Wowser.toc'), '/client/Wowser/Wowser.toc');
  assert.equal(localClientResource('Wowser\\..\\Interface\\GlueXML\\GlueFonts.xml'),
    '/client/Interface/GlueXML/GlueFonts.xml');
  assert.equal(localClientResource('Interface/GlueXML/GlueFontStyles.xml'),
    '/client/Interface/GlueXML/GlueFontStyles.xml');
});

test('normalizes legal relative segments without escaping route', () => {
  assert.equal(localClientResource('a/./b/../c.lua'), '/client/a/c.lua');
  assert.equal(localClientResource('Wowser//UI Test.xml'), '/client/Wowser/UI%20Test.xml');
});

test('rejects foreign-origin and traversal resource names', () => {
  for (const input of ['https://evil.example/a.lua', 'file:///tmp/x',
    '/etc/passwd', '..\\secret', 'Wowser\\..\\..\\private',
    '\\server\\share', 'C:\\Windows\\foo', 'a%2f..', 'a?token=abc',
    'a#frag', 'foo\nbar', '', 10, 'a'.repeat(1025)]) {
    assert.throws(() => localClientResource(input));
  }
});

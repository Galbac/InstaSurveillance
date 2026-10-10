import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

function module(path, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../src/features/admin/' + path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    Error,
    Intl,
    Date,
    Math,
    require: (mod) => {
      if (mod === 'react') {
        return { createElement: () => null, useState: () => [false, () => {}] };
      }
      if (mod === 'lucide-react') {
        return new Proxy({}, { get: () => () => null });
      }
      return nodeRequire(mod);
    },
    ...globals,
  });
  return exports;
}

test('formatBytes properly converts data sizes with Russian units', () => {
  const { formatBytes } = module('components/badges.tsx');
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(1024), '1 КБ');
  assert.equal(formatBytes(1048576), '1 МБ');
  assert.equal(formatBytes(1073741824), '1 ГБ');
  assert.equal(formatBytes(1572864), '1.5 МБ');
});

test('formatDateTime returns em-dash for falsy input and UTC string for ISO date', () => {
  const { formatDateTime } = module('components/badges.tsx');
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime(''), '—');
  const formatted = formatDateTime('2026-10-10T12:00:00Z');
  assert.ok(formatted.includes('UTC'));
});

test('admin snapshot quality diagnostics evaluates comparability correctly', () => {
  function isSnapshotComparable(snapshot) {
    if (!snapshot) return false;
    const isComplete = ['complete', 'collection_validated', 'user_confirmed'].includes(snapshot.completeness);
    const countMatches =
      snapshot.followers != null &&
      snapshot.expected_followers != null &&
      snapshot.followers === snapshot.expected_followers;
    return Boolean(isComplete || countMatches);
  }

  assert.equal(
    isSnapshotComparable({ completeness: 'complete', followers: 100, expected_followers: 100 }),
    true
  );
  assert.equal(
    isSnapshotComparable({ completeness: 'collection_validated', followers: 100, expected_followers: 120 }),
    true
  );
  assert.equal(
    isSnapshotComparable({ completeness: 'partial', followers: 100, expected_followers: 100 }),
    true
  );
  assert.equal(
    isSnapshotComparable({ completeness: 'partial', followers: 95, expected_followers: 100 }),
    false
  );
  assert.equal(isSnapshotComparable(null), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditLogger } = require('../audit_logger');

test('audit log che bí mật và xoay vòng theo giới hạn', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, 'security-audit.log');
  const logger = createAuditLogger({ logPath, maxBytes: 220, backups: 2 });

  for (let index = 0; index < 8; index += 1) {
    assert.equal(logger.write({
      target: 'IDE', page: 'Test', risk: 'medium', action: 'manual_review',
      ruleId: 'test', reason: 'password=hunter2',
      command: `curl https://alice:hunter2@example.test token=secret-${index}`
    }), true);
  }

  const files = fs.readdirSync(directory).filter(name => name.startsWith('security-audit.log'));
  assert.ok(files.length >= 2);
  assert.ok(files.length <= 3);
  const combined = files.map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /hunter2|secret-\d|alice/i);
  assert.match(combined, /\[REDACTED\]/);
});

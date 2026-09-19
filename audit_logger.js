'use strict';

const fs = require('fs');
const path = require('path');
const { redactSensitive } = require('./command_policy');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_BACKUPS = 5;

function rotateLogs(logPath, maxBytes = DEFAULT_MAX_BYTES, backups = DEFAULT_BACKUPS) {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size < maxBytes) return;

  const oldest = `${logPath}.${backups}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  for (let index = backups - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${logPath}.${index + 1}`);
  }
  fs.renameSync(logPath, `${logPath}.1`);
}

function sanitizeField(value, maxLength = 500) {
  const redacted = redactSensitive(String(value ?? '')).replace(/[\r\n]+/g, ' ');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function createAuditLogger(options = {}) {
  const logPath = options.logPath || path.join(__dirname, 'security-audit.log');
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const backups = options.backups || DEFAULT_BACKUPS;

  function write(event) {
    try {
      rotateLogs(logPath, maxBytes, backups);
      const record = {
        timestamp: new Date().toISOString(),
        target: sanitizeField(event.target, 120),
        page: sanitizeField(event.page, 160),
        risk: sanitizeField(event.risk, 20),
        action: sanitizeField(event.action, 40),
        ruleId: sanitizeField(event.ruleId, 80),
        reason: sanitizeField(event.reason, 300),
        command: sanitizeField(event.command, 500)
      };
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
      return true;
    } catch (error) {
      return false;
    }
  }

  return { logPath, write };
}

module.exports = {
  DEFAULT_BACKUPS,
  DEFAULT_MAX_BYTES,
  createAuditLogger,
  rotateLogs,
  sanitizeField
};

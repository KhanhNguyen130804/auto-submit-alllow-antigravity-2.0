'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

function normalizeForComparison(value) {
  return path.normalize(String(value || '')).replace(/\\/g, '/').toLowerCase();
}

function getProcessCommandLine(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== 'win32') return '';
  const script = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return '';
  }
}

function isExpectedDaemon(pid, scriptPath) {
  const commandLine = normalizeForComparison(getProcessCommandLine(pid));
  const expected = normalizeForComparison(path.resolve(scriptPath));
  if (!commandLine || !expected) return false;
  return commandLine.includes(expected);
}

function parsePidRecord(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return { pid: parsed, scriptPath: '', startedAt: '' };
    }
    const pid = Number(parsed.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    return { pid, scriptPath: parsed.scriptPath || '', startedAt: parsed.startedAt || '' };
  } catch (error) {
    const pid = Number(trimmed);
    return Number.isSafeInteger(pid) && pid > 0 ? { pid, scriptPath: '', startedAt: '' } : null;
  }
}

module.exports = {
  getProcessCommandLine,
  isExpectedDaemon,
  parsePidRecord
};

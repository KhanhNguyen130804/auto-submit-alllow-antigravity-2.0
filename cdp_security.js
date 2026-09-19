'use strict';

function isLoopbackDebuggerUrl(rawUrl, expectedPort) {
  try {
    const parsed = new URL(rawUrl);
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    return parsed.protocol === 'ws:' && loopbackHosts.has(parsed.hostname) && Number(parsed.port) === expectedPort;
  } catch (error) {
    return false;
  }
}

module.exports = { isLoopbackDebuggerUrl };

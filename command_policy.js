'use strict';

const path = require('path');

const SENSITIVE_PATTERN = /(?:^|[\\/._-])(?:\.env(?:\.|$)|\.ssh(?:[\\/]|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|api[_-]?keys?(?:\.|$)|passwords?(?:\.|$)|\.npmrc$|\.pypirc$|\.netrc$|aws[\\/]credentials)/i;

const HIGH_RISK_RULES = [
  ['destructive-filesystem', /(?:^|[;&|]\s*)(?:rm(?:\.exe)?\s|rmdir\s|rd\s|del\s|erase\s|remove-item\b|clear-content\b)/i],
  ['overwrite-filesystem', /(?:^|[;&|]\s*)(?:set-content\b|add-content\b|out-file\b|move-item\b|copy-item\b|format\b|diskpart\b|cipher\s+\/w\b)/i],
  ['process-or-power-control', /(?:^|[;&|]\s*)(?:taskkill\b|stop-process\b|kill\s|shutdown\b|restart-computer\b|stop-computer\b)/i],
  ['system-configuration', /(?:^|[;&|]\s*)(?:reg(?:\.exe)?\s+(?:add|delete)\b|sc(?:\.exe)?\s+(?:config|create|delete|start|stop)\b|netsh\b|set-netfirewallprofile\b|new-netfirewallrule\b|net\s+(?:user|localgroup)\b|(?:new|remove)-localuser\b)/i],
  ['privilege-escalation', /(?:^|[;&|]\s*)(?:sudo\b|runas\b)|start-process[^\r\n]*-verb\s+runas\b/i],
  ['dynamic-execution', /(?:invoke-expression|\biex\b|frombase64string|encodedcommand|\s-[Ee]nc(?:odedcommand)?\s)/i],
  ['download-and-execute', /(?:curl|wget|invoke-webrequest|\biwr\b)[^\r\n]*(?:\||;|&&)[^\r\n]*(?:powershell|pwsh|cmd|bash|sh|python|node|iex|invoke-expression)/i],
  ['destructive-git', /\bgit\s+(?:reset\s+--hard\b|clean\s+[^\r\n]*-[^\s]*f|checkout\b|restore\b|branch\s+-D\b|push\s+[^\r\n]*--force\b)/i],
  ['output-redirection', /(?:^|[^<])>{1,2}(?!>)|<{1,2}(?!<)/]
];

const SHELL_CONTROL_PATTERN = /(?:&&|\|\||[;|`\r\n(){}]|\$|\^(?![A-Za-z0-9]))/;
const CMD_VARIABLE_PATTERN = /%[^%\r\n]+%|![A-Za-z_][A-Za-z0-9_]*!/;

const GIT_STATUS_FLAGS = new Set([
  '-s', '-b', '--short', '--branch', '--porcelain', '--porcelain=v1', '--porcelain=v2',
  '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all', '-uno', '-unormal', '-uall'
]);

const GIT_READ_FLAGS = new Set([
  '--stat', '--oneline', '--decorate', '--no-decorate', '--name-only', '--name-status', '--summary',
  '--patch', '-p', '-s', '--no-patch', '--cached', '--staged', '--color=never', '--no-color',
  '--all', '--branches', '--tags', '--remotes', '--reverse', '--first-parent', '--follow', '--no-renames'
]);

const LIST_FLAGS = /^(?:-[A-Za-z]+|\/[A-Za-z?]+)$/;
const SAFE_ARGUMENT = /^[A-Za-z0-9_.,:@%+=\-\/\\*?\[\]"' ]+$/;

function normalizeCommand(command) {
  return typeof command === 'string' ? command.trim().replace(/[\t ]+/g, ' ') : '';
}

function redactSensitive(value) {
  let text = typeof value === 'string' ? value : '';
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]');
  text = text.replace(/([?&](?:access_?token|api_?key|token|password|secret)=)[^&#\s]+/gi, '$1[REDACTED]');
  text = text.replace(/\b((?:password|passwd|pwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;]+)/gi, '$1[REDACTED]');
  text = text.replace(/((?:--?)(?:password|passwd|token|secret|api[_-]?key)\s+)("[^"]*"|'[^']*'|[^\s;]+)/gi, '$1[REDACTED]');
  text = text.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function tokenize(command) {
  const tokens = command.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) || [];
  const quoteCount = (command.match(/(?<!\\)"/g) || []).length;
  const singleQuoteCount = (command.match(/'/g) || []).length;
  if (quoteCount % 2 !== 0 || singleQuoteCount % 2 !== 0) return null;
  return tokens.map(token => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function hasSensitiveReference(command) {
  return command.split(/\s+/).some(part => SENSITIVE_PATTERN.test(part.replace(/["']/g, '')));
}

function hasUnsafePath(command) {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const executable = (parts[0] || '').replace(/["']/g, '').toLowerCase();
  return parts.some((rawPart, index) => {
    const part = rawPart.replace(/^["']|["']$/g, '');
    if (index > 0 && executable === 'dir' && /^\/[A-Za-z?]+$/.test(part)) return false;
    return /^[A-Za-z]:[\\/]/.test(part) || /^\\\\/.test(part) || /^\//.test(part) ||
      /^~(?:[\\/]|$)/.test(part) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(part);
  });
}

function validCwd(cwd) {
  return typeof cwd === 'string' && cwd.trim().length > 0 && path.isAbsolute(cwd.trim());
}

function safeArguments(tokens) {
  return tokens.every(token => SAFE_ARGUMENT.test(token));
}

function classifyGit(tokens) {
  if (tokens.length < 2 || tokens[0].toLowerCase() !== 'git') return null;
  const subcommand = tokens[1].toLowerCase();
  const args = tokens.slice(2);

  if (subcommand === 'status' && args.every(arg => GIT_STATUS_FLAGS.has(arg))) {
    return { ruleId: 'allow-git-status', reason: 'Lệnh Git chỉ đọc trạng thái working tree.' };
  }

  if (!['log', 'show', 'diff'].includes(subcommand)) return null;
  const argsAllowed = args.every(arg => {
    if (GIT_READ_FLAGS.has(arg)) return true;
    if (/^-(?:\d+|(?:n|U)\d+)$/.test(arg) || /^--(?:max-count|unified)=\d+$/.test(arg)) return true;
    if (/^--(?:format|pretty|since|until|author|grep)=/.test(arg)) return SAFE_ARGUMENT.test(arg);
    return !arg.startsWith('-') && SAFE_ARGUMENT.test(arg);
  });
  if (!argsAllowed) return null;
  return { ruleId: `allow-git-${subcommand}`, reason: `Lệnh git ${subcommand} chỉ đọc dữ liệu repository.` };
}

function classifyListing(tokens) {
  const executable = (tokens[0] || '').toLowerCase();
  if (!['dir', 'ls', 'get-childitem', 'gci'].includes(executable)) return null;
  if (!safeArguments(tokens.slice(1))) return null;
  if (!tokens.slice(1).every(arg => !arg.startsWith('-') || LIST_FLAGS.test(arg) || /^-(?:path|filter|include|exclude|depth)$/i.test(arg))) {
    return null;
  }
  return { ruleId: 'allow-directory-listing', reason: 'Chỉ liệt kê nội dung trong thư mục làm việc.' };
}

function classifyRipgrep(tokens) {
  if ((tokens[0] || '').toLowerCase() !== 'rg') return null;
  const forbiddenOptions = /^(?:--pre|--pre-glob|--hostname-bin|--hyperlink-format|--generate|--type-add|--type-clear)$/i;
  if (tokens.slice(1).some(arg => forbiddenOptions.test(arg.split('=')[0]))) return null;
  if (!safeArguments(tokens.slice(1))) return null;
  return { ruleId: 'allow-ripgrep', reason: 'Ripgrep chỉ tìm kiếm hoặc liệt kê tệp trong thư mục làm việc.' };
}

function classifyNodeCheck(tokens) {
  if ((tokens[0] || '').toLowerCase() !== 'node' || tokens[1] !== '--check' || tokens.length !== 3) return null;
  if (!SAFE_ARGUMENT.test(tokens[2]) || tokens[2].startsWith('-')) return null;
  return { ruleId: 'allow-node-check', reason: 'Node.js chỉ kiểm tra cú pháp của một tệp tương đối.' };
}

function decision(risk, ruleId, reason, command) {
  return {
    risk,
    autoApprove: risk === 'low',
    ruleId,
    reason,
    redactedCommand: redactSensitive(command)
  };
}

function evaluateCommand({ command, cwd, target } = {}) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return decision('unknown', 'missing-command', 'Không trích xuất được chính xác câu lệnh.', normalized);
  }

  for (const [ruleId, pattern] of HIGH_RISK_RULES) {
    if (pattern.test(normalized)) {
      return decision('high', ruleId, 'Phát hiện thao tác có thể phá huỷ dữ liệu hoặc thay đổi hệ thống.', normalized);
    }
  }

  if (SHELL_CONTROL_PATTERN.test(normalized) || CMD_VARIABLE_PATTERN.test(normalized)) {
    return decision('medium', 'complex-shell-syntax', 'Câu lệnh chứa toán tử shell, biến hoặc cú pháp ghép lệnh.', normalized);
  }
  if (hasUnsafePath(normalized)) {
    return decision('medium', 'unsafe-path', 'Câu lệnh dùng đường dẫn tuyệt đối, thư mục cha hoặc đường dẫn ngoài phạm vi hiện tại.', normalized);
  }
  if (hasSensitiveReference(normalized)) {
    return decision('medium', 'sensitive-path', 'Câu lệnh có thể truy cập tệp hoặc dữ liệu nhạy cảm.', normalized);
  }
  if (!validCwd(cwd)) {
    return decision('unknown', 'missing-cwd', 'Không xác định được thư mục làm việc tuyệt đối.', normalized);
  }

  const tokens = tokenize(normalized);
  if (!tokens || tokens.length === 0) {
    return decision('unknown', 'unparseable-command', 'Không thể phân tích câu lệnh một cách chắc chắn.', normalized);
  }

  const exact = normalized.toLowerCase();
  if (exact === 'pwd' || exact === 'get-location') {
    return decision('low', 'allow-current-directory', 'Chỉ đọc thư mục làm việc hiện tại.', normalized);
  }

  const safeRule = classifyGit(tokens) || classifyListing(tokens) || classifyRipgrep(tokens) || classifyNodeCheck(tokens);
  if (safeRule) return decision('low', safeRule.ruleId, safeRule.reason, normalized);

  const targetName = typeof target === 'string' && target ? ` trên ${target}` : '';
  return decision('unknown', 'not-allowlisted', `Lệnh không nằm trong allowlist an toàn${targetName}.`, normalized);
}

module.exports = {
  evaluateCommand,
  normalizeCommand,
  redactSensitive
};

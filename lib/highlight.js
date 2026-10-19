/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * highlight.js — Tokenizer syntax highlighting
 * parser markdown (teks/code/tabel) -> submessages WA
 * Thanks to XN for helping this part
 * [UPDATE AND FIX BELOW]
*/
export const LANGS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  json: 'JSON', html: 'HTML', htm: 'HTML',
  py: 'Python', md: 'Markdown', sh: 'Bash',
  yml: 'Yaml', yaml: 'Yaml', ts: 'TypeScript'
};

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'async', 'await', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'import',
  'export', 'from', 'default', 'class', 'extends', 'new', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'yield', 'static', 'get', 'set', 'this', 'super', 'null', 'undefined',
  'true', 'false'
]);

// [UPDATE] highlightType proto WA: 0 default • 1 keyword • 2 method • 3 string • 4 number • 5 comment
export function tokenize(code) {
  const blocks = [];
  const push = (type, content) => {
    if (!content) return;
    const last = blocks[blocks.length - 1];
    if (last && last.highlightType === type) last.codeContent += content;
    else blocks.push({ highlightType: type, codeContent: content });
  };

  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];

    if (c === '/' && code[i + 1] === '/') {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      push(5, code.slice(i, j));
      i = j;
      continue;
    }

    if (c === '/' && code[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      push(5, code.slice(i, j));
      i = j;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n && code[j] !== q) {
        if (code[j] === '\\') j++;
        j++;
      }
      j = Math.min(n, j + 1);
      push(3, code.slice(i, j));
      i = j;
      continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9._xXa-fA-F]/.test(code[j])) j++;
      push(4, code.slice(i, j));
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      let k = j;
      while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
      if (KEYWORDS.has(word)) push(1, word);
      else if (code[k] === '(') push(2, word);
      else push(0, word);
      i = j;
      continue;
    }

    push(0, c);
    i++;
  }
  return blocks;
}

// ===== [FIX] util tabel markdown =====
function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

function isSepLine(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function isRowLine(line) {
  const t = line.trim();
  return t.startsWith('|') && t.slice(1).includes('|');
}

// [FIX] Pecah markdown LLM -> bagian text / code / table
export function parseMarkdown(md) {
  const parts = [];
  const pushText = (t) => {
    if (t && t.trim()) parts.push({ type: 'text', text: t });
  };

  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  const segments = [];
  while ((m = re.exec(md))) {
    if (m.index > last) segments.push({ kind: 'text', data: md.slice(last, m.index) });
    segments.push({ kind: 'code', lang: (m[1] || '').toLowerCase(), data: m[2] });
    last = m.index + m[0].length;
  }
  if (last < md.length) segments.push({ kind: 'text', data: md.slice(last) });

  for (const seg of segments) {
    if (seg.kind === 'code') {
      parts.push({ type: 'code', lang: seg.lang, code: seg.data });
      continue;
    }

    const lines = seg.data.split('\n');
    let textBuf = [];
    let tableBuf = [];

    const flushTable = () => {
      if (!tableBuf.length) return;
      if (tableBuf.length >= 2 && isSepLine(tableBuf[1])) {
        pushText(textBuf.join('\n'));
        textBuf = [];
        const rows = tableBuf.filter((l) => !isSepLine(l)).map(splitRow);
        if (rows.length >= 2) parts.push({ type: 'table', rows });
        else pushText(rows.map((r) => r.join(' | ')).join('\n'));
      } else {
        textBuf.push(...tableBuf);
      }
      tableBuf = [];
    };

    for (const line of lines) {
      if (isRowLine(line)) tableBuf.push(line);
      else {
        flushTable();
        textBuf.push(line);
      }
    }
    flushTable();
    pushText(textBuf.join('\n'));
  }

  return parts;
}

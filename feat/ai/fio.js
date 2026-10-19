
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../config.js';
import { orca, CLAIDE_AI_PERSONA, ORCA_CONFIG, jina } from '../../config/ai/orca.js';
import { tokenize, LANGS, parseMarkdown } from '../../lib/highlight.js';
import { assertPublicHttpUrl, fetchPublicText } from '../../lib/urlSafety.js';
const PROJECT_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CODE = 12000;
const MAX_TEXT = 3500;
const MAX_CTX = 5000;
const MEM = (globalThis.CLAIDE_AI_MEM ??= new Map());
const MEM_CAP = 8;

const isCodeRequest = (q) => /\b(kode|code|html|css|javascript|js|script|game)\b/i.test(q);
function codeSubmessage(code, lang) {
  let src = code;
  let truncated = false;
  if (src.length > MAX_CODE) {
    src = src.slice(0, MAX_CODE);
    truncated = true;
  }
  const blocks = tokenize(src);
  if (truncated) blocks.push({ highlightType: 5, codeContent: '\n// … (terpotong)' });
  return {
    messageType: 5,
    codeMetadata: { codeLanguage: LANGS[lang] || lang || 'javascript', codeBlocks: blocks }
  };
}
function tableSubmessage(rows) {
  const clean = rows.map((r, i) => ({ items: r, isHeading: i === 0 }));
  return { messageType: 4, tableMetadata: { rows: clean } };
}
function fileSummaryTable(file) {
  return {
    messageType: 4,
    tableMetadata: {
      title: 'Ringkasan File',
      rows: [
        { items: ['Properti', 'Nilai'], isHeading: true },
        { items: ['Nama', file.name], isHeading: false },
        { items: ['Path', file.safe], isHeading: false },
        { items: ['Bahasa', LANGS[file.ext] || file.ext], isHeading: false },
        { items: ['Ukuran', (file.code.length / 1024).toFixed(1) + ' KB'], isHeading: false },
        { items: ['Baris', String(file.code.split('\n').length)], isHeading: false }
      ]
    }
  };
}
function formatSearch(text) {
  const items = [];
  const re = /\[(\d+)\] Title:\s*(.+)\n\[\1\] URL Source:\s*(.+)(?:\n\[\1\] Description:\s*(.+))?/g;
  let m;
  while ((m = re.exec(text))) {
    items.push({
      n: m[1],
      title: m[2].trim(),
      url: m[3].trim(),
      desc: (m[4] || '').trim()
    });
  }
  if (!items.length) return null;
  let out = '';
  for (const it of items.slice(0, 6)) {
    out += '*' + it.n + '. ' + it.title + '*\n' + it.url + (it.desc ? '\n' + it.desc : '') + '\n\n';
  }
  return out.trim();
}
function chunkText(t, n) {
  const parts = [];
  for (let i = 0; i < t.length; i += n) parts.push(t.slice(i, i + n));
  return parts;
}
const SKIP_DIR = new Set(['node_modules', '.git', 'session', 'tmp', 'dist', 'coverage', 'archives', 'logs']);
const BLOCKED_FILE = /^(?:config(?:\.js|\.example\.js)?|sync_config(?:\.jsonc)?|package(?:-lock)?\.json|\.env(?:\..*)?|.*\.(?:pem|key|crt|sqlite|db))$/i;
function isInsideProject(candidate) {
  const relative = path.relative(PROJECT_ROOT, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function walk(dir, out = [], depth = 0) {
  if (depth > 5) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, out, depth + 1);
    } else {
      out.push(absolutePath);
    }
  }
  return out;
}
function detectFile(query) {
  const match =
    query.match(/([\w@.-]+(?:\/[\w@.-]+)+\.(?:js|mjs|cjs|json|html?|py|md|sh|ya?ml|ts))/i) ||
    query.match(/([\w@.-]+\.(?:js|mjs|cjs|json|html?|py|md|sh|ya?ml|ts))/i);
  if (!match) return null;
  const wanted = path.normalize(match[1]);
  const wantedBase = path.basename(wanted).toLowerCase();
  if (BLOCKED_FILE.test(wantedBase)) return null;
  const candidates = [path.resolve(PROJECT_ROOT, wanted)];
  for (const file of walk(PROJECT_ROOT)) {
    const relative = path.relative(PROJECT_ROOT, file);
    if (relative.endsWith(wanted) || path.basename(file).toLowerCase() === wantedBase) {
      candidates.push(file);
    }
  }
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (!isInsideProject(real) || BLOCKED_FILE.test(path.basename(real))) continue;
      const stat = fs.statSync(real);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const raw = fs.readFileSync(real);
      if (raw.includes(0)) continue;
      return {
        safe: path.relative(PROJECT_ROOT, real),
        name: path.basename(real),
        code: raw.toString('utf8'),
        ext: (path.extname(real).slice(1) || 'txt').toLowerCase()
      };
    } catch {}
  }
  return null;
}
async function extractImage(ctx) {
  const msg = ctx.event?.message;
  if (!msg) return null;
  if (msg.imageMessage) {
    try {
      const buf = await ctx.client.message.downloadBytes(msg, {
        maxBytes: 6 * 1024 * 1024,
        timeoutMs: 30_000,
        signal: AbortSignal.timeout(35_000)
      });
      if (buf && buf.length) {
        const mime = (msg.imageMessage.mimetype || 'image/jpeg').split(';')[0];
        return 'data:' + mime + ';base64,' + buf.toString('base64');
      }
    } catch {}
  }
  const ci = msg.extendedTextMessage?.contextInfo || null;
  const qm = ci?.quotedMessage;
  if (qm && qm.imageMessage) {
    try {
      const buf = await ctx.client.message.downloadBytes(qm, {
        maxBytes: 6 * 1024 * 1024,
        timeoutMs: 30_000,
        signal: AbortSignal.timeout(35_000)
      });
      if (buf && buf.length) {
        const mime = (qm.imageMessage.mimetype || 'image/jpeg').split(';')[0];
        return 'data:' + mime + ';base64,' + buf.toString('base64');
      }
    } catch {}
  }
  return null;
}
function extractUrl(query) {
  let url = null;
  const withScheme = query.match(/https?:\/\/\S+/i);
  if (withScheme) {
    url = withScheme[0];
  } else {
    const bare = query.match(
      /(?:^|\s)((?:www\.)?(?:[\w-]+\.)+(?:com|net|org|id|io|ai|co|dev|me|info|xyz|us|my|sg|to|app|gg|tv|cc)(?:\/\S*)?)(?=\s|$)/i
    );
    if (bare) url = 'https://' + bare[1];
  }
  if (url) url = url.replace(/[?!.,;:)'"\]]+$/g, '');
  return url;
}
async function readPage(url) {
  let safeUrl;
  try {
    safeUrl = await assertPublicHttpUrl(url);
  } catch {
    return null;
  }
  const viaJina = await jina.read(safeUrl.href, MAX_CTX);
  if (viaJina) return viaJina;
  try {
    const result = await fetchPublicText(safeUrl, {
      maxBytes: 1024 * 1024,
      timeoutMs: 15_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaideBot/1.0)' }
    });
    if (!result.response.ok) return null;
    const type = result.response.headers.get('content-type') || '';
    const raw = result.text;
    if (!type.includes('html')) return raw.slice(0, MAX_CTX);
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text.slice(0, MAX_CTX);
  } catch {
    return null;
  }
}
function realTimeContext() {
  const now = new Date();
  const hari = now.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });
  const tgl = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const jam = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  return (
    '\n\nKONTEKS WAKTU REAL-TIME: Hari ini ' + hari + ', ' + tgl +
    ', jam ' + jam + ' (zona Asia/Jakarta). Pakai ini kalau ditanya soal waktu, tanggal, atau kabar terbaru.'
  );
}
const FOOTER = '\n> _*Made with ♡ by Alfi*_\n> _*Powered by Claide Bot by Alfi*_';
export default {
  name: 'fio',
  aliases: ['ai', 'clai', 'claude', 'tanya'],
  tags: 'ai',
  description: 'Ngobrol sama Claide AI',
  async run(ctx) {
    const query = (ctx.text || '').trim();
    if (/^(reset|mulai( ulang)?|lupakan)/i.test(query)) {
      MEM.delete(ctx.sender);
      return ctx.reply('🧠 Sesi Claide AI di-reset. Mulai obrolan baru yuk!');
    }
    const image = await extractImage(ctx);
    if (!query && !image) {
      return ctx.reply(
        '🤖 *CLAIDE AI*\n\n' +
        'Mau ngobrol apa, King?\n\n' +
        '*Contoh:*\n' +
        '• `.fio siapa kamu?`\n' +
        '• `.fio ambil file math.js`\n' +
        '• `.fio rangkum https://...`\n' +
        '• `.fio buka dokumentasi Claide Bot`\n' +
        '• `.fio cari berita Persija terbaru`\n' +
        '• `.fio buatkan kode HTML game raid`\n' +
        '• Reply foto + `.fio ini foto apa?`\n' +
        '• `.fio reset` (mulai sesi baru)'
      );
    }
    await ctx.react('🤖');
    let pageRaw = null;
    let searchRaw = null;
    try {
      const file = (query && ctx.isOwner) ? detectFile(query) : null;
      if (file && /\b(ambil(kan|in)?|kirim(kan)?|lihat|tunjuk(in)?|show|display|kasih)\b/i.test(query)) {
        await ctx.client.message.send(ctx.chat, {
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                messageType: 1,
                submessages: [
                  {
                    messageType: 2,
                    messageText:
                      '🤖 *CLAIDE AI* — _File Protocol_\n' +
                      '✅ File `' + file.name + '` sudah diambil lengkap, Bos!\n\n' +
                      '📄 *Isi File:*'
                  },
                  codeSubmessage(file.code, file.ext),
                  fileSummaryTable(file),
                  { messageType: 2, messageText: FOOTER }
                ],
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                  forwardOrigin: 4
                }
              }
            }
          }
        }, { additionalAttributes: { type: 'text' } });
        await ctx.react('📎');
        return;
      }
      if (image && !ORCA_CONFIG.visionModel) {
        return ctx.reply(
          '👁️ Vision belum aktif, King.\n\n' +
          'Model free `rahasia_hehe` itu *text-only*.\n' +
          'Fitur masih tahap dikembangkan Owner, jadi sabar ya, Kak hihi...\n\n' +
          'Format kirim gambarnya udah bener kok, tinggal modelnya 😌'
        );
      }
      const toolContext = [];
      if (file) {
        toolContext.push('FILE INTERNAL BOT: ' + file.safe + '\n"""\n' + file.code.slice(0, MAX_CTX) + '\n"""');
      }
      const url = query ? extractUrl(query) : null;
      if (url) {
        pageRaw = await readPage(url);
        if (pageRaw) {
          toolContext.push('KONTEN URL ' + url + ':\n' + pageRaw);
        } else {
          toolContext.push(
            'CATATAN: konten URL ' + url + ' gagal diambil (diblokir situs/rate-limit). ' +
            'Jangan hallucinate; bilang jujur kalau gak bisa baca isinya dan minta user paste bagian pentingnya.'
          );
        }
      } else if (query && /\b(cari(in)?|search|googling|google)\b/i.test(query)) {
        const q = query.replace(/\b(cari(in)?|search|googling|google)\b\s*/i, '').trim() || query;
        searchRaw = await jina.search(q, MAX_CTX);
        if (searchRaw) {
          toolContext.push('HASIL SEARCH WEB LIVE (Jina):\n' + searchRaw);
        } else {
          toolContext.push(
            'CATATAN: pencarian web live gak tersedia saat ini, mungkin limit jadi coba kembali nanti. ' +
            'Jangan hallucinate; kalau gak yakin, bilang jujur dan minta user kasih link.'
          );
        }
      }
      const messages = [{ role: 'system', content: CLAIDE_AI_PERSONA + realTimeContext() }];
      const hist = MEM.get(ctx.sender) || [];
      messages.push(...hist);
      if (toolContext.length) {
        messages.push({
          role: 'system',
          content: 'KONTEKS LIVE (hasil tools, pakai sebagai rujukan):\n\n' + toolContext.join('\n\n')
        });
      }
      let userContent;
      if (image && query) userContent = orca.visionMessage(image, query);
      else if (image) userContent = orca.visionMessage(image, 'Deskripsiin gambar ini detail dalam bahasa Indonesia.');
      else userContent = { role: 'user', content: query };
      messages.push(userContent);
      
      const codeMode = Boolean(query && !image && isCodeRequest(query));
      let result = await orca.chat(messages, {
        model: image ? ORCA_CONFIG.visionModel : undefined,
        enable_reasoning: !codeMode,
        max_tokens: codeMode ? 4000 : 2000
      });
      
      if (!result.text || !result.text.trim()) {
        result = await orca.chat(messages, { enable_reasoning: false, max_tokens: 4000 });
      }
      
      if (!result.text || !result.text.trim()) {
        await ctx.react('❎');
        return ctx.reply('⚠️ Modelnya kehabisan napas tadi (response kosong). Coba ulang sekali lagi ya, Kak 🙏');
      }
      const newHist = MEM.get(ctx.sender) || [];
      newHist.push({ role: 'user', content: query || '[user mengirim gambar]' });
      newHist.push({ role: 'assistant', content: (result.text || '').slice(0, 1200) });
      while (newHist.length > MEM_CAP) newHist.shift();
      MEM.set(ctx.sender, newHist);
      const submessages = [];
      submessages.push({
        messageType: 2,
        messageText:
          '🤖 *CLAIDE AI* — _' + (image ? 'Vision Mode' : 'Chat Mode') + '_' +
          (file ? '\n📎 File Protocol aktif' : '') +
          (toolContext.length && !file ? '\n🌐 Live context aktif' : '')
      });
      let contentCount = 0;
      for (const part of parseMarkdown(result.text)) {
        if (part.type === 'text') {
          const chunks = chunkText(part.text.trim(), MAX_TEXT).slice(0, 6);
          for (const c of chunks) {
            submessages.push({ messageType: 2, messageText: c });
            contentCount++;
          }
        } else if (part.type === 'code') {
          submessages.push(codeSubmessage(part.code, part.lang));
          contentCount++;
        } else if (part.type === 'table') {
          submessages.push(tableSubmessage(part.rows));
          contentCount++;
        }
      }
      
      if (contentCount === 0) {
        const chunks = chunkText(result.text.trim(), MAX_TEXT).slice(0, 6);
        for (const c of chunks) submessages.push({ messageType: 2, messageText: c });
      }
      if (file) {
        submessages.push({ messageType: 2, messageText: '📄 *Isi File:* `' + file.name + '`' });
        submessages.push(codeSubmessage(file.code, file.ext));
        submessages.push(fileSummaryTable(file));
      }
      submessages.push({ messageType: 2, messageText: FOOTER });
      await ctx.client.message.send(ctx.chat, {
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 1,
              submessages,
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                forwardOrigin: 4
              }
            }
          }
        }
      }, { additionalAttributes: { type: 'text' } });
      await ctx.react('✨');
    } catch (e) {
      const msg = String(e.message || e);
      
      if (msg.includes('PROVIDER_BUSY')) {
        try {
          if (searchRaw) {
            const fmt = formatSearch(searchRaw);
            if (fmt) {
              await ctx.client.message.send(ctx.chat, {
                botForwardedMessage: {
                  message: {
                    richResponseMessage: {
                      messageType: 1,
                      submessages: [
                        {
                          messageType: 2,
                          messageText:
                            '🔎 *CLAIDE AI* — _Mode Darurat_\n' +
                            'LLM-nya lagi teler, jadi ini hasil search mentah via Jina 🙏\n\n' + fmt
                        },
                        { messageType: 2, messageText: FOOTER }
                      ],
                      contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                        forwardOrigin: 4
                      }
                    }
                  }
                }
              }, { additionalAttributes: { type: 'text' } });
              await ctx.react('🔎');
              return;
            }
          }
          if (pageRaw) {
            const chunks = chunkText(pageRaw, MAX_TEXT).slice(0, 3);
            const subs = [
              {
                messageType: 2,
                messageText:
                  '🌐 *CLAIDE AI* — _Mode Darurat_\n' +
                  'LLM-nya lagi teler, jadi ini konten halaman mentah via Jina Reader 🙏'
              }
            ];
            for (const c of chunks) subs.push({ messageType: 2, messageText: c });
            subs.push({ messageType: 2, messageText: FOOTER });
            await ctx.client.message.send(ctx.chat, {
              botForwardedMessage: {
                message: {
                  richResponseMessage: {
                    messageType: 1,
                    submessages: subs,
                    contextInfo: {
                      forwardingScore: 999,
                      isForwarded: true,
                      forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                      forwardOrigin: 4
                    }
                  }
                }
              }
            }, { additionalAttributes: { type: 'text' } });
            await ctx.react('🌐');
            return;
          }
        } catch {}
        await ctx.react('❎');
        return ctx.reply('⚠️ Provider AI-nya lagi teler (free tier emang rame). Coba ulang beberapa detik lagi ya, Kak. 🙏');
      }
      await ctx.react('❎');
      const friendly = e?.code === 'PROVIDER_NOT_CONFIGURED'
        ? '⚙️ Claide AI belum dikonfigurasi. Owner perlu mengatur `ORCA_API_URL`, `ORCA_API_KEY`, dan `ORCA_MODEL`.'
        : '*Maaf Error:* ' + msg.slice(0, 300);
      await ctx.reply(friendly);
    }
  }
};
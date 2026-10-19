
import { duckAiChat, fetchDuckAiModels, DUCKAI_DEFAULT_MODEL } from '../../src/clients/duckai.js';
import { tokenize, LANGS } from '../../lib/highlight.js';
import { resolveMediaPayload } from 'zapo-js';
const MAX_CODE = 24000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 3500;
const MEM = (globalThis.CLAIDE_BEBEK_MEM ??= new Map());
const MODEL_CHOICE = (globalThis.CLAIDE_BEBEK_MODEL ??= new Map());
const MEM_CAP = 8;
const BEBEK_PERSONA = `Kamu adalah Bebek, asisten AI santai nan gaul yang ditenagai Duck.ai. Kamu memiliki sifat ceria, ramah, asik, seru untuk diajak ngobrol, tetapi dapat serius juga sesuai konteks user, utamakan sifat sikap ceria dan ramah dirimu dahulu.
Gaya: bahasa Indonesia gaul natural (lo-gue / aku-kamu sesuai konteks), emoji seperlunya, jangan kaku.
Kalau diminta kode, SELALU bungkus dalam code fence \`\`\`bahasa agar sistem bisa merender code block berwarna.
Kalau diminta tabel, SELALU pakai markdown table (| kolom |).
Jangan hallucinate; kalau gak yakin bilang jujur.
JANGAN pakai tag <citation> atau markup aneh lainnya di jawaban.`;

function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null;
}
function getContextInfo(message) {
  if (!message) return null;
  for (const key of Object.keys(message)) {
    const node = message[key];
    if (node && typeof node === 'object' && node.contextInfo) {
      return node.contextInfo;
    }
  }
  return null;
}
async function extractImage(ctx) {
  const event = getEvent(ctx);
  if (!event) return null;
  const rawMessage = event.message ?? event;
  const contextInfo = getContextInfo(rawMessage);
  const targetMessage = contextInfo?.quotedMessage || rawMessage;
  const payload = targetMessage && resolveMediaPayload(targetMessage);
  if (!payload?.mimetype || !String(payload.mimetype).startsWith('image/')) return null;
  try {
    const buffer = await ctx.client.message.downloadBytes(targetMessage, {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 30_000,
      signal: AbortSignal.timeout(35_000),
    });
    return buffer?.length ? { buf: Buffer.from(buffer), mime: String(payload.mimetype).split(';')[0] } : null;
  } catch (error) {
    console.log('[Bebek] download image gagal:', error.message || error);
    return null;
  }
}

async function toImagePart(raw) {
  if (!raw) return null;
  let buf = raw.buf;
  let mime = raw.mime;
  try {
    const sharp = (await import('sharp')).default;
    buf = await sharp(buf)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    mime = 'image/webp';
  } catch (e) {
    console.log('[Bebek] webp re-encode gagal, pakai format asli:', e.message || e);
  }
  const part = { type: 'image', mimeType: mime, image: `data:${mime};base64,${buf.toString('base64')}` };
  console.log('[Bebek] image part:', part.mimeType, Math.round(part.image.length / 1024) + 'KB');
  return part;
}

function cleanMarkdown(t) {
  return String(t)
    .replace(/<citation[^>]*>\s*<\/citation>/gi, '')
    .replace(/<citation[^>]*\/?>/gi, '')
    .replace(/<\/?(url|source|ref|turn\d+)[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/__([^_]+)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/^[\s]*[-•]\s+/gm, '• ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function codeSubmessage(code, lang) {
  let src = code;
  let truncated = false;
  if (src.length > MAX_CODE) { src = src.slice(0, MAX_CODE); truncated = true; }
  const blocks = tokenize(src);
  if (truncated) blocks.push({ highlightType: 5, codeContent: '\n// … (terpotong)' });
  return { messageType: 5, codeMetadata: { codeLanguage: LANGS[lang] || lang || 'javascript', codeBlocks: blocks } };
}
function tableSubmessage(rows) {
  return { messageType: 4, tableMetadata: { rows: rows.map((r, i) => ({ items: r, isHeading: i === 0 })) } };
}
function detectLang(code) {
  if (/<\/?[a-z!][^>]*>/i.test(code) && /<html|<div|<body|<script|<style|<canvas/i.test(code)) return 'html';
  if (/\bdef \w+\(|import numpy|print\(/.test(code)) return 'python';
  if (/^\s*[\{\[]/.test(code.trim()) && /["']\s*:/.test(code)) return 'json';
  return 'javascript';
}
function looksLikeCode(t) {
  const markers = (t.match(/(;|\{|\}|\bfunction\b|\bconst\b|\breturn\b|=>)/g) || []).length;
  return markers >= 6 && /[{};]/.test(t) && t.length > 150;
}
function splitRow(line) { return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()); }
function isSepLine(line) { return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-'); }
function isRowLine(line) { const t = line.trim(); return t.startsWith('|') && t.slice(1).includes('|'); }
function extractTables(text) {
  const out = [];
  let buf = [];
  let tbl = [];
  const flush = () => {
    if (tbl.length >= 2 && isSepLine(tbl[1])) {
      const t = buf.join('\n').trim();
      if (t) out.push({ type: 'text', text: t });
      buf = [];
      const rows = tbl.filter((l) => !isSepLine(l)).map(splitRow);
      if (rows.length >= 2) out.push({ type: 'table', rows });
    } else buf.push(...tbl);
    tbl = [];
  };
  for (const line of text.split('\n')) {
    if (isRowLine(line)) tbl.push(line);
    else { flush(); buf.push(line); }
  }
  flush();
  const t = buf.join('\n').trim();
  if (t) out.push({ type: 'text', text: t });
  return out;
}
function parseRich(md) {
  const parts = [];
  let buf = [];
  let codeBuf = null;
  let codeLang = '';
  let open = false;
  const flushText = () => {
    const t = buf.join('\n').trim();
    buf = [];
    if (t) parts.push(...extractTables(t));
  };
  for (const line of md.split('\n')) {
    const fm = line.match(/^\s*```(\w*)\s*$/);
    if (fm && !open) { flushText(); open = true; codeLang = (fm[1] || '').toLowerCase(); codeBuf = []; continue; }
    if (fm && open) { parts.push({ type: 'code', lang: codeLang || detectLang(codeBuf.join('\n')), code: codeBuf.join('\n') }); open = false; codeBuf = null; continue; }
    if (open) codeBuf.push(line);
    else buf.push(line);
  }
  if (open && codeBuf) parts.push({ type: 'code', lang: codeLang || detectLang(codeBuf.join('\n')), code: codeBuf.join('\n') });
  flushText();
  return parts.map((p) => (p.type === 'text' && looksLikeCode(p.text) ? { type: 'code', lang: detectLang(p.text), code: p.text } : p));
}
function chunkText(t, n) { const p = []; for (let i = 0; i < t.length; i += n) p.push(t.slice(i, i + n)); return p; }
const FOOTER = '\n> _*🦆 Bebek AI • Duck.ai Engine*_\n> _*Claide Bot by Alfi*_';
function sendRich(ctx, submessages) {
  return ctx.client.message.send(ctx.chat, {
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
}

async function prepareGeneratedImages(genImages) {
  const out = [];
  for (const g of genImages) {
    try {
      const buf = Buffer.from(g.b64Image, 'base64');
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) continue;
      let w = g.width || 0;
      let h = g.height || 0;
      try {
        const sharp = (await import('sharp')).default;
        const md = await sharp(buf).metadata();
        if (md.width && md.height) { w = md.width; h = md.height; }
      } catch {}
      out.push({
        buf,
        mime: 'image/' + (g.format || 'jpeg'),
        w,
        h,
        title: g.title || '',
        model: g.imageModelDisplayName || 'GPT Image 2',
        ms: g.generationDurationMs || 0
      });
    } catch (e) {
      console.log('[Bebek] prepare image gen gagal:', e.message || e);
    }
  }
  return out;
}
export default {
  name: 'bebek',
  aliases: ['ddg', 'luna', 'duck'],
  tags: 'ai',
  description: 'AI smart nan lucu bernama Bebek',
  async run(ctx) {
    const query = (ctx.text || '').trim();
    
    if (/^models?$/i.test(query)) {
      const models = await fetchDuckAiModels();
      const rows = [[ 'Model ID', 'Nama', 'Vision' ]];
      for (const model of models) rows.push([model.id, model.name, model.capabilities?.images ? '✅' : '—']);
      await sendRich(ctx, [
        { messageType: 2, messageText: '🦆 *BEBEK AI* — _Model tersedia di Duck.ai_\nPakai: `.bebek pakai <model id>`' },
        tableSubmessage(rows),
        { messageType: 2, messageText: FOOTER }
      ]);
      return;
    }
    if (/^pakai\s+(.+)/i.test(query)) {
      const id = query.match(/^pakai\s+(.+)/i)[1].trim();
      MODEL_CHOICE.set(ctx.sender, id);
      return ctx.reply(`🦆 Oke, model diset ke *${id}* buat sesi lo!`);
    }
    if (/^(reset|mulai( ulang)?|lupakan)/i.test(query)) {
      MEM.delete(ctx.sender);
      return ctx.reply('🧠 Sesi Bebek di-reset!');
    }
    const rawImage = await extractImage(ctx);
    const imgPart = await toImagePart(rawImage);
    const hasImage = Boolean(imgPart);
    if (!query && !hasImage) {
      return ctx.reply(
        '🦆 *BEBEK AI* — _Duck.ai Engine_\n\n' +
        'AI alternatif dari Claide AI.\n\n' +
        '*Contoh:*\n' +
        '• `.bebek siapa kamu?`\n' +
        '• `.bebek models` (lihat model)\n' +
        '• `.bebek pakai gpt-5.6-luna`\n' +
        '• `.bebek buatkan kode HTML game`\n' +
        '• `.bebek buatkan gambar kucing pakai batik, ratio 9:16`\n' +
        '• Reply foto + `.bebek ini apa?`\n' +
        '• `.bebek reset`'
      );
    }
    await ctx.react('🦆');
    try {
      const model = MODEL_CHOICE.get(ctx.sender) || DUCKAI_DEFAULT_MODEL;
      const hist = MEM.get(ctx.sender) || [];
      const messages = [];
      const firstText = BEBEK_PERSONA + '\n\n---\n\n' + (hist.length ? hist[0].content : query);
      if (hist.length) {
        messages.push({ role: 'user', content: [{ type: 'text', text: firstText }] });
        for (let i = 1; i < hist.length; i++) {
          messages.push({ role: hist[i].role, content: [{ type: 'text', text: hist[i].content }] });
        }
        const content = [{ type: 'text', text: query }];
        if (imgPart) content.push(imgPart);
        messages.push({ role: 'user', content });
      } else {
        const content = [{ type: 'text', text: firstText }];
        if (imgPart) content.push(imgPart);
        messages.push({ role: 'user', content });
      }
      const result = await duckAiChat(messages, { model });
      const preparedImages = await prepareGeneratedImages(result.images || []);
      const newHist = MEM.get(ctx.sender) || [];
      newHist.push({ role: 'user', content: query || '[user mengirim gambar]' });
      newHist.push({ role: 'assistant', content: (result.text || '').slice(0, 1200) });
      while (newHist.length > MEM_CAP) newHist.shift();
      MEM.set(ctx.sender, newHist);
      const submessages = [];
      submessages.push({
        messageType: 2,
        messageText: '🦆 *BEBEK AI* — _' + (hasImage ? 'Vision Mode' : 'Chat Mode') + '_\n⚙️ ' + model
      });
      
      if (preparedImages.length) {
        const g = preparedImages[0];
        submessages.push({
          messageType: 2,
          messageText:
            '🎨 *Image Generated* — _' + g.model + '_\n' +
            (g.title ? cleanMarkdown(g.title) + '\n' : '') +
            '⏱ ' + Math.round(g.ms / 1000) + 's • ' + g.w + '×' + g.h
        });
      }
      let contentCount = 0;
      for (const part of parseRich(result.text)) {
        if (part.type === 'text') {
          const cleaned = cleanMarkdown(part.text);
          for (const c of chunkText(cleaned, MAX_TEXT).slice(0, 6)) {
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
      if (contentCount === 0 && !preparedImages.length) {
        const cleaned = cleanMarkdown(result.text);
        for (const c of chunkText(cleaned, MAX_TEXT).slice(0, 6)) {
          submessages.push({ messageType: 2, messageText: c });
        }
      }
      submessages.push({ messageType: 2, messageText: FOOTER });
      await sendRich(ctx, submessages);
      
      for (const g of preparedImages) {
        try {
          await ctx.client.message.send(ctx.chat, {
            type: 'image',
            media: g.buf,
            mimetype: g.mime,
            caption:
              '🎨 *BEBEK AI • Image Gen*\n' +
              '_' + g.model + '_\n' +
              (g.title ? cleanMarkdown(g.title) + '\n' : '') +
              g.w + '×' + g.h
          });
        } catch (e) {
          console.log('[Bebek] kirim image gen gagal:', e.message || e);
        }
      }
      await ctx.react(preparedImages.length ? '🎨' : '✨');
    } catch (e) {
      await ctx.react('❎');
      const message = e?.code === 'PROVIDER_NOT_CONFIGURED'
        ? '⚙️ Bebek AI belum dikonfigurasi. Owner perlu mengatur `DUCKAI_API_URL`, `DUCKAI_API_KEY`, dan `DUCKAI_MODEL`.'
        : '*Maaf Error:* ' + String(e.message || e).slice(0, 300);
      await ctx.reply(message);
    }
  }
};
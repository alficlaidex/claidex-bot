
import fs from 'node:fs';
import path from 'node:path';
import { tokenize, LANGS } from '../../lib/highlight.js';
export default {
  name: 'aicode',
  aliases: ['ambil'],
  tags: 'tools',
  owner: true,
  description: 'Fiony AI: ambil file & kirim kode dengan format rich response',
  async run(ctx) {
    let input = (ctx.text || '').trim();
    input = input.replace(/^ambil\s+/i, '');
    if (!input) {
      return ctx.reply(
        '🤖 *FIONY AI* — _File Protocol_\n\n' +
        'Mau ambil file apa, Bos?\n\n' +
        '*Contoh:*\n.aicode feat/game/snake.js'
      );
    }
    const cwd = process.cwd();
    const safe = path.normalize(input).replace(/^(\.\.[\/\\])+/, '');
    const full = path.resolve(cwd, safe);
    if (full !== cwd && !full.startsWith(cwd + path.sep)) {
      return ctx.reply('⚠️ Path di luar direktori bot gak diizinkan.');
    }
    
    
    
    
    const rel = path.relative(cwd, full).split(path.sep).join('/');
    const denied =
      /(^|\/)\.env(\.|\/|$)/i.test(rel) ||
      rel.startsWith('session/') ||
      rel.startsWith('node_modules/') ||
      /(^|\/)\.git(\/|$)/i.test(rel) ||
      /\.(sqlite|db)(-wal|-shm)?$/i.test(rel);
    if (denied) {
      return ctx.reply('🚫 File ini tidak bisa ditampilkan (berisi credential/data sesi).');
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return ctx.reply('❌ File gak ditemukan: `' + safe + '`');
    }
    const raw = fs.readFileSync(full);
    if (raw.includes(0)) {
      return ctx.reply('📦 File terdeteksi biner, gak bisa ditampilkan.');
    }
    let code = raw.toString('utf8');
    const totalLen = code.length;
    const totalLines = code.split('\n').length;
    const MAX = 6000;
    let truncated = false;
    if (code.length > MAX) {
      code = code.slice(0, MAX);
      truncated = true;
    }
    const blocks = tokenize(code);
    if (truncated) {
      blocks.push({
        highlightType: 5,
        codeContent: '\n// … (terpotong — file asli ' + totalLen + ' karakter)'
      });
    }
    const ext = (path.extname(full).slice(1) || 'txt').toLowerCase();
    const lang = LANGS[ext] || ext;
    const name = path.basename(full);
    await ctx.client.message.send(ctx.chat, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              {
                messageType: 2,
                messageText:
                  '🤖 *FIONY AI* — _File Protocol_\n' +
                  '✅ File `' + name + '` sudah diambil lengkap!\n\n' +
                  '📄 *Isi File:*'
              },
              {
                messageType: 5,
                codeMetadata: { codeLanguage: lang, codeBlocks: blocks }
              },
              {
                messageType: 4,
                tableMetadata: {
                  title: 'Ringkasan File',
                  rows: [
                    { items: ['Properti', 'Nilai'], isHeading: true },
                    { items: ['Nama', name], isHeading: false },
                    { items: ['Path', safe], isHeading: false },
                    { items: ['Bahasa', lang], isHeading: false },
                    { items: ['Ukuran', (totalLen / 1024).toFixed(1) + ' KB'], isHeading: false },
                    { items: ['Baris', String(totalLines)], isHeading: false }
                  ]
                }
              },
              {
                messageType: 2,
                messageText: '\n> _*Made with♡ by JamvanHax0r*_\n> _*Powered by FionyVerse*_'
              }
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
    await ctx.react('🤖');
  }
};

import sharp from 'sharp';
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js';
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
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function generateProfilePicture(buffer) {
  return sharp(buffer)
    .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}
export default {
  name: 'setpp',
  aliases: ['setprofile', 'setppbot'],
  tags: 'owner',
  owner: true,
  description: 'Ganti foto profil bot sesuai gambar yang di-reply',
  async run(ctx) {
    const event = getEvent(ctx);
    const rawMessage = event?.message ?? event;
    const ctxInfo = getContextInfo(rawMessage);
    const targetMessage = ctxInfo?.quotedMessage || rawMessage;
    const payload = targetMessage && resolveMediaPayload(targetMessage);
    const isImage = payload?.mimetype?.startsWith('image/') && !payload.mimetype.includes('webp');
    if (!payload || !isImage) {
      return ctx.reply(
        'Balas sebuah gambar (bukan stiker/webp) dengan perintah *.setpp* buat ganti foto profil bot.'
      );
    }
    await ctx.react('⏳');
    try {
      const stream = await downloadMediaMessage(targetMessage);
      const media = await streamToBuffer(stream);
      const processed = await generateProfilePicture(media);
      await ctx.client.profile.setProfilePicture(processed);
      await ctx.react('✅');
      ctx.reply('Foto profil bot berhasil diganti, Kak.');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('Gagal ganti foto profil: ' + (e.message || e));
    }
  }
};
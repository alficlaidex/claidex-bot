import config from '../../config.js'
import { listFeatures } from '../loader.js'
import { totalUsers, getBalance } from '../../core/database.js'
import { getCharacter } from '../../core/rpg.js'
import { onRichReply } from '../../core/richRegistry.js'
import { imageSection, sendRichMenu, textCardSection } from '../../lib/menuRich.js'

const BANNER_URL = process.env.MENU_BANNER_URL
  || 'https://l.top4top.io/p_3907v5rf70.jpg'
// Rich card (botForwardedMessage + GenAI unifiedResponse) TIDAK bisa diunduh di
// sebagian perangkat — user melapor "gabisa di klik tombol unduh rich nya".
// Jadi rich card hanya dipakai kalau diminta lewat argumen/flag; default menu
// memakai teks biasa + nativeFlow list/buttons yang selalu bisa dibuka.
const RICH_SUBCOMMANDS = new Set(['rich', 'card', 'ai'])
const RICH_FLAGS = /^-{1,2}rich$/i
const CATEGORIES = {
  general: 'GENERAL',
  downloader: 'DOWNLOADER',
  ai: 'AI',
  tools: 'TOOLS',
  group: 'GROUP',
  game: 'GAME',
  rpg: 'RPG',
  interactive: 'INTERACTIVE',
  owner: 'OWNER',
}
const CATEGORY_ORDER = Object.keys(CATEGORIES)
const COMMANDS_PER_PAGE = 20
const MAX_CARD_CHARS = 3800
function clip(value = '', max = MAX_CARD_CHARS) {
  const text = String(value || '').replace(/[ \t]+/g, ' ').trimEnd()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function formatUptime(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}
function groupedFeatures() {
  const grouped = Object.fromEntries(CATEGORY_ORDER.map((tag) => [tag, []]))
  for (const feature of listFeatures()) {
    const tag = feature.tags || 'general'
    if (!grouped[tag]) grouped[tag] = []
    grouped[tag].push(feature)
  }
  return grouped
}
function infoBlock(ctx) {
  const character = getCharacter(ctx.sender)
  const balance = getBalance(ctx.sender)
  const lines = [
    '╭  *INFO*',
    `│  ∘ rt (${formatUptime(process.uptime() * 1000)})`,
    `│  ∘ user (${ctx.pushName || 'User'})`,
    character
      ? `│  ∘ rpg (Lv.${character.level} • ${balance.gold}G • ${balance.gems}💎)`
      : '│  ∘ rpg (belum mulai)',
    `│  ∘ cmd (${listFeatures().length} • ${totalUsers()} user)`,
    '╰⊶',
  ]
  return lines.join('\n')
}

function treeBlock(grouped, tags) {
  const lines = []
  for (const tag of tags) {
    const features = grouped[tag] ?? []
    if (!features.length) continue
    lines.push(`╭  *${CATEGORIES[tag]}*`)
    for (const feature of features) {
      const desc = feature.description
        ? ` _${feature.description.split('(')[0].trim().slice(0, 34)}_`
        : ''
      lines.push(`│  ∘ \`${config.mainPrefix}${feature.name}\`${desc}`)
    }
    lines.push('╰⊶')
  }
  return lines.join('\n')
}
function footerBlock() {
  return `> _*${config.botName}*_`
}

async function sendMenuCard(ctx, { tags, extraNote = '', rich = false }) {
  const grouped = groupedFeatures()
  const active = tags.filter((tag) => grouped[tag]?.length)
  if (!active.length) {
    await ctx.reply('⚠️ Belum ada command yang termuat. Coba `.reload` atau restart bot.')
    return null
  }
  const body = [infoBlock(ctx), '', treeBlock(grouped, active), extraNote, footerBlock()]
    .filter((part) => part !== '')
    .join('\n')

  if (rich) {
    const title = clip(body)
    try {
      return await sendRichMenu(ctx, [imageSection(BANNER_URL), textCardSection(title)])
    } catch (err) {
      const why = String(err?.message ?? err).slice(0, 140)
      console.error('[menu] rich card gagal:', why)
      // Jatuh ke teks biasa — lebih baik dapat teks daripada diam.
    }
  }

  await ctx.reply(clip(body, 3800))
  return 'text'
}


function featureRows(features) {
  return features.map((feature) => ({
    id: `menu:command:${feature.tags || 'general'}:${feature.name}`,
    title: `${config.mainPrefix}${feature.name}`.slice(0, 30),
    description: (feature.description || 'Buka detail').slice(0, 58),
  }))
}
async function showCategoryList(ctx, tag) {
  const features = groupedFeatures()[tag] ?? []
  if (!features.length) {
    await ctx.reply('Kategori ini belum punya command.')
    return
  }
  await ctx.replyList({
    header: { title: CATEGORIES[tag], subtitle: `${features.length} command` },
    text: clip(`Kategori *${CATEGORIES[tag]}*. Pilih command:`, 400),
    footer: `${config.botName} • ${config.mainPrefix}menu untuk kembali`,
    title: `${CATEGORIES[tag]} Commands`,
    buttonText: '📋 Pilih',
    sections: [{ title: CATEGORIES[tag], rows: featureRows(features) }],
  })
}
async function showCommandDetail(ctx, tag, name) {
  const feature = listFeatures().find((f) => (f.tags || 'general') === tag && f.name === name)
  if (!feature) {
    await ctx.reply('Command ini sudah tidak tersedia. Kirim `.menu` untuk refresh.')
    return
  }
  const access = feature.owner ? 'Owner' : feature.admin ? 'Admin' : 'Semua pengguna'
  await ctx.replyButtons({
    header: {
      title: `${config.mainPrefix}${feature.name}`.slice(0, 30),
      subtitle: `${CATEGORIES[tag] ?? tag} • ${access}`,
    },
    text: clip(feature.description || 'Tidak ada deskripsi.', 600),
    footer: `${config.botName} • Detail command`,
    buttons: [
      { id: 'menu:main', text: '📂 Menu utama' },
      { id: `menu:category:${tag}`, text: `📁 ${CATEGORIES[tag] ?? tag}`.slice(0, 40) },
    ],
  })
}
async function showAllPage(ctx, page = 1) {
  const grouped = groupedFeatures()
  const entries = []
  for (const tag of CATEGORY_ORDER) {
    for (const feature of grouped[tag] ?? []) entries.push({ tag, feature })
  }
  const totalPages = Math.max(1, Math.ceil(entries.length / COMMANDS_PER_PAGE))
  const current = Math.max(1, Math.min(totalPages, Number(page) || 1))
  const slice = entries.slice((current - 1) * COMMANDS_PER_PAGE, current * COMMANDS_PER_PAGE)
  const sections = []
  for (const tag of CATEGORY_ORDER) {
    const features = slice.filter((e) => e.tag === tag).map((e) => e.feature)
    if (features.length) sections.push({ title: CATEGORIES[tag], rows: featureRows(features) })
  }
  await ctx.replyList({
    header: { title: '📚 Semua Command', subtitle: `Halaman ${current}/${totalPages}` },
    text: clip(`${entries.length} command terdaftar.`, 400),
    footer: `${config.botName} • Navigasi di bawah`,
    title: `Semua Command · ${current}/${totalPages}`,
    buttonText: '📋 Pilih',
    sections,
  })
  if (totalPages > 1) {
    const buttons = []
    if (current > 1) buttons.push({ id: `menu:page:${current - 1}`, text: `⬅️ ${current - 1}` })
    if (current < totalPages) buttons.push({ id: `menu:page:${current + 1}`, text: `${current + 1} ➡️` })
    await ctx.replyButtons({
      header: { title: '📄 Halaman', subtitle: `${current}/${totalPages}` },
      text: 'Geser halaman untuk command lainnya.',
      footer: config.botName,
      buttons,
    })
  }
}


function registerCommandHandlers(features) {
  for (const feature of features) {
    const tag = feature.tags || 'general'
    onRichReply(`menu:command:${tag}:${feature.name}`, (ctx) => showCommandDetail(ctx, tag, feature.name))
  }
}
function registerPageHandlers(totalPages) {
  for (let p = 1; p <= totalPages; p++) {
    onRichReply(`menu:page:${p}`, (ctx) => showAllPage(ctx, p))
  }
}
onRichReply('menu:main', (ctx) => sendMenuCard(ctx, { tags: CATEGORY_ORDER }))
onRichReply('menu:rich', (ctx) => sendMenuCard(ctx, { tags: CATEGORY_ORDER, rich: true }))
for (const tag of CATEGORY_ORDER) {
  onRichReply(`menu:category:${tag}`, (ctx) => showCategoryList(ctx, tag))
}
// Paginasi didaftarkan saat modul dimuat, bukan cuma saat `.menu all` dipakai:
// tombol "Semua command" di menu utama sudah menunjuk ke menu:page:1, jadi
// kalau handler-nya belum ada, tap-nya jadi "Tidak ada handler untuk rich id".
const FEATURE_TOTAL_AT_BOOT = listFeatures().length
registerPageHandlers(Math.max(1, Math.ceil(FEATURE_TOTAL_AT_BOOT / COMMANDS_PER_PAGE)))
export default {
  name: 'menu',
  aliases: ['help', 'cmd', 'menubot', 'demomenu'],
  tags: 'general',
  description: 'Menu utama Claide — banner + tree command + tombol interaktif',
  async run(ctx) {
    const grouped = groupedFeatures()
    const all = listFeatures()
    registerCommandHandlers(all)
    const rawArgs = ctx.args.filter(Boolean)
    const sub = (ctx.args[0] ?? '').toLowerCase()
    const rest = rawArgs.slice(1).filter((arg) => !RICH_FLAGS.test(arg))
    const wantRich = rawArgs.some((arg) => RICH_FLAGS.test(arg) || RICH_SUBCOMMANDS.has(arg.toLowerCase()))
    const target = rest[0]?.toLowerCase() ?? ''

    if (target === 'all' || target === 'semua' || target === 'list') {
      registerPageHandlers(Math.max(1, Math.ceil(all.length / COMMANDS_PER_PAGE)))
      await sendMenuCard(ctx, {
        tags: CATEGORY_ORDER,
        rich: wantRich,
        extraNote: `> kirim \`${config.mainPrefix}menu all\` buat daftar lengkap dengan navigasi halaman.`,
      })
      await showAllPage(ctx, 1)
      return
    }

    if (target) {
      if (grouped[target]?.length) {
        await sendMenuCard(ctx, { tags: [target], rich: wantRich })
        await showCategoryList(ctx, target)
        return
      }
      const available = CATEGORY_ORDER.filter((t) => grouped[t]?.length).map((t) => CATEGORIES[t]).join(', ')
      await ctx.reply(`❌ Kategori *${target.slice(0, 30)}* tidak ada.\nTersedia: ${available}`)
      return
    }

    if (!wantRich && sub) {
      const known = CATEGORY_ORDER.filter((t) => grouped[t]?.length).map((t) => CATEGORIES[t]).join(', ')
      await ctx.reply(`❌ Kategori *${sub.slice(0, 30)}* tidak ada.\nTersedia: ${known}`)
      return
    }

    const sent = await sendMenuCard(ctx, { tags: CATEGORY_ORDER, rich: wantRich })
    if (!sent) return
    await ctx.react('✨').catch(() => {})
    // Tombol nativeFlow selalu bisa dibuka, tidak seperti rich card yang
    // gagal diunduh di sebagian perangkat.
    try {
      await ctx.replyButtons({
        header: { title: config.botName.slice(0, 30), subtitle: 'Navigasi cepat' },
        text: clip(`*${config.botName}*\nPilih kategori atau lihat semua command.`, 300),
        footer: `${config.botName} • ${all.length} command`,
        buttons: [
          { id: 'menu:page:1', text: '📚 Semua command' },
          { id: 'menu:rich', text: '🖼️ Menu AI' },
          { id: 'menu:category:downloader', text: '⬇️ Downloader' },
          { id: 'menu:category:general', text: '⚙️ General' },
        ],
      })
    } catch (navError) {
      console.error('[menu] tombol navigasi gagal:', String(navError?.message || navError))
    }
  },
}
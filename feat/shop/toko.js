import config from '../../config.js'
import { onRichReply } from '../../core/richRegistry.js'
const APP_PREMIUM = [
  { id: 'app-01', title: 'Netflix', price: 'variasi' },
  { id: 'app-02', title: 'Spotify', price: 'variasi' },
  { id: 'app-03', title: 'YouTube Premium', price: 'variasi' },
  { id: 'app-04', title: 'Canva Pro', price: 'variasi' },
  { id: 'app-05', title: 'ChatGPT Plus', price: 'variasi' },
  { id: 'app-06', title: 'CapCut Pro', price: 'variasi' },
  { id: 'app-07', title: 'VidMate', price: 'variasi' },
  { id: 'app-08', title: 'Alight Motion', price: 'variasi' },
  { id: 'app-09', title: 'VN Pro', price: 'variasi' },
  { id: 'app-10', title: 'Pinterest Pro', price: 'variasi' },
]
const TOP_UP_GAME = [
  { id: 'game-01', title: '8 Ball', status: 'ADA' },
  { id: 'game-02', title: 'Ace Racer', status: 'ADA' },
  { id: 'game-03', title: 'Arena Breakout', status: 'ADA' },
  { id: 'game-04', title: 'Arena of Valor', status: 'ADA' },
  { id: 'game-05', title: 'Blood Strike', status: 'ADA' },
  { id: 'game-06', title: 'Call of Duty Mobile', status: 'ADA' },
  { id: 'game-07', title: 'Dragon Nest M: Classic', status: 'ADA' },
  { id: 'game-08', title: 'Dragon Raja', status: 'ADA' },
  { id: 'game-09', title: 'Dragonheir Silent Gods', status: 'ADA' },
  { id: 'game-10', title: 'EA SPORTS FC Mobile', status: 'ADA' },
  { id: 'game-11', title: 'Eggy Party', status: 'ADA' },
  { id: 'game-12', title: 'Fish It (Roblox)', status: 'ADA' },
  { id: 'game-13', title: 'Free Fire', status: 'ADA' },
  { id: 'game-14', title: 'Garena Shell', status: 'ADA' },
  { id: 'game-15', title: 'Garena Undawn', status: 'ADA' },
  { id: 'game-16', title: 'Genshin Impact ⚠️', status: 'ADA' },
  { id: 'game-17', title: 'Growtopia', status: 'ADA' },
  { id: 'game-18', title: 'Hago', status: 'ADA' },
  { id: 'game-19', title: 'Honkai Star Rail ⚠️', status: 'ADA' },
  { id: 'game-20', title: 'Honor Of Kings Global', status: 'ADA' },
  { id: 'game-21', title: 'Identity V', status: 'ADA' },
  { id: 'game-22', title: 'Knives Out', status: 'ADA' },
  { id: 'game-23', title: 'League Of Legends: Wild Rift', status: 'ADA' },
  { id: 'game-24', title: 'League of Legends: PC', status: 'ADA' },
  { id: 'game-25', title: 'Life After', status: 'ADA' },
  { id: 'game-26', title: 'Light Of Thel', status: 'ADA' },
  { id: 'game-27', title: 'Lords Mobile', status: 'ADA' },
  { id: 'game-28', title: 'MARVEL Super War', status: 'ADA' },
  { id: 'game-29', title: 'Magic Chess: Go Go ⚠️', status: 'ADA' },
  { id: 'game-30', title: 'Marvel Rivals', status: 'ADA' },
  { id: 'game-31', title: 'Metal Slug: Awakening', status: 'ADA' },
  { id: 'game-32', title: 'Mobile Legend ⚠️', status: 'ADA' },
  { id: 'game-33', title: 'ONE PUNCH MAN ⚠️', status: 'ADA' },
  { id: 'game-34', title: 'Omega Legends', status: 'ADA' },
  { id: 'game-35', title: 'PUBG Mobile', status: 'ADA' },
  { id: 'game-36', title: 'Point Blank', status: 'ADA' },
  { id: 'game-37', title: 'Ragnarok M ⚠️', status: 'ADA' },
  { id: 'game-38', title: 'Ragnarok Origin ⚠️', status: 'ADA' },
  { id: 'game-39', title: 'Razer Gold', status: 'ADA' },
  { id: 'game-40', title: 'Revelation', status: 'ADA' },
  { id: 'game-41', title: 'Roblox', status: 'ADA' },
  { id: 'game-42', title: 'Sausage Man', status: 'ADA' },
  { id: 'game-43', title: 'State of Survival', status: 'ADA' },
  { id: 'game-44', title: 'Steam Wallet', status: 'ADA' },
  { id: 'game-45', title: 'Super SUS', status: 'ADA' },
  { id: 'game-46', title: 'Tom and Jerry: Chase', status: 'ADA' },
  { id: 'game-47', title: 'Tower Of Fantasy', status: 'ADA' },
  { id: 'game-48', title: 'VALORANT', status: 'ADA' },
  { id: 'game-49', title: 'Voucher UniPin', status: 'ADA' },
  { id: 'game-50', title: 'Where Winds Meet', status: 'ADA' },
  { id: 'game-51', title: 'Whiteout Survival', status: 'ADA' },
  { id: 'game-52', title: 'Wuthering Waves', status: 'ADA' },
  { id: 'game-53', title: 'eFootball Via Login', status: 'ADA' },
]


onRichReply('toko:main', async (ctx) => {
  await ctx.replyList({
    text: '🛒 *TOKO V2*\nPilih kategori produk:',
    footer: `${config.botName} • Toko V2`,
    title: '🛒 TOKO V2',
    buttonText: 'Buka Toko',
    sections: [
      {
        title: 'Kategori',
        rows: [
          { id: 'toko:app-premium', title: '📱 App Premium', description: 'Netflix, Spotify, YouTube Premium, dll' },
          { id: 'toko:topup-game', title: '🎮 Top Up Game', description: '53 game tersedia — Free Fire, ML, PUBG, dll' },
        ]
      }
    ]
  })
})


onRichReply('toko:app-premium', async (ctx) => {
  const rows = APP_PREMIUM.map(item => ({
    id: `toko:beli:${item.id}`,
    title: `📱 ${item.title}`,
    description: `Harga: ${item.price}`
  }))
  await ctx.replyList({
    text: '📱 *APP PREMIUM*\nPilih produk:',
    footer: `${config.botName} • App Premium`,
    title: '📱 App Premium',
    buttonText: 'Pilih Produk',
    sections: [{ title: 'App Premium', rows }]
  })
})


onRichReply('toko:topup-game', async (ctx) => {
  const chunks = []
  for (let i = 0; i < TOP_UP_GAME.length; i += 20) {
    chunks.push(TOP_UP_GAME.slice(i, i + 20))
  }
  const sections = chunks.map((chunk, idx) => ({
    title: `Game ${idx * 20 + 1}-${Math.min((idx + 1) * 20, TOP_UP_GAME.length)}`,
    rows: chunk.map(item => ({
      id: `toko:beli:${item.id}`,
      title: `🎮 ${item.title}`,
      description: `⚠️ = butuh Zone ID`
    }))
  }))
  await ctx.replyList({
    text: '🎮 *TOP UP GAME*\n53 game tersedia\n⚠️ = butuh Zone ID\n\nPilih game:',
    footer: `${config.botName} • Top Up Game`,
    title: '🎮 TOP UP GAME',
    buttonText: 'Pilih Game',
    sections
  })
})


const ALL_PRODUCTS = [...APP_PREMIUM, ...TOP_UP_GAME]
for (const product of ALL_PRODUCTS) {
  onRichReply(`toko:beli:${product.id}`, async (ctx) => {
    const needZone = product.title.includes('⚠️')
    let text = `🛒 *${product.title}*\n\n`
    text += `Harga: Variasi\nStatus: ✅ ADA\n\n`
    if (needZone) {
      text += `⚠️ *Butuh Zone ID!*\nKirim Zone ID kamu setelah pilih denom.`
    } else {
      text += `Pilih aksi di bawah 👇`
    }
    await ctx.replyButtons({
      text,
      footer: `${config.botName} • Toko V2`,
      buttons: [
        { id: `toko:confirm:${product.id}`, text: `✅ Beli ${product.title}` },
        { id: 'toko:main', text: '❌ Batal' }
      ]
    })
  })
}


for (const product of ALL_PRODUCTS) {
  onRichReply(`toko:confirm:${product.id}`, async (ctx) => {
    const needZone = product.title.includes('⚠️')
    let text = `✅ *Pesanan Diterima!*\n\n`
    text += `📦 *Produk:* ${product.title}\n`
    text += `👤 *Pembeli:* ${ctx.pushName || 'User'}\n\n`
    if (needZone) {
      text += `⚠️ *Kirim Zone ID kamu sekarang!*`
    } else {
      text += `Kirim bukti pembayaran ke admin ya!\n\n`
      text += `Terima kasih 🙏`
    }
    await ctx.reply(text)
  })
}


export default {
  name: 'toko2',
  aliases: ['beli2', 'topup'],
  tags: 'general',
  description: 'Toko V2 — App Premium & Top Up Game',
  async run(ctx) {
    const sub = (ctx.args[0] ?? '').toLowerCase()
    
    if (ctx.command === 'beli' || sub) {
      const product = ALL_PRODUCTS.find(p => 
        p.title.toLowerCase().includes(sub) ||
        p.id === sub
      )
      if (product) {
        const needZone = product.title.includes('⚠️')
        let text = `🛒 *${product.title}*\n\n`
        if (needZone) {
          text += `⚠️ *Butuh Zone ID!*\nKirim Zone ID kamu setelah memilih denom.\n\n`
        }
        text += `Ketik: *.beli ${product.title.toLowerCase()}*\n`
        text += `Lalu pilih nominal/denom yang tersedia.`
        await ctx.reply(text)
        return
      }
    }
    
    await ctx.replyList({
      text: '🛒 *TOKO V2*\nPilih kategori produk:',
      footer: `${config.botName} • Toko V2`,
      title: '🛒 TOKO V2',
      buttonText: 'Buka Toko',
      sections: [
        {
          title: 'Kategori',
          rows: [
            { id: 'toko:app-premium', title: '📱 App Premium', description: 'Netflix, Spotify, YouTube Premium, dll' },
            { id: 'toko:topup-game', title: '🎮 Top Up Game', description: '53 game tersedia — Free Fire, ML, PUBG, dll' },
          ]
        }
      ]
    })
  }
}
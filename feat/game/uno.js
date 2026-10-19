import { sendRichJH } from '../../lib/jhrich.js'
const ASSETS = {
  LOGO: { url: 'https://l.top4top.io/p_390726vip0.jpg', size: 56, q: 70 },
  PLAYER: { url: 'https://g.top4top.io/p_3907j5sns0.jpg', size: 128, q: 68 },
  FIONY: { url: 'https://e.top4top.io/p_3907tm8b10.jpg', size: 80, q: 62 },
  CARMEN: { url: 'https://j.top4top.io/p_3907hvbhg0.jpg', size: 80, q: 62 },
  NAYEON: { url: 'https://i.top4top.io/p_3907v9y7e0.jpg', size: 80, q: 62 }
}
const MAX_HTML_KB = 40
const SCALES = [1, 0.8, 0.6, 0.45]
const RAW_CACHE = new Map()
async function fetchRaw(url) {
  if (RAW_CACHE.has(url)) return RAW_CACHE.get(url)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) { RAW_CACHE.set(url, null); return null }
    const buf = Buffer.from(await res.arrayBuffer())
    RAW_CACHE.set(url, buf.length ? buf : null)
    return buf.length ? buf : null
  } catch {
    RAW_CACHE.set(url, null)
    return null
  }
}
async function toDataUri(url, size, q) {
  const buf = await fetchRaw(url)
  if (!buf) return url
  try {
    const sharp = (await import('sharp')).default
    const out = await sharp(buf)
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality: q })
      .toBuffer()
    return 'data:image/jpeg;base64,' + out.toString('base64')
  } catch {
    return url
  }
}
function inject(baseHtml, values) {
  let html = baseHtml
  for (const [key, value] of Object.entries(values)) {
    html = html.split('{{' + key + '}}').join(value)
  }
  return html
}
async function buildHtmlWithAssets(baseHtml) {
  const entries = Object.entries(ASSETS)
  for (const scale of SCALES) {
    const uris = await Promise.all(entries.map(([, a]) => toDataUri(a.url, Math.max(28, Math.round(a.size * scale)), a.q)))
    const values = {}
    entries.forEach(([key], i) => { values[key] = uris[i] })
    const html = inject(baseHtml, values)
    const kb = Buffer.byteLength(html) / 1024
    console.log('[Uno] scale ' + scale + ' → html ' + kb.toFixed(1) + ' KB')
    if (kb <= MAX_HTML_KB) return html
  }
  const values = {}
  entries.forEach(([key, a]) => { values[key] = a.url })
  const html = inject(baseHtml, values)
  console.log('[Uno] fallback external urls → html ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB')
  return html
}
const UNO_HTML = `<style>
:root{--bg:#070b16;--panel:rgba(16,23,45,.92);--panel2:rgba(255,255,255,.05);--line:rgba(255,255,255,.12);--text:#f4f8ff;--muted:#93a1c0;--purple:#a678ff;--cyan:#43e5df;--gold:#ffd166;--green:#63e4a0;--red:#ff6076;--shadow:0 18px 50px rgba(0,0,0,.4)}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(circle at 12% 0%,rgba(166,120,255,.14),transparent 30%),radial-gradient(circle at 90% 12%,rgba(67,229,223,.10),transparent 26%),linear-gradient(150deg,#070b16,#0d1428);overflow-x:hidden;-webkit-tap-highlight-color:transparent}
button{border:0;color:inherit;font:inherit;cursor:pointer}
.shell{width:min(560px,100%);margin:10px auto;background:var(--panel);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.topbar{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(10,15,32,.6);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.logo{width:40px;height:40px;flex:0 0 auto;background-color:#252b49;background-size:cover;background-position:center;border-radius:12px;border:1px solid rgba(255,255,255,.2)}
.brand-title{font-size:15px;font-weight:900;letter-spacing:-.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand-subtitle{color:var(--muted);font-size:10px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.small-btn{flex:0 0 auto;padding:8px 12px;border:1px solid var(--line);background:var(--panel2);border-radius:11px;color:var(--muted);font-size:11px;white-space:nowrap}
.body{padding:12px}
.me{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:var(--panel2);margin-bottom:10px}
.profile-avatar{width:46px;height:46px;flex:0 0 auto;background-color:#283151;background-size:cover;background-position:center;border-radius:50%;border:2px solid rgba(255,255,255,.18)}
.profile-name{font-weight:900;font-size:15px}
.profile-role{color:var(--cyan);font-size:10px;margin-top:2px}
.me-spacer{flex:1}
.me-tag{font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 9px;white-space:nowrap}
.bots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.bot-card{min-width:0;padding:8px 6px;border:1px solid var(--line);border-radius:14px;background:var(--panel2);text-align:center;transition:.25s}
.bot-card.active{border-color:var(--cyan);box-shadow:0 0 0 1px rgba(67,229,223,.15),0 0 18px rgba(67,229,223,.10)}
.bot-avatar{width:34px;height:34px;margin:0 auto;background-color:#283151;background-size:cover;background-position:center;border-radius:50%;border:1px solid rgba(255,255,255,.16)}
.bot-name{margin-top:4px;font-size:10px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bot-status{margin-top:2px;color:var(--muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.table{position:relative;overflow:hidden;padding:14px 12px;border:1px solid var(--line);border-radius:16px;background:radial-gradient(circle at 50% 45%,rgba(67,229,223,.07),transparent 32%),linear-gradient(150deg,rgba(19,32,58,.9),rgba(12,18,38,.94))}
.turn-status{width:fit-content;margin:0 auto 12px;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.25);border:1px solid var(--line);font-size:11px;text-align:center}
.turn-status.thinking{color:var(--gold);border-color:rgba(255,209,102,.4)}
.table-center{display:flex;align-items:center;justify-content:center;gap:34px;min-height:150px}
.pile-wrap{display:flex;flex-direction:column;align-items:center;gap:6px}
.pile-label{color:var(--muted);font-size:10px}
.card{position:relative;width:64px;height:92px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:10px;border:3px solid #fff;overflow:hidden;box-shadow:0 8px 16px rgba(0,0,0,.35);user-select:none}
.card::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.30),rgba(255,255,255,.06) 40%,rgba(0,0,0,.22));pointer-events:none}
.card::after{content:"";position:absolute;left:50%;top:50%;width:76%;height:50%;transform:translate(-50%,-50%) rotate(-24deg);background:rgba(255,255,255,.95);border-radius:50%;box-shadow:inset 0 0 0 2px rgba(0,0,0,.05),0 2px 6px rgba(0,0,0,.18)}
.card .cv{position:relative;z-index:2;font-style:italic;font-weight:900;font-size:26px;letter-spacing:-1px}
.card .ci{position:absolute;z-index:2;font-style:italic;font-weight:900;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.ci.tl{top:3px;left:5px}
.ci.br{bottom:3px;right:5px;transform:rotate(180deg)}
.red{background:linear-gradient(150deg,#ff8b96,#e02f52 55%,#b81f42);box-shadow:0 8px 18px rgba(216,47,82,.38)}
.red .cv{color:#d82f52}
.yellow{background:linear-gradient(150deg,#ffefad,#f0b429 55%,#d99a1b);box-shadow:0 8px 18px rgba(233,169,39,.38)}
.yellow .cv{color:#c98a1e}
.green{background:linear-gradient(150deg,#8ff0b4,#22b06b 55%,#178f56);box-shadow:0 8px 18px rgba(32,169,106,.38)}
.green .cv{color:#1d9e63}
.blue{background:linear-gradient(150deg,#8fd8ff,#2b78d8 55%,#1f5fb8);box-shadow:0 8px 18px rgba(39,114,216,.38)}
.blue .cv{color:#2b78d8}
.wild{background:conic-gradient(from 45deg,#ff5f6d 0 25%,#ffd166 25% 50%,#56d98b 50% 75%,#43bfff 75%);box-shadow:0 8px 18px rgba(166,120,255,.40)}
.wild .cv{color:#3a3f55}
.card.back{background:linear-gradient(135deg,rgba(255,255,255,.14),transparent 45%),repeating-linear-gradient(45deg,#232a5c 0 8px,#333d7d 8px 16px);box-shadow:0 8px 16px rgba(0,0,0,.4)}
.card.back::after{background:#171b3a;box-shadow:inset 0 0 0 3px rgba(255,255,255,.85)}
.card.back .cv{color:#fff;font-size:19px;letter-spacing:1px}
.deck-count{color:var(--muted);font-size:10px}
.active-color{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;background:rgba(0,0,0,.25);color:var(--muted);font-size:10px}
.color-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 10px currentColor}
.color-dot.red{color:#ff6076;background:#ff6076}
.color-dot.yellow{color:#ffd166;background:#ffd166}
.color-dot.green{color:#63e4a0;background:#63e4a0}
.color-dot.blue{color:#55bfff;background:#55bfff}
.color-dot.wild{color:#d7c9ff;background:linear-gradient(135deg,#ff6076,#ffd166,#63e4a0,#55bfff)}
.player-area{margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--panel2)}
.player-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.player-title{display:flex;align-items:center;gap:8px;font-weight:900;font-size:13px}
.mini-avatar{width:26px;height:26px;flex:0 0 auto;background-color:#283151;background-size:cover;background-position:center;border-radius:50%;border:1px solid rgba(255,255,255,.2)}
.hand-count{color:var(--muted);font-size:10px}
.hand{display:flex;gap:7px;min-height:86px;overflow-x:auto;padding:3px 2px 7px;scrollbar-width:thin}
.hand .card{width:52px;height:76px;border-width:2px;cursor:pointer;transition:.2s}
.hand .card .cv{font-size:19px}
.hand .card .ci{font-size:9px}
.hand .card.disabled{filter:grayscale(.8);opacity:.42;cursor:not-allowed}
.hand .card.playable{box-shadow:0 0 0 2px var(--gold),0 8px 20px rgba(255,209,102,.2)}
.controls{display:flex;gap:8px;margin-top:9px}
.draw-btn{flex:1;padding:11px;border:1px solid rgba(67,229,223,.3);border-radius:12px;background:linear-gradient(135deg,rgba(67,229,223,.14),rgba(166,120,255,.12));font-weight:800;font-size:12px}
.main-btn{padding:11px 16px;border-radius:12px;background:linear-gradient(135deg,var(--purple),#7650e7);font-weight:800;font-size:12px}
.draw-btn:disabled,.main-btn:disabled{cursor:not-allowed;opacity:.45}
.log{max-height:96px;overflow-y:auto;margin-top:9px;padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.18);color:var(--muted);font-size:10px;line-height:1.55}
.log div+div{margin-top:3px}
.log strong{color:#eaf0ff}
.foot{padding:11px 12px;border-top:1px solid var(--line);background:rgba(8,12,26,.65);color:var(--muted);font-size:10px;text-align:center;line-height:1.9;letter-spacing:.2px}
.heart{display:inline-block;color:#ff5f87;animation:hb 1.15s ease-in-out infinite}
.jamvan{font-weight:900;background:linear-gradient(90deg,#ff82c4,#b999ff,#62e6df,#ff82c4);background-size:240% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:gm 4s linear infinite}
.fionyverse{font-weight:900;background:linear-gradient(90deg,#7cecff,#bd9bff,#ff9acb,#7cecff);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:gm 4s linear infinite reverse}
@keyframes hb{0%,100%{transform:scale(1)}15%{transform:scale(1.25)}30%{transform:scale(1)}}
@keyframes gm{to{background-position:240% center}}
.modal{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(2,4,12,.74);backdrop-filter:blur(8px)}
.modal.show{display:flex}
.modal-box{width:min(320px,100%);padding:18px;border:1px solid var(--line);border-radius:20px;background:#151d3b;text-align:center}
.modal-box h2{margin-bottom:6px;font-size:18px}
.modal-box p{margin-bottom:12px;color:var(--muted);font-size:11px}
.color-options{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.color-option{padding:11px;border-radius:12px;font-weight:800;border:1px solid rgba(255,255,255,.15)}
.color-option.red{background:#c93b55}
.color-option.yellow{background:#c18a1e;color:#fff7d4}
.color-option.green{background:#219661}
.color-option.blue{background:#276ac5}
@media (max-width:420px){.table-center{gap:22px}.card{width:56px;height:82px}.card .cv{font-size:22px}.hand .card{width:46px;height:68px}.hand .card .cv{font-size:17px}.hand{min-height:76px}.brand-subtitle{display:none}}
</style>
<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="logo" style="background-image:url({{LOGO}})"></div>
      <div style="min-width:0">
        <div class="brand-title">JH-Game — UNO</div>
        <div class="brand-subtitle">Stack rules • Bot thinking mode</div>
      </div>
    </div>
    <button class="small-btn" id="newGameBtn">↻ Game Baru</button>
  </header>
  <div class="body">
    <div class="me">
      <div class="profile-avatar" style="background-image:url({{PLAYER}})"></div>
      <div>
        <div class="profile-name">JamvanHax0r</div>
        <div class="profile-role">Player • Kamu</div>
      </div>
      <div class="me-spacer"></div>
      <div class="me-tag">UNO Stack</div>
    </div>
    <div class="bots">
      <div class="bot-card" data-player="1">
        <div class="bot-avatar" style="background-image:url({{FIONY}})"></div>
        <div class="bot-name">Fiony</div>
        <div class="bot-status">Menunggu...</div>
      </div>
      <div class="bot-card" data-player="2">
        <div class="bot-avatar" style="background-image:url({{CARMEN}})"></div>
        <div class="bot-name">Carmen</div>
        <div class="bot-status">Menunggu...</div>
      </div>
      <div class="bot-card" data-player="3">
        <div class="bot-avatar" style="background-image:url({{NAYEON}})"></div>
        <div class="bot-name">Nayeon</div>
        <div class="bot-status">Menunggu...</div>
      </div>
    </div>
    <section class="table">
      <div class="turn-status" id="turnStatus">Giliran kamu</div>
      <div class="table-center">
        <div class="pile-wrap">
          <div class="pile-label">Deck</div>
          <div class="card back"><span class="cv">UNO</span></div>
          <div class="deck-count" id="deckCount">108 kartu</div>
        </div>
        <div class="pile-wrap">
          <div class="pile-label">Kartu Aktif</div>
          <div id="discardCard"></div>
          <div class="active-color">Warna: <span class="color-dot wild" id="colorDot"></span> <span id="activeColorText">-</span></div>
        </div>
      </div>
      <div class="player-area">
        <div class="player-heading">
          <div class="player-title">
            <div class="mini-avatar" style="background-image:url({{PLAYER}})"></div>
            <span>Hand kamu</span>
          </div>
          <span class="hand-count" id="handCount">0 kartu</span>
        </div>
        <div class="hand" id="playerHand"></div>
        <div class="controls">
          <button class="draw-btn" id="drawBtn">Ambil Kartu</button>
          <button class="main-btn" id="unoBtn">UNO!</button>
        </div>
        <div class="log" id="gameLog"></div>
      </div>
    </section>
  </div>
  <footer class="foot">
    Made with <span class="heart">❤</span> by <span class="jamvan">JamvanHax0r</span><br>
    Powered by <span class="fionyverse">FionyVerse</span><br>
    © <span id="year"></span> — All Rights Reserved.
  </footer>
</div>
<div class="modal" id="colorModal">
  <div class="modal-box">
    <h2>Pilih warna</h2>
    <p>Wild card aktif. Pilih warna yang mau kamu tentukan.</p>
    <div class="color-options">
      <button class="color-option red" data-color="red">Merah</button>
      <button class="color-option yellow" data-color="yellow">Kuning</button>
      <button class="color-option green" data-color="green">Hijau</button>
      <button class="color-option blue" data-color="blue">Biru</button>
    </div>
  </div>
</div>
<script>
const players=[{id:0,name:"JamvanHax0r",human:true,hand:[]},{id:1,name:"Fiony",human:false,hand:[]},{id:2,name:"Carmen",human:false,hand:[]},{id:3,name:"Nayeon",human:false,hand:[]}];
const colors=["red","yellow","green","blue"];
const colorNames={red:"Merah",yellow:"Kuning",green:"Hijau",blue:"Biru"};
let deck=[],discard=[],currentColor=null,currentPlayer=0,direction=1,penalty=0,penaltyType=null,gameLocked=false,pendingWildCard=null,lastDrawn=null;
const $=s=>document.querySelector(s);
const uid=()=>Math.random().toString(36).slice(2,10);
const makeCard=(color,value)=>({id:uid(),color,value,wild:color==="wild"});
function buildDeck(){const cards=[];colors.forEach(color=>{cards.push(makeCard(color,"0"));for(let i=1;i<=9;i++){cards.push(makeCard(color,String(i)));cards.push(makeCard(color,String(i)))}["skip","reverse","+2"].forEach(value=>{cards.push(makeCard(color,value));cards.push(makeCard(color,value))})});for(let i=0;i<4;i++){cards.push(makeCard("wild","wild"));cards.push(makeCard("wild","+4"))}return shuffle(cards)}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function cardText(card){const labels={skip:"⊘",reverse:"↔","+2":"+2","+4":"+4",wild:"★"};return labels[card.value]||card.value}
function cardElement(card,options={}){
const el=document.createElement("div");
if(options.back){el.className="card back";el.innerHTML='<span class="cv">UNO</span>';return el}
el.className=\`card \${card.color}\`;
if(options.playable){el.classList.add("playable")}
if(options.disabled){el.classList.add("disabled")}
const v=cardText(card);
el.innerHTML=\`<span class="cv">\${v}</span><i class="ci tl">\${v}</i><i class="ci br">\${v}</i>\`;
return el}
function canPlay(card){const top=discard[discard.length-1];if(!top)return true;if(penalty>0){return card.value===penaltyType}if(card.wild)return true;if(card.color===currentColor)return true;if(card.value===top.value)return true;return false}
function drawCards(player,amount){for(let i=0;i<amount;i++){if(deck.length===0)refillDeck();const card=deck.pop();if(card)player.hand.push(card)}}
function refillDeck(){if(discard.length<=1)return;const active=discard.pop();deck=shuffle(discard.splice(0));discard=[active]}
function nextPlayer(steps=1){currentPlayer=(currentPlayer+direction*steps+players.length)%players.length}
function renderCard(card,target,options={}){const el=cardElement(card,options);target.appendChild(el);return el}
function render(){
const top=discard[discard.length-1];
$("#deckCount").textContent=\`\${deck.length} kartu\`;
$("#handCount").textContent=\`\${players[0].hand.length} kartu\`;
$("#discardCard").innerHTML="";
if(top)renderCard(top,$("#discardCard"));
$("#activeColorText").textContent=currentColor?colorNames[currentColor]:"-";
const dot=$("#colorDot");dot.className=\`color-dot \${currentColor||"wild"}\`;
const hand=$("#playerHand");hand.innerHTML="";
players[0].hand.forEach((card,index)=>{const playable=canPlay(card);const el=renderCard(card,hand,{playable,disabled:!playable||gameLocked||currentPlayer!==0});el.addEventListener("click",()=>{if(!gameLocked&&currentPlayer===0&&playable){playHumanCard(index)}})});
const status=$("#turnStatus");const active=players[currentPlayer];
if(gameLocked){status.textContent="Belum giliran kamu...";status.classList.remove("thinking")}
else if(!active.human){status.textContent=\`\${active.name} is thinking...\`;status.classList.add("thinking")}
else if(penalty>0){status.textContent=\`Giliran kamu — stack \${penalty} kartu \${penaltyType}\`;status.classList.remove("thinking")}
else{status.textContent="Giliran kamu";status.classList.remove("thinking")}
document.querySelectorAll(".bot-card").forEach((cardEl,index)=>{const bot=players[index+1];const st=cardEl.querySelector(".bot-status");cardEl.classList.toggle("active",currentPlayer===bot.id);if(currentPlayer===bot.id&&!gameLocked){st.textContent="Thinking..."}else{st.textContent=\`\${bot.hand.length} kartu\`}});
$("#drawBtn").disabled=gameLocked||currentPlayer!==0||lastDrawn===true;
}
function log(message){const box=$("#gameLog");const line=document.createElement("div");line.innerHTML=message;box.prepend(line);while(box.children.length>18){box.removeChild(box.lastChild)}}
function startGame(){
deck=buildDeck();discard=[];currentColor=null;currentPlayer=0;direction=1;penalty=0;penaltyType=null;gameLocked=false;pendingWildCard=null;lastDrawn=null;
players.forEach(p=>{p.hand=[]});
players.forEach(p=>{drawCards(p,7)});
let firstCard;
do{firstCard=deck.pop()}while(firstCard&&firstCard.wild);
discard.push(firstCard);currentColor=firstCard.color;
if(firstCard.value==="+2"){penalty=2;penaltyType="+2"}
log("<strong>Game dimulai!</strong> Semoga hoki, jangan lupa stack.");
log(\`Kartu pembuka: <strong>\${cardText(firstCard)}</strong> \${colorNames[firstCard.color]||""}\`);
render();
}
function playHumanCard(index){const card=players[0].hand[index];if(!card||!canPlay(card))return;if(card.wild){pendingWildCard={playerId:0,cardIndex:index};$("#colorModal").classList.add("show");return}playCard(players[0],index,null)}
function playCard(player,index,chosenColor=null){
const card=player.hand[index];if(!card||!canPlay(card))return;
player.hand.splice(index,1);discard.push(card);
if(card.wild){currentColor=chosenColor||colors[Math.floor(Math.random()*colors.length)]}else{currentColor=card.color}
lastDrawn=false;
if(card.value==="+2"){if(penaltyType==="+2"){penalty+=2}else{penalty=2;penaltyType="+2"}log(\`<strong>\${player.name}</strong> memainkan <strong>+2</strong>. Stack sekarang: <strong>\${penalty}</strong> kartu.\`);nextPlayer()}
else if(card.value==="+4"){if(penaltyType==="+4"){penalty+=4}else{penalty=4;penaltyType="+4"}log(\`<strong>\${player.name}</strong> memainkan <strong>+4</strong>. Stack sekarang: <strong>\${penalty}</strong> kartu.\`);nextPlayer()}
else if(card.value==="skip"){log(\`<strong>\${player.name}</strong> memainkan <strong>Skip</strong>.\`);nextPlayer(2)}
else if(card.value==="reverse"){direction*=-1;log(\`<strong>\${player.name}</strong> memainkan <strong>Reverse</strong>. Arah permainan berubah.\`);nextPlayer()}
else{log(\`<strong>\${player.name}</strong> memainkan kartu <strong>\${cardText(card)}</strong>.\`);nextPlayer()}
if(player.hand.length===0){finishGame(player);return}
render();scheduleTurn();
}
function drawForHuman(){
if(gameLocked||currentPlayer!==0||lastDrawn)return;
const amount=penalty>0?penalty:1;
drawCards(players[0],amount);
if(penalty>0){log(\`<strong>JamvanHax0r</strong> gagal stack dan mengambil <strong>\${amount} kartu</strong>.\`);penalty=0;penaltyType=null}
else{log("<strong>JamvanHax0r</strong> mengambil 1 kartu.")}
lastDrawn=true;render();
const drawnIndex=players[0].hand.length-1;const drawnCard=players[0].hand[drawnIndex];
if(drawnCard&&canPlay(drawnCard)&&penalty===0){log("Kartu yang baru diambil masih bisa dimainkan. Klik kartunya atau tekan Ambil Kartu lagi untuk lewat.")}
else{setTimeout(()=>{lastDrawn=false;nextPlayer();render();scheduleTurn()},650)}
}
function playBotTurn(bot){
const playable=bot.hand.map((card,index)=>({card,index})).filter(item=>canPlay(item.card));
let selected;
if(penalty>0){selected=playable.find(item=>item.card.value===penaltyType)}
else{selected=playable.find(item=>item.card.value==="+4")||playable.find(item=>item.card.value==="+2")||playable.find(item=>item.card.value==="skip")||playable.find(item=>item.card.value==="reverse")||playable.find(item=>!item.card.wild)||playable[0]}
if(selected){let chosenColor=null;if(selected.card.wild){chosenColor=chooseBotColor(bot)}playCard(bot,selected.index,chosenColor)}
else{const amount=penalty>0?penalty:1;drawCards(bot,amount);if(penalty>0){log(\`<strong>\${bot.name}</strong> tidak bisa stack dan mengambil <strong>\${amount} kartu</strong>.\`);penalty=0;penaltyType=null}else{log(\`<strong>\${bot.name}</strong> mengambil 1 kartu.\`)}nextPlayer();render();scheduleTurn()}
}
function chooseBotColor(bot){const counts={red:0,yellow:0,green:0,blue:0};bot.hand.forEach(card=>{if(colors.includes(card.color))counts[card.color]++});return colors.sort((a,b)=>counts[b]-counts[a])[0]}
function scheduleTurn(){render();if(gameLocked||currentPlayer===0)return;gameLocked=true;render();setTimeout(()=>{gameLocked=false;playBotTurn(players[currentPlayer])},3000)}
function finishGame(winner){gameLocked=true;render();setTimeout(()=>{alert(\`🎉 \${winner.name} menang!\`)},150)}
$("#drawBtn").addEventListener("click",drawForHuman);
$("#newGameBtn").addEventListener("click",()=>{startGame()});
$("#unoBtn").addEventListener("click",()=>{if(players[0].hand.length===1){log("<strong>UNO!</strong> Kamu tinggal punya 1 kartu. Gas finishing!")}else{log("Belum waktunya UNO, kartumu masih lebih dari satu 😆")}});
document.querySelectorAll(".color-option").forEach(button=>{button.addEventListener("click",()=>{if(!pendingWildCard)return;const {playerId,cardIndex}=pendingWildCard;const player=players[playerId];$("#colorModal").classList.remove("show");pendingWildCard=null;playCard(player,cardIndex,button.dataset.color);log(\`Warna berubah menjadi <strong>\${colorNames[button.dataset.color]}</strong>.\`)})});
$("#colorModal").addEventListener("click",event=>{if(event.target.id==="colorModal"){$("#colorModal").classList.remove("show");pendingWildCard=null}});
$("#year").textContent=new Date().getFullYear();
startGame();
</script>`
export default {
  name: 'uno',
  aliases: ['unogame', 'carduno'],
  tags: 'game',
  description: '🎴 JH-Game UNO — vs 3 bot',
  async run(ctx) {
    await ctx.react('🎴')
    try {
      const html = await buildHtmlWithAssets(UNO_HTML)
      await sendRichJH(ctx, html)
      await ctx.react('✅')
    } catch (e) {
      console.log('[Uno] send gagal:', String(e.message || e).slice(0, 250))
      await ctx.react('❎')
      ctx.reply('❌ Gagal kirim game UNO.')
    }
  }
}
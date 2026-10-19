const BASE = 'https://apis.davidcyril.name.ng/tempmail';

async function api(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const url = BASE + path + (q ? '?' + q : '');
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Request failed');
  return data.result;
}

async function getInbox(email) {
  return api('/inbox', { email });
}

function extractOtp(text) {
  const m = String(text).match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

function extractLinks(text) {
  const re = /https?:\/\/[^\s<>"']+/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text)))) {
    const u = m[0].replace(/[.,);]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const type = process.argv[2] || 'gmail';
console.log(`Creating ${type} mailbox...`);

const { email } = await api('/create', { type });
console.log(`Email: ${email}`);
console.log('Checking inbox...');

const inbox = await getInbox(email);
if (!inbox.emails.length) {
  console.log('Inbox kosong.');
} else {
  for (const mail of inbox.emails) {
    console.log(`\nFrom: ${mail.from || mail.FromEmail}`);
    console.log(`Subject: ${mail.subject || mail.Subject}`);
    console.log(`Body: ${(mail.body || mail.text || '').slice(0, 500)}`);
    const otp = extractOtp(mail.body || mail.text || '');
    if (otp) console.log(`OTP: ${otp}`);
    const links = extractLinks(mail.body || mail.text || '');
    if (links.length) console.log(`Links: ${links.join(', ')}`);
  }
}

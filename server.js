const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3500;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const db = new DatabaseSync(path.join(ROOT, 'data', 'vocab.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY, word TEXT, phonetic_us TEXT, phonetic_uk TEXT, chinese TEXT,
  definitions TEXT, phrases TEXT, related TEXT, synonyms TEXT, examples TEXT,
  web TEXT, exam_types TEXT, tags TEXT, proficiency TEXT, note TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sentences (
  id TEXT PRIMARY KEY, en TEXT, cn TEXT, structures TEXT, expressions TEXT,
  new_examples TEXT, tags TEXT, proficiency TEXT, note TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY, en TEXT, cn TEXT, tags TEXT, proficiency TEXT, note TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS tag (
  name TEXT PRIMARY KEY, created_at TEXT
);
`);

const WORD_JSON = ['definitions', 'phrases', 'related', 'synonyms', 'examples', 'web', 'exam_types', 'tags'];
const SENT_JSON = ['structures', 'expressions', 'new_examples', 'tags'];
const PHRASE_JSON = ['tags'];
const JSON_BY_NAME = { words: WORD_JSON, sentences: SENT_JSON, phrases: PHRASE_JSON };
const COLS = {
  words: ['id', 'word', 'phonetic_us', 'phonetic_uk', 'chinese', ...WORD_JSON, 'proficiency', 'note', 'created_at', 'updated_at'],
  sentences: ['id', 'en', 'cn', ...SENT_JSON, 'proficiency', 'note', 'created_at', 'updated_at'],
  phrases: ['id', 'en', 'cn', ...PHRASE_JSON, 'proficiency', 'note', 'created_at', 'updated_at'],
};

function loadAll(name) {
  const jsonCols = JSON_BY_NAME[name];
  return db.prepare(`SELECT * FROM ${name}`).all().map(row => {
    const o = {};
    for (const c of COLS[name]) {
      o[c] = jsonCols.includes(c) ? (row[c] ? JSON.parse(row[c]) : []) : row[c];
    }
    return o;
  });
}

// ponytail: full-table rewrite per save; fine at personal-tool scale (<1k rows), switch to upsert if it grows
function persist(name, arr) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM ${name}`).run();
    const cols = COLS[name];
    const jsonCols = JSON_BY_NAME[name];
    const stmt = db.prepare(`INSERT INTO ${name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const item of arr) {
      const row = cols.map(c => {
        let v = item[c];
        if (jsonCols.includes(c)) v = JSON.stringify(v || []);
        return v == null ? null : v;
      });
      stmt.run(...row);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const PRESET_TAGS = ['科技', '自然', '教育', '社会', '经济', '文化', '健康', '环境'];
if (db.prepare('SELECT COUNT(*) AS c FROM tag').get().c === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO tag (name, created_at) VALUES (?, ?)');
  for (const t of PRESET_TAGS) ins.run(t, now());
}


function syncTags(tags) {
  if (!Array.isArray(tags)) return;
  const ins = db.prepare('INSERT OR IGNORE INTO tag (name, created_at) VALUES (?, ?)');
  for (const t of tags) if (t && String(t).trim()) ins.run(String(t).trim(), now());
}

// ---------- AI settings (stored locally, never committed) ----------
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const DEFAULT_SETTINGS = { apiBase: 'https://api.deepseek.com/v1', apiModel: 'deepseek-chat', apiKey: '' };

function readSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try { Object.assign(out, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch (e) {}
  if (!out.apiKey) {
    try { out.apiKey = fs.readFileSync(path.join(ROOT, 'key.txt'), 'utf8').trim(); } catch (e) {}
  }
  return out;
}
function writeSettings({ apiKey, apiBase, apiModel }) {
  const cur = readSettings();
  const next = { apiBase: cur.apiBase, apiModel: cur.apiModel, apiKey: cur.apiKey };
  if (apiBase !== undefined) next.apiBase = String(apiBase).trim() || DEFAULT_SETTINGS.apiBase;
  if (apiModel !== undefined) next.apiModel = String(apiModel).trim() || DEFAULT_SETTINGS.apiModel;
  if (apiKey === null) next.apiKey = '';
  else if (apiKey !== undefined) next.apiKey = String(apiKey).trim();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ---------- Youdao dictionary proxy ----------
const DICT_URL = 'https://dict.youdao.com/jsonapi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function cleanText(s) { return String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }

async function fetchDict(word) {
  const r = await fetch(`${DICT_URL}?q=${encodeURIComponent(word)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('dict http ' + r.status);
  const j = await r.json();
  const out = {
    word, phonetic_us: '', phonetic_uk: '', definitions: [], phrases: [],
    related: [], synonyms: [], examples: [], web: [], exam_types: [],
  };
  const ec = j.ec && j.ec.word && j.ec.word[0];
  if (ec) {
    out.phonetic_us = ec.usphone || '';
    out.phonetic_uk = ec.ukphone || '';
    if (Array.isArray(ec.trs)) {
      for (const tr of ec.trs) {
        for (const t of (tr.tr || [])) {
          const items = Array.isArray(t.l && t.l.i) ? t.l.i : [t.l && t.l.i];
          for (const it of items) {
            const s = cleanText(it);
            if (!s) continue;
            const m = s.match(/^(\S+\.)\s*(.*)$/);
            out.definitions.push({ pos: m ? m[1] : '', mean: m ? m[2] : s });
          }
        }
      }
    }
  }
  if (j.ec && Array.isArray(j.ec.exam_type)) out.exam_types = j.ec.exam_type;
  if (j.phrs && Array.isArray(j.phrs.phrs)) {
    for (const p of j.phrs.phrs.slice(0, 8)) {
      const hw = p.phr && p.phr.headword && p.phr.headword.l && p.phr.headword.l.i;
      // trs[0].tr may be an object {l:{i}} or an array of such objects — normalize both
      const trs = p.phr && p.phr.trs && p.phr.trs[0] && p.phr.trs[0].tr;
      const trList = Array.isArray(trs) ? trs : trs ? [trs] : [];
      const tr = trList.map(t => cleanText(t.l && t.l.i)).filter(Boolean).join('；');
      if (hw) out.phrases.push({ phrase: cleanText(hw), mean: tr });
    }
  }
  if (j.rel_word && Array.isArray(j.rel_word.rels)) {
    for (const rel of j.rel_word.rels.slice(0, 6)) {
      for (const w of (rel.rel && rel.rel.words || [])) {
        const word = w.word || '';
        if (word) out.related.push({ word, mean: cleanText(w.tran) });
      }
    }
  }
  if (j.syno && Array.isArray(j.syno.synos)) {
    for (const s of j.syno.synos.slice(0, 4)) {
      const tran = cleanText(s.syno && s.syno.tran);
      for (const w of (s.syno && s.syno.ws || []).map(x => x.w).filter(Boolean)) {
        out.synonyms.push({ word: w, mean: tran });
      }
    }
  }
  if (j.blng_sents_part && Array.isArray(j.blng_sents_part['sentence-pair'])) {
    for (const sp of j.blng_sents_part['sentence-pair'].slice(0, 6)) {
      out.examples.push({ en: cleanText(sp.sentence), cn: cleanText(sp['sentence-translation']) });
    }
  }
  if (j.web_trans && Array.isArray(j.web_trans['web-translation'])) {
    const wt = j.web_trans['web-translation'][0];
    if (wt && wt.trans) {
      out.web = wt.trans.slice(0, 3).map(t => cleanText(t.summary && t.summary.line ? t.summary.line[0] : '')).filter(Boolean);
    }
  }
  return out;
}

// ---------- AI analyze (OpenAI-compatible / DeepSeek) ----------
async function analyzeSentence(sentence) {
  const settings = readSettings();
  const key = settings.apiKey;
  if (!key) {
    return { error: 'NO_KEY', message: '未配置 AI API Key。请点击右上角「设置」填写后重试，或不分析直接保存句子。' };
  }
  const base = settings.apiBase.replace(/\/+$/, '');
  const model = settings.apiModel;
  const sys = `你是雅思写作教师。分析用户提供的英文句子，只输出 JSON（不要 markdown 代码块，不要任何多余文字），字段：
{
  "cn": "准确通顺的中文翻译",
  "structures": [{"name":"结构名称","usage":"该结构如何用在作文中"}],
  "expressions": [{"text":"表达/固定搭配","note":"含义与用法"}],
  "new_examples": ["基于该句结构另造的1~2个作文可用例句"]
}
structures 和 expressions 合计3~6条即可，优先雅思写作常见高分表达。`;
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `请分析这句话：${sentence}` },
      ],
      temperature: 0.6,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`AI api ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  try { return JSON.parse(content); }
  catch (e) { return { cn: content }; }
}

async function translatePhrase(en) {
  const settings = readSettings();
  if (!settings.apiKey) {
    return { error: 'NO_KEY', message: '未配置 AI API Key。请点击右上角「设置」填写后重试，或手动填写中文释义。' };
  }
  const base = settings.apiBase.replace(/\/+$/, '');
  const sys = `你是雅思学习助手。把用户给出的英文词组/固定搭配翻译成准确自然的中文释义，只输出 JSON：{"cn":"中文释义"}。不要逐词直译，给出整词组的意思和常见语境。`;
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.apiModel,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: en },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`AI api ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  try { return JSON.parse(content); }
  catch (e) { return { cn: content }; }
}

// ---------- HTTP helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(new Error('bad json')); } });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      const parts = p.split('/').filter(Boolean);
      const kind = parts[1];
      const id = parts[2];
      const name = ['words', 'sentences', 'phrases'].includes(kind) ? kind : null;

      if (kind === 'dict') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return send(res, 400, { error: 'missing q' });
        return send(res, 200, await fetchDict(q));
      }
      if (kind === 'analyze') {
        const body = await readBody(req);
        const out = await analyzeSentence(body.sentence || '');
        return send(res, 200, out);
      }
      if (kind === 'translate-phrase') {
        const body = await readBody(req);
        const out = await translatePhrase(body.en || '');
        return send(res, 200, out);
      }
      if (kind === 'settings') {
        if (req.method === 'GET') {
          const s = readSettings();
          return send(res, 200, { hasKey: !!s.apiKey, apiBase: s.apiBase, apiModel: s.apiModel });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          writeSettings({ apiKey: body.apiKey, apiBase: body.apiBase, apiModel: body.apiModel });
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'method not allowed' });
      }
      if (kind === 'tags') {
        if (req.method === 'GET') {
          const set = new Set(db.prepare('SELECT name FROM tag').all().map(r => r.name));
          [...loadAll('words'), ...loadAll('sentences'), ...loadAll('phrases')].forEach(o => (o.tags || []).forEach(t => set.add(t)));
          return send(res, 200, { tags: [...set].sort() });
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const nm = (body.name || '').trim();
          if (!nm) return send(res, 400, { error: 'name required' });
          db.prepare('INSERT OR IGNORE INTO tag (name, created_at) VALUES (?, ?)').run(nm, now());
          return send(res, 200, { ok: true });
        }
      }
      if (kind === 'tag' && id) {
        const tagName = decodeURIComponent(id);
        if (req.method === 'DELETE') {
          db.prepare('DELETE FROM tag WHERE name = ?').run(tagName);
          for (const tbl of ['words', 'sentences', 'phrases']) {
            const arr = loadAll(tbl);
            arr.forEach(o => { if (o.tags) o.tags = o.tags.filter(t => t !== tagName); });
            persist(tbl, arr);
          }
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          const newName = (body.newName || '').trim();
          if (!newName) return send(res, 400, { error: 'newName required' });
          db.prepare('DELETE FROM tag WHERE name = ?').run(tagName);
          db.prepare('INSERT OR IGNORE INTO tag (name, created_at) VALUES (?, ?)').run(newName, now());
          for (const tbl of ['words', 'sentences', 'phrases']) {
            const arr = loadAll(tbl);
            arr.forEach(o => { if (o.tags) o.tags = o.tags.map(t => t === tagName ? newName : t); });
            persist(tbl, arr);
          }
          return send(res, 200, { ok: true });
        }
      }
      if (!name) return send(res, 404, { error: 'not found' });

      const arr = loadAll(name);
      if (req.method === 'GET') {
        if (id) {
          const item = arr.find(o => o.id === id);
          return item ? send(res, 200, item) : send(res, 404, { error: 'not found' });
        }
        const { tag, proficiency, q } = Object.fromEntries(url.searchParams);
        let out = arr;
        if (tag) out = out.filter(o => (o.tags || []).includes(tag));
        if (proficiency) out = out.filter(o => o.proficiency === proficiency);
        const field = kind === 'words' ? 'word' : 'en';
        if (q) out = out.filter(o => (o[field] || '').toLowerCase().includes(q.toLowerCase()));
        out = out.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return send(res, 200, out);
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (kind === 'words' && !body.word) return send(res, 400, { error: 'word required' });
        if (kind === 'sentences' && !body.en) return send(res, 400, { error: 'en required' });
        if (kind === 'phrases' && !body.en) return send(res, 400, { error: 'en required' });
        const item = { id: uid(), createdAt: now(), updatedAt: now(), ...body };
        arr.push(item);
        syncTags(item.tags);
        persist(name, arr);
        return send(res, 201, item);
      }
      if (req.method === 'PUT' && id) {
        const i = arr.findIndex(o => o.id === id);
        if (i < 0) return send(res, 404, { error: 'not found' });
        const body = await readBody(req);
        arr[i] = { ...arr[i], ...body, id, updatedAt: now() };
        syncTags(arr[i].tags);
        persist(name, arr);
        return send(res, 200, arr[i]);
      }
      if (req.method === 'DELETE' && id) {
        const i = arr.findIndex(o => o.id === id);
        if (i < 0) return send(res, 404, { error: 'not found' });
        arr.splice(i, 1);
        persist(name, arr);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    let fp = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
    if (!fp.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`IELTS 词汇本 running at http://localhost:${PORT}`));
}

module.exports = { db, loadAll, persist, syncTags, fetchDict, translatePhrase, uid, now };

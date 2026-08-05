/* ============ 词汇本 · IELTS 前端逻辑 ============ */
const PROF = {
  mastered:   { label: '熟练', color: 'var(--green)' },
  medium:     { label: '中等', color: 'var(--amber)' },
  unfamiliar: { label: '不熟', color: 'var(--red)' },
};
const PROF_LIST = ['mastered', 'medium', 'unfamiliar'];

const state = {
  view: location.hash === '#sentences' ? 'sentences' : 'words',
  words: [],
  sentences: [],
  tags: [],
  filters: { tag: '', prof: '', q: '' },
  detailWordId: null,
  openSentenceId: null,
};

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) { let e; try { e = await r.json(); } catch {} throw new Error((e && e.error) || '请求失败'); }
  return r.json();
}
let toastTimer;
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function stampHtml(prof) {
  const p = PROF[prof] || PROF.medium;
  return `<span class="stamp" style="--c:${p.color}">${p.label}</span>`;
}
function tagsHtml(tags) {
  return (tags || []).map(t => `<span class="chip" style="pointer-events:none">${esc(t)}</span>`).join('');
}
function parsePairs(text, a, b) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('|');
    return i >= 0 ? { [a]: l.slice(0, i).trim(), [b]: l.slice(i + 1).trim() } : { [a]: l.trim(), [b]: '' };
  });
}
function toPairsText(arr, a, b) {
  return (arr || []).map(o => `${o[a] || ''} | ${o[b] || ''}`).join('\n');
}
function parseTags(text) {
  return [...new Set(String(text || '').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean))];
}
function firstDef(w) {
  return w.chinese || ((w.definitions || [])[0] ? w.definitions[0].mean : '');
}

/* ---------- data ---------- */
async function loadAll() {
  const [words, sentences, tagsRes] = await Promise.all([api('/api/words'), api('/api/sentences'), api('/api/tags')]);
  state.words = words;
  state.sentences = sentences;
  state.tags = tagsRes.tags || [];
}

/* ---------- render ---------- */
function render() {
  $('#app').innerHTML = '';
  if (state.view === 'words') renderWords();
  else renderSentences();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === state.view));
}

function filterBarHtml(extra) {
  const tagChips = state.tags.map(t => `<button class="chip${state.filters.tag === t ? ' is-active' : ''}" data-action="set-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  const profChips = PROF_LIST.map(p => `<button class="pf${state.filters.prof === p ? ' is-active' : ''}" style="--c:${PROF[p].color}" data-action="set-prof" data-prof="${p}"><span class="dot"></span>${PROF[p].label}</button>`).join('');
  return `
  <div class="filterbar">
    <input class="search" id="search" type="search" placeholder="${extra === 'word' ? '搜索单词…' : '搜索句子…'}" value="${esc(state.filters.q)}">
    <div class="filters">
      ${tagChips}
      <button class="chip is-add" data-action="add-tag">标签管理</button>
      ${(state.filters.tag || state.filters.prof) ? `<button class="chip" data-action="clear-filter">清除筛选</button>` : ''}
    </div>
    <div class="filters">${profChips}</div>
  </div>`;
}

/* ---------- 单词库 ---------- */
function renderWords() {
  const app = $('#app');
  if (state.detailWordId) {
    const w = state.words.find(x => x.id === state.detailWordId);
    if (w) { app.innerHTML = wordDetailHtml(w); return; }
    state.detailWordId = null;
  }
  let list = state.words;
  if (state.filters.tag) list = list.filter(w => (w.tags || []).includes(state.filters.tag));
  if (state.filters.prof) list = list.filter(w => w.proficiency === state.filters.prof);
  if (state.filters.q) list = list.filter(w => (w.word || '').toLowerCase().includes(state.filters.q.toLowerCase()));
  const cards = list.map(wordCardHtml).join('');
  const empty = `<div class="empty"><div class="big">空白的一页</div><p>还没有符合条件的单词。</p><button class="btn btn-brand" data-action="open-add-word">＋ 新建单词</button></div>`;
  app.innerHTML = filterBarHtml('word') + (cards ? `<div class="grid" id="wordList">${cards}</div>` : empty);
}

function wordCardHtml(w) {
  return `
  <div class="wcard" data-action="open-word" data-id="${w.id}">
    ${stampHtml(w.proficiency)}
    <div class="head"><span class="word">${esc(w.word)}</span><span class="pho">${esc(w.phonetic_us || w.phonetic_uk || '')}</span></div>
    <div class="def">${esc(firstDef(w))}</div>
    <div class="foot">${tagsHtml(w.tags)}</div>
  </div>`;
}

function wordDetailHtml(w) {
  const exams = (w.exam_types || []).map(t => `<span class="exam-tag">${esc(t)}</span>`).join('');
  const defs = (w.definitions || []).map(d => `<div class="def-line"><span class="pos">${esc(d.pos)}</span><span class="mean">${esc(d.mean)}</span></div>`).join('');
  const phrs = (w.phrases || []).map(p => `<div class="phr-item"><span class="ph">${esc(p.phrase)}</span><span class="pm">${esc(p.mean)}</span></div>`).join('');
  const rels = (w.related || []).map(r => `<span class="rel-chip"><b>${esc(r.word)}</b>${r.mean ? `<span>${esc(r.mean)}</span>` : ''}</span>`).join('');
  const synos = (w.synonyms || []).map(s => `<div class="syno-line"><span class="ws">${esc(s.word)}</span>${s.mean ? `<span class="mean">${esc(s.mean)}</span>` : ''}</div>`).join('');
  const exs = (w.examples || []).map(e => `<div class="ex-line"><div class="en">${esc(e.en)}</div>${e.cn ? `<div class="cn">${esc(e.cn)}</div>` : ''}</div>`).join('');
  const webs = (w.web || []).map(x => `<div class="ex-line"><div class="cn">${esc(x)}</div></div>`).join('');
  return `
  <div class="detail">
    <div class="detail-bar">
      <button class="btn btn-sm" data-action="back-word">← 返回词库</button>
      <span style="margin-left:auto"></span>
      ${stampHtml(w.proficiency)}
    </div>
    <div class="detail-body">
      <div class="hero">
        <span class="hw">${esc(w.word)}</span>
        ${w.phonetic_us ? `<span class="pho">英 ${esc(w.phonetic_us)}</span>` : ''}
        ${w.phonetic_uk ? `<span class="pho">美 ${esc(w.phonetic_uk)}</span>` : ''}
      </div>
      ${exams ? `<div class="exams">${exams}</div>` : ''}
      ${defs ? `<div class="block"><div class="block-title">释义</div>${defs}</div>` : ''}
      ${phrs ? `<div class="block"><div class="block-title">词组 · 短语</div>${phrs}</div>` : ''}
      ${rels ? `<div class="block"><div class="block-title">相关词</div><div class="rel-wrap">${rels}</div></div>` : ''}
      ${synos ? `<div class="block"><div class="block-title">同义词</div>${synos}</div>` : ''}
      ${exs ? `<div class="block"><div class="block-title">例句</div>${exs}</div>` : ''}
      ${webs ? `<div class="block"><div class="block-title">网络释义</div>${webs}</div>` : ''}
      <div class="detail-tags">
        <span style="font-size:12.5px;color:var(--ink-soft);font-weight:600;margin-right:4px">标签</span>
        ${tagsHtml(w.tags)}
      </div>
      <div class="detail-actions">
        <button class="btn" data-action="edit-word" data-id="${w.id}">编辑</button>
        <button class="btn btn-ghost" data-action="del-word" data-id="${w.id}">删除</button>
      </div>
    </div>
  </div>`;
}

/* ---------- 句子库 ---------- */
function renderSentences() {
  const app = $('#app');
  let list = state.sentences;
  if (state.filters.tag) list = list.filter(s => (s.tags || []).includes(state.filters.tag));
  if (state.filters.prof) list = list.filter(s => s.proficiency === state.filters.prof);
  if (state.filters.q) list = list.filter(s => (s.en || '').toLowerCase().includes(state.filters.q.toLowerCase()));
  const cards = list.map(sentenceCardHtml).join('');
  const empty = `<div class="empty"><div class="big">从一句开始</div><p>把你的作文好句收进来，让 AI 帮你拆解结构、再造新句。</p></div>`;
  app.innerHTML = `
    ${filterBarHtml('sentence')}
    <div class="composer">
      <h3>收录一句英文</h3>
      <p class="hint">输入后点击「AI 分析」，给出中文示意、作文可用结构与表达，并另造新例句；或点击「直接保存」仅存储。</p>
      <textarea id="composerInput" placeholder="The government should take effective measures to tackle the problem of air pollution."></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-brand" data-action="analyze-sentence">⚡ AI 分析并生成</button>
        <button class="btn" data-action="save-sentence-plain">直接保存</button>
        <span id="analyzeNote" style="font-size:12.5px;color:var(--ink-soft)"></span>
      </div>
    </div>
    <div class="slist" id="sentenceList">${cards || empty}</div>`;
}

function sentenceCardHtml(s) {
  const open = state.openSentenceId === s.id;
  const strNames = (s.structures || []).map(x => x.name).filter(Boolean).slice(0, 3);
  const chips = strNames.map(n => `<span class="str-chip">${esc(n)}</span>`).join('');
  let body = '';
  if (open) {
    const structures = (s.structures || []).map(x => `<div style="padding:6px 0;border-bottom:1px dashed var(--line)"><div style="font-weight:600;color:var(--brand)">${esc(x.name)}</div>${x.usage ? `<div class="usage">${esc(x.usage)}</div>` : ''}</div>`).join('');
    const expressions = (s.expressions || []).map(x => `<div style="padding:6px 0;border-bottom:1px dashed var(--line)"><span class="exp-chip">${esc(x.text)}</span>${x.note ? `<span class="usage">　${esc(x.note)}</span>` : ''}</div>`).join('');
    const news = (s.new_examples || []).map(n => `<div class="s-new"><div class="ne">${esc(n)}</div></div>`).join('');
    body = `
    <div class="s-body">
      ${s.cn ? `<div style="color:var(--ink);font-size:14.5px">${esc(s.cn)}</div>` : ''}
      ${structures ? `<div class="g-title">作文可用结构</div>${structures}` : ''}
      ${expressions ? `<div class="g-title">表达 · 固定搭配</div>${expressions}` : ''}
      ${news ? `<div class="g-title">另造的例句</div>${news}` : ''}
      <div class="detail-tags">${tagsHtml(s.tags)}</div>
      <div class="s-actions">
        <button class="btn btn-sm" data-action="edit-sentence" data-id="${s.id}">编辑</button>
        <button class="btn btn-sm btn-ghost" data-action="del-sentence" data-id="${s.id}">删除</button>
      </div>
    </div>`;
  }
  return `
  <div class="scard${open ? ' open' : ''}" data-action="toggle-sentence" data-id="${s.id}">
    ${stampHtml(s.proficiency)}
    <div class="sen">${esc(s.en)}</div>
    ${s.cn ? `<div class="cn">${esc(s.cn)}</div>` : ''}
    <div class="meta">
      <span class="tags">${tagsHtml(s.tags)}</span>
      ${chips}
    </div>
    ${body}
  </div>`;
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml, footHtml = '') {
  const root = $('#modalRoot');
  root.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-close>×</button></div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('#backdrop').addEventListener('mousedown', e => { if (e.target.id === 'backdrop') close(); });
  return { close, root };
}

/* ---------- 单词表单 ---------- */
function wordFormHtml(w = {}) {
  return `
  <div class="field row2">
    <div><label>单词</label><input id="f-word" type="text" value="${esc(w.word || '')}" required></div>
    <div><label>音标（美）</label><input id="f-pho-us" type="text" value="${esc(w.phonetic_us || '')}" placeholder="/əˈbændən/"></div>
  </div>
  <div class="field"><label>中文概要（卡片显示用）</label><input id="f-chinese" type="text" value="${esc(w.chinese || '')}" placeholder="v. 放弃；抛弃"></div>
  <div class="field"><label>释义（每行：词性 | 中文）</label><textarea id="f-defs">${esc(toPairsText(w.definitions, 'pos', 'mean'))}</textarea></div>
  <div class="field"><label>词组 · 短语（每行：短语 | 含义）</label><textarea id="f-phrs">${esc(toPairsText(w.phrases, 'phrase', 'mean'))}</textarea></div>
  <div class="field"><label>相关词（每行：单词 | 含义）</label><textarea id="f-rels">${esc(toPairsText(w.related, 'word', 'mean'))}</textarea></div>
  <div class="field"><label>同义词（每行：单词 | 含义）</label><textarea id="f-synos">${esc(toPairsText(w.synonyms, 'word', 'mean'))}</textarea></div>
  <div class="field"><label>例句（每行：英文 | 中文）</label><textarea id="f-exs">${esc(toPairsText(w.examples, 'en', 'cn'))}</textarea></div>
  <div class="field"><label>标签（逗号分隔，如 IELTS, 作文, 阅读）</label><input id="f-tags" type="text" value="${esc((w.tags || []).join(', '))}"></div>
  <div class="field"><label>熟练度</label><div class="prof-pick" id="f-prof">${PROF_LIST.map(p => `<button data-prof="${p}" style="--c:${PROF[p].color}"><span class="dot"></span>${PROF[p].label}</button>`).join('')}</div></div>`;
}

function readWordForm() {
  const val = id => $(id).value;
  const profBtn = $('#f-prof').querySelector('.is-active');
  return {
    word: val('#f-word').trim(),
    phonetic_us: val('#f-pho-us').trim(),
    chinese: val('#f-chinese').trim(),
    definitions: parsePairs(val('#f-defs'), 'pos', 'mean'),
    phrases: parsePairs(val('#f-phrs'), 'phrase', 'mean'),
    related: parsePairs(val('#f-rels'), 'word', 'mean'),
    synonyms: parsePairs(val('#f-synos'), 'word', 'mean'),
    examples: parsePairs(val('#f-exs'), 'en', 'cn'),
    tags: parseTags(val('#f-tags')),
    proficiency: profBtn ? profBtn.dataset.prof : 'medium',
  };
}

let lastModal = null;

function openAddWordModal() {
  lastModal = openModal('新建单词', `
    <div class="field">
      <label>英文单词</label>
      <div style="display:flex;gap:8px">
        <input id="lookup-word" type="text" placeholder="如：abandon" style="flex:1" autocomplete="off">
        <button class="btn btn-brand" id="lookup-btn">查词并填充</button>
      </div>
      <div class="sub" id="lookup-note"></div>
    </div>
    <div id="word-form-wrap" style="display:none">${wordFormHtml()}</div>`,
    `<button class="btn" data-cancel>取消</button><button class="btn btn-brand" id="save-word">保存到单词本</button>`);
  const wrap = $('#word-form-wrap');
  const note = $('#lookup-note');
  const root = lastModal.root;
  root.querySelector('[data-cancel]').onclick = () => lastModal.close();
  $('#lookup-btn').onclick = async () => {
    const q = $('#lookup-word').value.trim();
    if (!q) return;
    const btn = $('#lookup-btn'); btn.disabled = true;
    note.innerHTML = `<span class="loading"><span class="spinner"></span>正在查询有道词典…</span>`;
    try {
      const d = await api('/api/dict?q=' + encodeURIComponent(q));
      wrap.style.display = 'block';
      $('#f-word').value = d.word || q;
      $('#f-pho-us').value = d.phonetic_us || '';
      $('#f-chinese').value = d.definitions[0] ? `${d.definitions[0].pos} ${d.definitions[0].mean}`.trim() : '';
      $('#f-defs').value = toPairsText(d.definitions, 'pos', 'mean');
      $('#f-phrs').value = toPairsText(d.phrases, 'phrase', 'mean');
      $('#f-rels').value = toPairsText(d.related, 'word', 'mean');
      $('#f-synos').value = toPairsText(d.synonyms, 'word', 'mean');
      $('#f-exs').value = toPairsText(d.examples, 'en', 'cn');
      const has = d.definitions.length || d.phrases.length || d.examples.length;
      note.innerHTML = has
        ? `<span style="color:var(--green);font-weight:600">✓ 已从有道自动填充，可自行修改</span>`
        : `<span style="color:var(--accent)">未查到释义，请手动填写。</span>`;
    } catch (e) {
      note.innerHTML = `<span style="color:var(--red)">查词失败：${esc(e.message)}。可手动填写。</span>`;
      wrap.style.display = 'block';
    } finally { btn.disabled = false; }
  };
  $('#save-word').onclick = async () => {
    try {
      const data = readWordForm();
      if (!data.word) { toast('请填写单词', true); return; }
      await api('/api/words', { method: 'POST', body: JSON.stringify(data) });
      await loadAll();
      toast(`已收录「${data.word}」`);
      lastModal.close();
      render();
    } catch (e) { toast(e.message, true); }
  };
}

function openEditWordModal(id) {
  const w = state.words.find(x => x.id === id);
  if (!w) return;
  lastModal = openModal('编辑单词', wordFormHtml(w), `<button class="btn" data-cancel>取消</button><button class="btn btn-brand" id="save-word">保存修改</button>`);
  lastModal.root.querySelector('[data-cancel]').onclick = () => lastModal.close();
  $('#save-word').onclick = async () => {
    try {
      const data = readWordForm();
      if (!data.word) { toast('请填写单词', true); return; }
      await api('/api/words/' + id, { method: 'PUT', body: JSON.stringify(data) });
      await loadAll();
      toast('已保存');
      lastModal.close();
      render();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- 句子编辑 ---------- */
function sentenceFormHtml(s = {}) {
  return `
  <div class="field"><label>英文句子</label><textarea id="f-en" style="min-height:64px">${esc(s.en || '')}</textarea></div>
  <div class="field"><label>中文示意</label><textarea id="f-cn" style="min-height:44px">${esc(s.cn || '')}</textarea></div>
  <div class="field"><label>作文可用结构（每行：结构 | 用法）</label><textarea id="f-strs">${esc(toPairsText(s.structures, 'name', 'usage'))}</textarea></div>
  <div class="field"><label>表达 · 固定搭配（每行：表达 | 说明）</label><textarea id="f-exprs">${esc(toPairsText(s.expressions, 'text', 'note'))}</textarea></div>
  <div class="field"><label>另造的例句（每行一句）</label><textarea id="f-news">${esc((s.new_examples || []).join('\n'))}</textarea></div>
  <div class="field"><label>标签（逗号分隔）</label><input id="f-tags" type="text" value="${esc((s.tags || []).join(', '))}"></div>
  <div class="field"><label>熟练度</label><div class="prof-pick" id="f-prof">${PROF_LIST.map(p => `<button data-prof="${p}" style="--c:${PROF[p].color}"><span class="dot"></span>${PROF[p].label}</button>`).join('')}</div></div>`;
}

function readSentenceForm() {
  const val = id => $(id).value;
  const profBtn = $('#f-prof').querySelector('.is-active');
  return {
    en: val('#f-en').trim(),
    cn: val('#f-cn').trim(),
    structures: parsePairs(val('#f-strs'), 'name', 'usage'),
    expressions: parsePairs(val('#f-exprs'), 'text', 'note'),
    new_examples: val('#f-news').split('\n').map(l => l.trim()).filter(Boolean),
    tags: parseTags(val('#f-tags')),
    proficiency: profBtn ? profBtn.dataset.prof : 'medium',
  };
}

function openAnalyzeSentence() {
  const input = $('#composerInput');
  const en = input.value.trim();
  if (!en) { toast('请先输入英文句子', true); return; }
  const note = $('#analyzeNote');
  note.innerHTML = `<span class="loading"><span class="spinner"></span>AI 分析中，请稍候…</span>`;
  api('/api/analyze', { method: 'POST', body: JSON.stringify({ sentence: en }) })
    .then(res => {
      if (res.error) throw new Error(res.message || res.error);
      input.value = '';
      openSentenceEditor({ en, ...res });
    })
    .catch(e => {
      note.innerHTML = '';
      toast(e.message, true);
    })
    .finally(() => { note.innerHTML = ''; });
}

function openSentenceEditor(s, id = null) {
  const hasAI = (s.cn || (s.structures || []).length || (s.expressions || []).length || (s.new_examples || []).length);
  lastModal = openModal(id ? '编辑句子' : (hasAI ? 'AI 已生成分析，可修改后保存' : '保存句子'),
    sentenceFormHtml(s),
    `<button class="btn" data-cancel>取消</button><button class="btn btn-brand" id="save-sentence">${id ? '保存修改' : '保存到句子库'}</button>`);
  lastModal.root.querySelector('[data-cancel]').onclick = () => lastModal.close();
  $('#save-sentence').onclick = async () => {
    try {
      const data = readSentenceForm();
      if (!data.en) { toast('请填写英文句子', true); return; }
      const path = id ? '/api/sentences/' + id : '/api/sentences';
      const method = id ? 'PUT' : 'POST';
      await api(path, { method, body: JSON.stringify(data) });
      await loadAll();
      toast(id ? '已保存' : '已收录句子');
      lastModal.close();
      render();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- settings ---------- */
async function openSettingsModal() {
  let s;
  try { s = await api('/api/settings'); }
  catch (e) { toast('读取设置失败：' + e.message, true); return; }
  lastModal = openModal('AI 设置', `
    <div class="field">
      <label>API Key（DeepSeek 或任意 OpenAI 兼容接口）</label>
      <input id="set-key" type="password" placeholder="${s.hasKey ? '已配置，留空则不修改' : '未配置，留空则仅能本地存储'}" autocomplete="off">
      <div class="sub" id="set-status" style="color:${s.hasKey ? 'var(--green)' : 'var(--red)'};font-weight:600">
        ${s.hasKey ? '✓ Key 已配置，句子 AI 分析可用' : '✗ 未配置 Key——句子只能直接保存，无法 AI 分析'}
      </div>
      <div class="sub">Key 仅保存在你本机的 data/settings.json，不会上传、不会写入代码仓库，也不会随页面发送。</div>
    </div>
    <div class="field row2">
      <div><label>接口地址</label><input id="set-base" type="text" value="${esc(s.apiBase)}" autocomplete="off"></div>
      <div><label>模型</label><input id="set-model" type="text" value="${esc(s.apiModel)}" autocomplete="off"></div>
    </div>`,
    `<button class="btn btn-ghost" id="set-clear">清除 Key</button><span style="flex:1"></span>
     <button class="btn" data-cancel>取消</button><button class="btn btn-brand" id="set-save">保存</button>`);
  lastModal.root.querySelector('[data-cancel]').onclick = () => lastModal.close();
  $('#set-clear').onclick = async () => {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ apiKey: null }) });
    toast('已清除 Key');
    lastModal.close();
  };
  $('#set-save').onclick = async () => {
    const body = {};
    const k = $('#set-key').value.trim();
    if (k) body.apiKey = k;
    body.apiBase = $('#set-base').value.trim() || undefined;
    body.apiModel = $('#set-model').value.trim() || undefined;
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('已保存');
    lastModal.close();
  };
}

/* ---------- tag add ---------- */
function openTagManager() {
  lastModal = openModal('标签管理', `
    <div class="field">
      <label>新建标签（如：科技、自然、教育…）</label>
      <div style="display:flex;gap:8px">
        <input id="new-tag-input" type="text" placeholder="输入新标签名" style="flex:1" autocomplete="off">
        <button class="btn btn-brand" id="add-tag-btn">添加</button>
      </div>
    </div>
    <div id="tag-list"></div>`,
    `<button class="btn" data-cancel>关闭</button>`);
  lastModal.root.querySelector('[data-cancel]').onclick = () => lastModal.close();

  const renderTags = () => {
    const el = $('#tag-list');
    el.innerHTML = state.tags.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px dashed var(--line)">
        <span style="flex:1;font-weight:600;color:var(--brand)">${esc(t)}</span>
        <button class="btn btn-sm" data-rename="${esc(t)}">重命名</button>
        <button class="btn btn-sm btn-ghost" data-del-tag="${esc(t)}">删除</button>
      </div>`).join('') || '<div style="color:var(--ink-soft);padding:8px 2px">暂无标签</div>';
  };
  renderTags();

  $('#add-tag-btn').onclick = async () => {
    const name = $('#new-tag-input').value.trim();
    if (!name) { toast('请输入标签名', true); return; }
    await api('/api/tags', { method: 'POST', body: JSON.stringify({ name }) });
    await loadAll();
    renderTags();
    $('#new-tag-input').value = '';
    toast(`已添加标签「${name}」`);
  };
  $('#new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#add-tag-btn').click();
  });

  let renaming = null;
  $('#tag-list').addEventListener('click', async e => {
    const del = e.target.closest('[data-del-tag]');
    if (del) {
      const name = del.dataset.delTag;
      if (confirm(`删除标签「${name}」？该标签会从所有单词和句子中移除。`)) {
        await api('/api/tag/' + encodeURIComponent(name), { method: 'DELETE' });
        if (state.filters.tag === name) state.filters.tag = '';
        await loadAll();
        renderTags();
        toast('已删除标签');
      }
      return;
    }
    const rn = e.target.closest('[data-rename]');
    if (rn && !renaming) {
      const name = rn.dataset.rename;
      renaming = name;
      rn.outerHTML = `<input id="rename-input" type="text" value="${esc(name)}" style="flex:1" autocomplete="off">`;
      const inp = $('#rename-input');
      inp.focus();
      inp.onkeydown = async ev => {
        if (ev.key === 'Enter') await doRename(inp.value.trim());
        else if (ev.key === 'Escape') { renaming = null; renderTags(); }
      };
      inp.onblur = async () => {
        if (!renaming) return;
        const v = inp.value.trim();
        renaming = null;
        if (v) await doRename(v);
        else renderTags();
      };
      async function doRename(newName) {
        renaming = null;
        if (newName === name) { renderTags(); return; }
        await api('/api/tag/' + encodeURIComponent(name), { method: 'PUT', body: JSON.stringify({ newName }) });
        if (state.filters.tag === name) state.filters.tag = newName;
        await loadAll();
        renderTags();
        toast(`已重命名「${name}」→「${newName}」`);
      }
    }
  });
}

/* ---------- events ---------- */
function wireEvents() {
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (!b) return;
    state.view = b.dataset.view;
    location.hash = state.view;
    state.detailWordId = null;
    state.openSentenceId = null;
    render();
  });
  $('#addBtn').addEventListener('click', () => {
    if (state.view === 'words') openAddWordModal();
    else { render(); const c = $('#composerInput'); if (c) c.focus(); }
  });
  $('#settingsBtn').addEventListener('click', openSettingsModal);
  $('#app').addEventListener('click', async e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const act = t.dataset.action;
    if (act === 'open-word') {
      state.detailWordId = t.dataset.id;
      render();
    } else if (act === 'back-word') {
      state.detailWordId = null;
      render();
    } else if (act === 'edit-word') {
      openEditWordModal(t.dataset.id);
    } else if (act === 'del-word') {
      const w = state.words.find(x => x.id === t.dataset.id);
      if (confirm(`删除单词「${w ? w.word : ''}」？此操作不可恢复。`)) {
        await api('/api/words/' + t.dataset.id, { method: 'DELETE' });
        await loadAll();
        state.detailWordId = null;
        toast('已删除');
        render();
      }
    } else if (act === 'toggle-sentence') {
      state.openSentenceId = state.openSentenceId === t.dataset.id ? null : t.dataset.id;
      render();
    } else if (act === 'edit-sentence') {
      const s = state.sentences.find(x => x.id === t.dataset.id);
      if (s) openSentenceEditor(s, s.id);
    } else if (act === 'del-sentence') {
      if (confirm('删除这条句子？')) {
        await api('/api/sentences/' + t.dataset.id, { method: 'DELETE' });
        await loadAll();
        state.openSentenceId = null;
        toast('已删除');
        render();
      }
    } else if (act === 'analyze-sentence') {
      openAnalyzeSentence();
    } else if (act === 'save-sentence-plain') {
      const en = ($('#composerInput') || {}).value ? $('#composerInput').value.trim() : '';
      if (!en) { toast('请先输入英文句子', true); return; }
      $('#composerInput').value = '';
      openSentenceEditor({ en });
    } else if (act === 'set-tag') {
      state.filters.tag = state.filters.tag === t.dataset.tag ? '' : t.dataset.tag;
      render();
    } else if (act === 'set-prof') {
      state.filters.prof = state.filters.prof === t.dataset.prof ? '' : t.dataset.prof;
      render();
    } else if (act === 'clear-filter') {
      state.filters = { tag: '', prof: '', q: '' };
      $('#search').value = '';
      render();
    } else if (act === 'add-tag') {
      openTagManager();
    } else if (act === 'open-add-word') {
      openAddWordModal();
    }
  });
  $('#app').addEventListener('input', e => {
    if (e.target.id === 'search') {
      state.filters.q = e.target.value.trim();
      const applyFilter = items => {
        let list = items;
        if (state.filters.tag) list = list.filter(o => (o.tags || []).includes(state.filters.tag));
        if (state.filters.prof) list = list.filter(o => o.proficiency === state.filters.prof);
        if (state.filters.q) list = list.filter(o => ((state.view === 'words' ? o.word : o.en) || '').toLowerCase().includes(state.filters.q.toLowerCase()));
        return list;
      };
      if (state.view === 'words') {
        const grid = $('#wordList');
        if (grid) grid.innerHTML = applyFilter(state.words).map(wordCardHtml).join('') || '<div class="empty">无匹配单词</div>';
      } else {
        const list = $('#sentenceList');
        if (list) list.innerHTML = applyFilter(state.sentences).map(sentenceCardHtml).join('') || '<div class="empty">无匹配句子</div>';
      }
    }
  });
  // proficiency picker (delegated)
  document.addEventListener('click', e => {
    const b = e.target.closest('#f-prof button');
    if (!b) return;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });
}

/* ---------- init ---------- */
(async function init() {
  try {
    await loadAll();
  } catch (e) {
    toast('无法连接服务器：' + e.message, true);
  }
  wireEvents();
  render();
})();

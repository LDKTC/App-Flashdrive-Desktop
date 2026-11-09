const { invoke, convertFileSrc } = window.__TAURI__.core;
const $ = id => document.getElementById(id);
const src = p => convertFileSrc(p);
// icons from the sprite in index.html: NAME = mono, NAME-d = duotone, NAME-f = fill
const ic = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
function icon(name) { const t = document.createElement('template'); t.innerHTML = ic(name); return t.content.firstChild; }
const setIc = (e, name, label = '') => (e.innerHTML = ic(name) + label); // label: fixed UI text only
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let root = '', apps = [], images = [], music = [], videos = [], settings = {};

// ---------- clock ----------
function tick() {
  const d = new Date();
  const t = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  $('time').textContent = t;
  $('big').textContent = t;
  $('date').textContent = d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
}
tick();
setInterval(tick, 10000);

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 2500);
}

// ---------- screen stack (Android-like back) ----------
const stack = [];
function openScreen(id) {
  $(id).classList.add('open');
  $(id).style.zIndex = 10 + stack.length;
  stack.push(id);
}
function back() {
  const t = trees[stack.at(-1)];
  if (t?.path.length) { t.path.pop(); return renderTree(t); } // up one folder
  const id = stack.pop();
  if (!id) return;
  $(id).classList.remove('open');
  if (id === 'album') stopSelecting();
}
document.querySelectorAll('.back').forEach(b => (b.onclick = back));
document.addEventListener('keydown', e => {
  if (e.target === $('q')) return;
  if (e.key === 'Escape' && $('player').classList.contains('big')) return setBig(false);
  if (e.key === 'Backspace' && stack.at(-1) === 'files') return up();
  if (stack.at(-1) === 'viewer' && e.key === 'ArrowLeft') show(cur - 1);
  else if (stack.at(-1) === 'viewer' && e.key === 'ArrowRight') show(cur + 1);
  else if (e.key === 'Escape' || e.key === 'Backspace') back();
});

// ---------- home screen ----------
function renderApps() {
  const q = $('q').value.trim().toLowerCase();
  const list = apps.filter(a => a.name.toLowerCase().includes(q));
  $('grid').replaceChildren(...list.map(a => {
    const b = el('button', 'app');
    b.title = a.path;
    const icon = el('div', 'icon');
    if (a.icon) { const img = new Image(); img.src = a.icon; img.alt = ''; icon.append(img); }
    else icon.textContent = a.name[0]?.toUpperCase() || '?';
    b.append(icon, el('span', null, a.name));
    b.onclick = () => invoke('open', { path: a.path }).catch(e => toast('เปิดไม่ได้: ' + e));
    return b;
  }));
  if (!list.length) $('grid').replaceChildren(el('p', 'empty', apps.length ? 'ไม่พบแอปที่ค้นหา' : 'ไม่พบแอปในแฟลชไดรฟ์ (.exe, .lnk, .bat, .AppImage, .app)'));
}
$('q').oninput = renderApps;
$('openFiles').onclick = () => openFiles(root);
$('refresh').onclick = () => load().then(() => toast('รีเฟรชแล้ว'));

// ---------- albums = the drive's folder tree (gallery, music, videos) ----------
function renderAlbums(box, list, cls, cover, unit, onOpen) {
  box.replaceChildren(...list.map(a => {
    const b = el('button', 'album ' + cls);
    const c = el('div', 'cover');
    c.append(cover(a));
    b.append(c, el('b', null, a.title), el('small', null, a.note || `${a.items.length} ${unit}`));
    b.onclick = () => onOpen(a);
    return b;
  }));
  if (!list.length) box.replaceChildren(el('p', 'empty', 'ไม่พบไฟล์ในแฟลชไดรฟ์'));
}

// one level of the tree: files directly in `pre`, and files per subfolder (recursive)
function treeLevel(items, pre) {
  const here = [], subs = new Map();
  for (const it of items) {
    if (!it.rel.startsWith(pre)) continue;
    const rest = it.rel.slice(pre.length), k = rest.indexOf('/');
    if (k < 0) { here.push(it); continue; }
    const n = rest.slice(0, k);
    if (!subs.has(n)) subs.set(n, { items: [], folders: new Set() });
    const s = subs.get(n), j = rest.indexOf('/', k + 1);
    s.items.push(it);
    if (j > 0) s.folders.add(rest.slice(k + 1, j));
  }
  return { here, subs };
}
const absDir = (it, rel) => { // drive path of folder `rel`, from any photo under it
  const base = it.path.slice(0, it.path.length - it.rel.length), sep = base.includes('\\') ? '\\' : '/';
  return base + rel.replaceAll('/', sep);
};
const imgCover = a => { const i = new Image(); i.loading = 'lazy'; i.decoding = 'async'; i.src = src(a.items[0].path); i.alt = ''; return i; };
// first frame of the album's first clip, loaded when the card scrolls into view (gradient shows until then / if it can't decode)
const vidCover = a => { const v = el('video'); v.muted = true; v.preload = 'metadata'; v.dataset.src = src(a.items[0].path) + '#t=1'; thumbs.observe(v); return v; };
// per screen id: what it lists, where it renders, what a leaf album opens; path = folders from the drive root down
const trees = {
  gallery: { list: () => images, box: 'galleryAlbums', head: 'galleryTitle', count: 'galleryCount', name: 'แกลเลอรี', unit: 'รูป', all: 'ทุกรูป', cls: '', cover: imgCover, open: a => openAlbum(a), path: [] },
  music: { list: () => music, box: 'musicAlbums', head: 'musicTitle', count: 'musicCount', name: 'เพลง', unit: 'เพลง', all: 'ทุกเพลง', cls: 'music', cover: () => icon('music-notes-d'), open: a => openTracks(a), path: [] },
  videosScreen: { list: () => videos, box: 'videoAlbums', head: 'videosTitle', count: 'videosCount', name: 'วิดีโอ', unit: 'วิดีโอ', all: 'ทุกวิดีโอ', cls: 'video', cover: vidCover, open: a => openClips(a), path: [] },
};
function renderTree(t) {
  const pre = t.path.length ? t.path.join('/') + '/' : '';
  const { here, subs } = treeLevel(t.list(), pre);
  const all = [...here, ...[...subs.values()].flatMap(s => s.items)];
  const cards = [...subs].sort((a, b) => a[0].localeCompare(b[0], 'th')).map(([n, s]) => ({
    title: n, items: s.items, dir: absDir(s.items[0], pre + n), nest: s.folders.size,
    note: `${s.items.length} ${t.unit}` + (s.folders.size ? ` · ${s.folders.size} โฟลเดอร์` : ''),
  }));
  if (here.length && subs.size) cards.unshift({ title: 'ในโฟลเดอร์นี้', items: here, dir: here[0].dir });
  if (subs.size) cards.unshift({ title: t.all, items: all, deep: true, dir: pre ? absDir(all[0], pre.slice(0, -1)) : root });
  if (!subs.size && here.length) cards.push({ title: t.path.at(-1) || t.all, items: here, dir: here[0].dir });
  renderAlbums($(t.box), cards, t.cls, t.cover, t.unit, a => a.nest ? (t.path.push(a.title), renderTree(t)) : t.open(a));
  $(t.head).textContent = t.path.at(-1) || t.name;
  $(t.count).textContent = `${all.length} ${t.unit}`;
  $(t.box).parentElement.scrollTop = 0; // .content scrolls
}
function openTree(id) { trees[id].path = []; renderTree(trees[id]); openScreen(id); }
$('openGallery').onclick = () => openTree('gallery');

let curAlbum = null, selecting = false;
const selected = new Set();
function openAlbum(a) { renderAlbum(a); openScreen('album'); }
function renderAlbum(a) {
  curAlbum = a;
  $('albumTitle').textContent = a.title;
  $('albumCount').textContent = a.items.length + ' รูป';
  $('photos').replaceChildren(...a.items.map((it, i) => {
    const d = el('div', 'ph');
    const img = new Image(); img.loading = 'lazy'; img.decoding = 'async'; img.src = src(it.path); img.alt = it.name; img.title = it.name;
    d.append(img);
    d.onclick = () => selecting ? toggleSel(d, it) : view(a.items, i);
    return d;
  }));
  $('albumFolder').onclick = () => openFiles(a.dir);
}

// selecting photos for a wallpaper slideshow
$('selectBtn').onclick = () => (selecting ? stopSelecting() : startSelecting());
function startSelecting() {
  selecting = true; selected.clear();
  $('selbar').hidden = false; setIc($('selectBtn'), 'x', 'ยกเลิก');
  updSel();
}
function stopSelecting() {
  selecting = false; selected.clear();
  $('selbar').hidden = true; setIc($('selectBtn'), 'check-square', 'เลือก');
  document.querySelectorAll('.ph.sel').forEach(x => x.classList.remove('sel'));
}
function toggleSel(d, it) {
  selected.has(it.rel) ? selected.delete(it.rel) : selected.add(it.rel);
  d.classList.toggle('sel', selected.has(it.rel));
  updSel();
}
function updSel() {
  $('selCount').textContent = selected.size > 1 ? `เลือก ${selected.size} รูป · สไลด์โชว์ทุก ${settings.interval || 15} วินาที` : `เลือก ${selected.size} รูป`;
  $('setSlide').disabled = $('moveSel').disabled = !selected.size;
}
$('selAll').onclick = () => {
  curAlbum.items.forEach(it => selected.add(it.rel));
  document.querySelectorAll('.ph').forEach(d => d.classList.add('sel'));
  updSel();
};
$('setSlide').onclick = () => {
  const n = selected.size;
  setWallpaper([...selected]);
  stopSelecting();
  toast(n > 1 ? `ตั้งสไลด์วอลเปเปอร์ ${n} รูปแล้ว` : 'ตั้งวอลเปเปอร์แล้ว');
};
$('resetWp').onclick = () => { setWallpaper([]); toast('กลับไปใช้วอลเปเปอร์เริ่มต้นแล้ว'); };

// ---------- move selected photos to another folder ----------
let pkDir = '', pkToken = 0;
$('moveSel').onclick = () => {
  $('pkTitle').textContent = `ย้าย ${selected.size} รูปไปที่`;
  openScreen('picker');
  pickBrowse(curAlbum.dir);
};
async function pickBrowse(path) {
  const t = ++pkToken;
  let l;
  try { l = await invoke('list_dir', { path }); } catch (e) { return toast('เปิดโฟลเดอร์ไม่ได้: ' + e); }
  if (t !== pkToken) return;
  pkDir = l.path;
  const parts = [];
  l.crumbs.forEach(([name, p], i) => {
    if (i) parts.push(icon('caret-right'));
    const b = el('button', null, name);
    b.onclick = () => pickBrowse(p);
    parts.push(b);
  });
  $('pkCrumbs').replaceChildren(...parts);
  $('pkCrumbs').scrollLeft = 1e6;
  $('pkHere').disabled = pkDir === curAlbum.dir;
  const dirs = l.entries.filter(e => e.dir && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  renderAlbums($('pkDirs'), dirs.map(e => ({ title: e.name, path: e.path, note: 'โฟลเดอร์', items: [] })), 'folder',
    () => icon('folder-d'), '', e => pickBrowse(e.path));
  if (!dirs.length) $('pkDirs').replaceChildren(el('p', 'empty', 'ไม่มีโฟลเดอร์ย่อย · กด "ย้ายมาที่นี่" เพื่อย้ายเข้าโฟลเดอร์นี้'));
  $('pkDirs').parentElement.scrollTop = 0;
}
$('pkHere').onclick = async () => {
  const items = curAlbum.items.filter(it => selected.has(it.rel));
  $('pkHere').disabled = true;
  let r;
  try { r = await invoke('move_files', { paths: items.map(it => it.path), dest: pkDir }); }
  catch (e) { $('pkHere').disabled = false; return toast('ย้ายไม่ได้: ' + e); }
  const moved = new Map(r.moved.map(m => [m.from, m]));
  // update in place: the photo list, wallpaper references, then the open album and gallery
  const relMap = new Map();
  for (const it of images) {
    const m = moved.get(it.path);
    if (!m) continue;
    relMap.set(it.rel, m.rel);
    Object.assign(it, { path: m.path, rel: m.rel, dir: pkDir, album: pkDir.split(/[\\/]/).filter(Boolean).pop() || root });
  }
  if (settings.wallpaper?.some(w => relMap.has(w))) { settings.wallpaper = settings.wallpaper.map(w => relMap.get(w) || w); saveSettings(); }
  back(); // close the picker
  stopSelecting();
  // album items are the same objects as `images` (paths already updated): keep those still in this album
  const a = curAlbum, sep = a.dir.includes('\\') ? '\\' : '/';
  a.items = a.items.filter(it => a.deep ? it.path.startsWith(a.dir.endsWith(sep) ? a.dir : a.dir + sep) : it.dir === a.dir);
  renderTree(trees.gallery);
  if (a.items.length) renderAlbum(a); else back();
  toast(r.failed.length ? `ย้ายแล้ว ${r.moved.length} รูป · ไม่สำเร็จ ${r.failed.length}: ${r.failed[0]}` : `ย้ายแล้ว ${r.moved.length} รูป`);
};

// full-screen photo viewer
let viewList = [], cur = 0;
function view(list, i) { viewList = list; show(i); openScreen('viewer'); }
function show(i) {
  cur = (i + viewList.length) % viewList.length;
  $('viewImg').src = src(viewList[cur].path);
  $('cap').textContent = `${viewList[cur].name}  ·  ${cur + 1}/${viewList.length}`;
}
$('vPrev').onclick = () => show(cur - 1);
$('vNext').onclick = () => show(cur + 1);
$('vWp').onclick = () => { setWallpaper([viewList[cur].rel]); toast('ตั้งวอลเปเปอร์แล้ว'); };
let x0 = null;
$('viewer').addEventListener('touchstart', e => (x0 = e.touches[0].clientX));
$('viewer').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
});

// ---------- wallpaper (single photo or slideshow) ----------
let wpTimer, wpFront = 0;
function saveSettings() { invoke('set_settings', { json: JSON.stringify(settings) }).catch(e => toast('บันทึกไม่ได้: ' + e)); }
function setWallpaper(rels) { settings.wallpaper = rels; saveSettings(); applyWallpaper(); }
function applyWallpaper() {
  const byRel = new Map(images.map(i => [i.rel, i.path]));
  const list = (settings.wallpaper || []).map(r => byRel.get(r)).filter(Boolean); // skip photos no longer on the drive
  clearInterval(wpTimer);
  let i = 0;
  showWp(list[0]);
  // ponytail: fixed interval from settings.interval (default 15s); add a picker if people want to change it
  if (list.length > 1) wpTimer = setInterval(() => showWp(list[(i = (i + 1) % list.length)]), (settings.interval || 15) * 1000);
}
function showWp(path) {
  const next = $('wp' + (1 - wpFront)), prev = $('wp' + wpFront);
  if (path) next.style.backgroundImage = `linear-gradient(#0007, #0000 35%, #0000 70%, #0008), url("${src(path)}")`;
  next.style.opacity = path ? 1 : 0;
  prev.style.opacity = 0;
  wpFront = 1 - wpFront;
}

// ---------- music ----------
const trackName = t => t.name.replace(/\.[^.]+$/, '');
$('openMusic').onclick = () => openTree('music');
let curTracks = [];
function openTracks(a) {
  curTracks = a.items;
  $('tracksTitle').textContent = a.title;
  $('tracksCount').textContent = a.items.length + ' เพลง';
  $('trackList').replaceChildren(...a.items.map((t, i) => {
    const li = el('li');
    li.dataset.path = t.path;
    li.append(el('span', 'n', i + 1), el('span', 't', trackName(t)), el('small', null, t.album), addq(t));
    li.onclick = () => play(a.items, i);
    return li;
  }));
  $('tracksFolder').onclick = () => openFiles(a.dir);
  markPlaying();
  openScreen('tracks');
}
function addq(t) {
  const b = el('button', 'addq');
  setIc(b, 'list-plus');
  b.title = 'เพิ่มในคิว';
  b.onclick = e => { e.stopPropagation(); enqueue(t); };
  return b;
}

// ---------- videos ----------
$('openVideos').onclick = () => openTree('videosScreen');
// thumbnails: load a video's first frames only when its card scrolls into view
const thumbs = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.src = e.target.dataset.src;
  thumbs.unobserve(e.target);
}));
function openClips(a) {
  $('clipsTitle').textContent = a.title;
  $('clipsCount').textContent = a.items.length + ' วิดีโอ';
  $('clipGrid').replaceChildren(...a.items.map((t, i) => {
    const d = el('div', 'clip');
    d.dataset.path = t.path;
    const v = el('video');
    v.muted = true; v.preload = 'metadata'; v.dataset.src = src(t.path) + '#t=1';
    thumbs.observe(v);
    d.append(v, el('span', null, trackName(t)), addq(t));
    d.title = t.name;
    d.onclick = () => play(a.items, i);
    return d;
  }));
  $('clipsFolder').onclick = () => openFiles(a.dir);
  markPlaying();
  openScreen('clips');
}

$('playAll').onclick = () => play(curTracks, 0);
$('shuffle').onclick = () => play([...curTracks].sort(() => Math.random() - 0.5), 0);

// ---------- player (music + video share one element) ----------
const P = $('player'), media = $('media'), audio = media;
const isVideo = t => /\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(t.name);
let queue = [], qi = 0;
const REPEAT = { off: ['repeat', 'วนซ้ำ: ปิด'], all: ['repeat', 'วนซ้ำ: ทั้งคิว'], one: ['repeat-once', 'วนซ้ำ: เพลง/คลิปเดียว'] };
const NEXT_REPEAT = { off: 'all', all: 'one', one: 'off' };

// replace the queue with a list (album, shuffle, ...) and start at i
function play(list, i) {
  if (!list.length) return;
  queue = [...list];
  start(i);
  if (!mini && isVideo(queue[qi]) && settings.showVideo !== false) setBig(true);
}
function start(i) {
  qi = (i + queue.length) % queue.length;
  const t = queue[qi];
  media.src = src(t.path);
  media.play().catch(() => {});
  P.hidden = false;
  applyMode();
  updInfo();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: trackName(t), album: t.album });
}
function updInfo() {
  const t = queue[qi];
  if (!t) return;
  $('pTitle').textContent = trackName(t);
  $('pAlbum').textContent = `${t.album} · ${qi + 1}/${queue.length}`;
  markPlaying();
  renderQueue();
}
// video shown or audio-only (hidden video keeps playing its sound)
function applyMode() {
  const t = queue[qi], hv = !!t && isVideo(t), v = hv && settings.showVideo !== false, was = P.classList.contains('video');
  P.classList.toggle('hasvideo', hv);
  P.classList.toggle('video', v);
  setIc($('pArt'), hv ? 'film-strip-d' : 'music-notes-d');
  setIc($('pVideo'), v ? 'eye-slash' : 'eye');
  $('pVideo').title = v ? 'ซ่อนภาพ ฟังแต่เสียง' : 'แสดงภาพวิดีโอ';
  if (!v) setBig(false);
  if (mini && v !== was) setMini(true); // resize the overlay
}
$('pVideo').onclick = () => {
  settings.showVideo = settings.showVideo === false;
  saveSettings();
  applyMode();
};
function next(auto) {
  const repeat = settings.repeat || 'off';
  if (auto && repeat === 'one') { media.currentTime = 0; media.play(); return; }
  if (qi + 1 < queue.length) start(qi + 1);
  else if (repeat !== 'off') start(0);
  else if (auto) toast('เล่นจบคิวแล้ว');
  else toast('สุดคิวแล้ว');
}
function prev() {
  if (media.currentTime > 3 || (qi === 0 && (settings.repeat || 'off') === 'off')) media.currentTime = 0;
  else start(qi - 1);
}
function updRepeat() {
  const r = settings.repeat || 'off';
  setIc($('pRepeat'), REPEAT[r][0]);
  $('pRepeat').title = REPEAT[r][1];
  $('pRepeat').classList.toggle('on', r !== 'off');
}
$('pRepeat').onclick = () => {
  settings.repeat = NEXT_REPEAT[settings.repeat || 'off'];
  saveSettings();
  updRepeat();
  toast(REPEAT[settings.repeat][1]);
};

// queue
function enqueue(t) {
  if (P.hidden || !queue.length) return play([t], 0);
  queue.push(t);
  updInfo();
  toast('เพิ่มในคิวแล้ว: ' + trackName(t));
}
function removeAt(i) {
  if (queue.length === 1) return closePlayer();
  queue.splice(i, 1);
  if (i < qi) qi--;
  if (i === qi) start(Math.min(i, queue.length - 1));
  else updInfo();
}
function renderQueue() {
  $('queueCount').textContent = `คิว · ${queue.length} รายการ`;
  $('queueList').replaceChildren(...queue.map((t, i) => {
    const li = el('li', i === qi ? 'playing' : '');
    const x = el('button', 'x');
    setIc(x, 'x');
    x.title = 'เอาออกจากคิว';
    x.onclick = e => { e.stopPropagation(); removeAt(i); };
    const n = el('span', 'n', i === qi ? null : i + 1), name = el('span', 't', trackName(t));
    if (i === qi) n.append(icon('play-f'));
    if (isVideo(t)) name.prepend(icon('film-strip-d'), ' ');
    li.append(n, name, x);
    li.onclick = () => start(i);
    return li;
  }));
}
function toggleQueue(on = $('queue').hidden) {
  $('queue').hidden = !on;
  if (on) $('queue').style.bottom = P.offsetHeight + 28 + 'px';
}
$('pQueue').onclick = () => toggleQueue();
$('queueClear').onclick = () => { queue = [queue[qi]]; qi = 0; updInfo(); };

function markPlaying() {
  const now = !P.hidden && queue[qi]?.path;
  document.querySelectorAll('#trackList li, #clipGrid .clip').forEach(x => x.classList.toggle('playing', x.dataset.path === now));
}
const fmt = s => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
media.onended = () => next(true);
media.onplay = media.onpause = () => {
  setIc($('pPlay'), media.paused ? 'play-f' : 'pause-f');
  $('pArt').classList.toggle('spin', !media.paused);
};
media.ontimeupdate = () => {
  if (media.duration) $('pSeek').value = (media.currentTime / media.duration) * 1000;
  $('pTime').textContent = `${fmt(media.currentTime)} / ${fmt(media.duration)}`;
};
media.onerror = () => { if (media.getAttribute('src')) $('pAlbum').textContent = 'เล่นไฟล์นี้ไม่ได้'; };
$('pSeek').oninput = e => { if (media.duration) media.currentTime = (e.target.value / 1000) * media.duration; };
$('pPlay').onclick = () => (media.paused ? media.play() : media.pause());
$('pNext').onclick = () => next(false);
$('pPrev').onclick = prev;
function setBig(on) {
  P.classList.toggle('big', on);
  setIc($('pBig'), on ? 'corners-in' : 'corners-out');
  $('pBig').title = on ? 'ย่อวิดีโอ' : 'ขยายวิดีโอเต็มจอ';
  if (!$('queue').hidden) toggleQueue(true); // re-anchor above the player
}
$('pBig').onclick = () => setBig(!P.classList.contains('big'));
media.onclick = () => (media.paused ? media.play() : media.pause());
media.ondblclick = () => !mini && setBig(!P.classList.contains('big'));

// fold the whole app into the mini player overlay at the screen edge (playback keeps going: same page)
let mini = false;
const overlayPos = () => settings.overlayPos || 'br';
async function setMini(on) {
  const v = P.classList.contains('video');
  if (on) { setBig(false); toggleQueue(false); }
  peeked = false;
  document.body.classList.remove('peek');
  document.body.classList.toggle('side-l', overlayPos().endsWith('l'));
  await invoke('set_mini', { mini: on, w: v ? 420 : 400, h: v ? 300 : 112, pos: overlayPos() }).catch(e => toast('พับหน้าต่างไม่ได้: ' + e));
  mini = on;
  document.body.classList.toggle('mini', on);
  clearTimeout(peekTimer);
  if (on && settings.edgeHide) peekTimer = setTimeout(() => peek(true), 2500); // mouse is usually elsewhere after folding
  setIc($('pMini'), on ? 'app-window' : 'picture-in-picture');
  $('pMini').title = on ? 'ขยายกลับเป็นหน้าโฮม' : 'พับเป็นมินิเพลเยอร์ที่ขอบจอ';
}
$('pMini').onclick = () => setMini(!mini);

// edge hide: tuck the overlay into its side edge when the mouse leaves, slide out on hover
let peeked = false, peekTimer;
function peek(hide) {
  if (!mini || !settings.edgeHide) hide = false;
  if (hide === peeked) return;
  peeked = hide;
  document.body.classList.toggle('peek', hide);
  invoke('mini_peek', { hide, pos: overlayPos() }).catch(() => {});
}
document.documentElement.addEventListener('mouseleave', () => {
  clearTimeout(peekTimer);
  if (mini && settings.edgeHide) peekTimer = setTimeout(() => peek(true), 1200);
});
document.documentElement.addEventListener('mouseenter', () => { clearTimeout(peekTimer); peek(false); });

// ---------- file browser + folder analysis ----------
const CAT = {
  folder: ['โฟลเดอร์', 'folder-d', '#d97706'], image: ['รูปภาพ', 'image-d', '#db2777'], audio: ['เพลง', 'music-note-d', '#7c3aed'],
  video: ['วิดีโอ', 'film-strip-d', '#0284c7'], app: ['แอป', 'app-window-d', '#059669'], document: ['เอกสาร', 'file-text-d', '#2563eb'],
  archive: ['ไฟล์บีบอัด', 'file-zip-d', '#a16207'], other: ['อื่น ๆ', 'file-d', '#71717a'],
};
const catIcon = kind => { const i = icon(CAT[kind][1]); i.style.color = CAT[kind][2]; return i; };
function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${u[i]}`;
}
const fmtDate = s => (s ? new Date(s * 1000).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

let fl = null, fstats = null, fsel = null, ftoken = 0;
const fsort = { key: 'name', dir: 1 };
function openFiles(path = root) {
  if (stack.at(-1) !== 'files') openScreen('files');
  browse(path);
}
async function browse(path) {
  const t = ++ftoken;
  let l;
  try { l = await invoke('list_dir', { path }); } catch (e) { return toast('เปิดโฟลเดอร์ไม่ได้: ' + e); }
  if (t !== ftoken) return;
  fl = l; fstats = null; fsel = null;
  renderCrumbs(); renderRows(); renderInfo();
  $('fRows').parentElement.scrollTop = 0;
  const st = await invoke('dir_stats', { path }).catch(() => null); // whole subtree: may take a moment
  if (t !== ftoken) return;
  fstats = st;
  renderRows(); renderInfo();
}
function up() { if (fl && fl.crumbs.length > 1) browse(fl.crumbs.at(-2)[1]); }
$('fUp').onclick = up;
$('fExplorer').onclick = () => invoke('open', { path: fl.path }).catch(e => toast('เปิดไม่ได้: ' + e));
document.querySelectorAll('.fhead [data-sort]').forEach(b => (b.onclick = () => {
  fsort.dir = fsort.key === b.dataset.sort ? -fsort.dir : b.dataset.sort === 'name' ? 1 : -1;
  fsort.key = b.dataset.sort;
  renderRows();
}));

function renderCrumbs() {
  const parts = [];
  fl.crumbs.forEach(([name, path], i) => {
    if (i) parts.push(icon('caret-right'));
    const b = el('button', null, name);
    b.onclick = () => browse(path);
    parts.push(b);
  });
  $('crumbs').replaceChildren(...parts);
  $('crumbs').scrollLeft = 1e6;
  $('fUp').disabled = fl.crumbs.length < 2;
}
const sizeOf = e => (e.dir ? fstats?.children[e.path] : e.size);
function renderRows() {
  const k = fsort.key, num = (a, b) => (a ?? -1) - (b ?? -1);
  const cmp = (a, b) => (b.dir - a.dir) || fsort.dir * (
    k === 'name' ? a.name.localeCompare(b.name, 'th', { numeric: true })
      : k === 'size' ? num(sizeOf(a), sizeOf(b)) : num(a.modified, b.modified));
  document.querySelectorAll('.fhead [data-sort]').forEach(b => {
    b.classList.toggle('on', b.dataset.sort === k);
    b.textContent = b.textContent.replace(/ [↑↓]$/, '') + (b.dataset.sort === k ? (fsort.dir > 0 ? ' ↑' : ' ↓') : '');
  });
  const rows = [...fl.entries].sort(cmp).map(e => {
    const r = el('div', 'frow' + (fsel?.path === e.path ? ' sel' : ''));
    r.tabIndex = 0;
    r.title = e.dir ? 'ดับเบิลคลิกเพื่อเปิดโฟลเดอร์' : 'ดับเบิลคลิกเพื่อเปิดด้วยโปรแกรมเริ่มต้น';
    const sz = sizeOf(e);
    r.append(catIcon(e.kind), el('span', 'nm', e.name), el('span', 'sz', sz == null ? '…' : fmtBytes(sz)), el('span', 'dt', fmtDate(e.modified)));
    r.onclick = () => select(e);
    r.ondblclick = () => activate(e);
    r.onkeydown = ev => { if (ev.key === 'Enter') activate(e); };
    return r;
  });
  $('fRows').replaceChildren(...(rows.length ? rows : [el('p', 'empty', 'โฟลเดอร์ว่าง')]));
}
function select(e) {
  fsel = fsel?.path === e.path ? null : e; // click again = back to folder info
  renderRows(); renderInfo();
}
function activate(e) {
  if (e.dir) return browse(e.path);
  invoke('open', { path: e.path }).then(() => toast('เปิดด้วยโปรแกรมเริ่มต้น: ' + e.name)).catch(err => toast('เปิดไม่ได้: ' + err));
}
// media in this folder, shaped like the gallery/player items
function folderMedia(kind) {
  const album = fl.crumbs.at(-1)[0];
  return fl.entries.filter(x => x.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }))
    .map(x => ({ name: x.name, path: x.path, rel: x.rel, dir: fl.path, album }));
}

function stat(value, label) { const s = el('div', 'stat'); s.append(el('b', null, value), el('small', null, label)); return s; }
function header(kind, name) { const h = el('div', 'hd'); h.append(catIcon(kind), el('b', null, name)); return h; }
function action(iconName, label, fn, primary) {
  const b = el('button', 'act' + (primary ? ' primary' : ''));
  setIc(b, iconName, label);
  b.onclick = fn;
  return b;
}
function renderInfo() {
  const box = $('fInfo');
  if (fsel) return renderItemInfo(box, fsel);
  const parts = [header('folder', fl.crumbs.at(-1)[0])];
  if (!fstats) {
    parts.push(el('p', 'muted', 'กำลังวิเคราะห์ข้อมูลโฟลเดอร์…'));
    return box.replaceChildren(...parts);
  }
  const s = el('div', 'stats');
  s.append(stat(fmtBytes(fstats.bytes), 'ขนาดรวม'), stat(fstats.files.toLocaleString('th-TH'), 'ไฟล์'), stat(fstats.dirs.toLocaleString('th-TH'), 'โฟลเดอร์'));
  parts.push(s);
  if (fstats.disk) {
    const [total, free] = fstats.disk, used = total - free;
    // bar: this folder (pink) + everything else used (purple) + free (empty)
    const m = el('div', 'meter'), here = el('span'), rest = el('span');
    here.style.cssText = `width:${pct(fstats.bytes, total)}%;background:#f472b6`;
    rest.style.cssText = `width:${pct(used - fstats.bytes, total)}%;background:#a78bfa`;
    m.append(here, rest);
    parts.push(el('h4', null, 'พื้นที่แฟลชไดรฟ์'), m,
      el('p', 'muted', `ใช้ไป ${fmtBytes(used)} จาก ${fmtBytes(total)} (${pct(used, total)}%) · ว่าง ${fmtBytes(free)} · โฟลเดอร์นี้ ${pct(fstats.bytes, total)}%`));
  }
  const types = Object.entries(fstats.by_type).sort((a, b) => b[1].bytes - a[1].bytes);
  if (types.length) {
    const m = el('div', 'meter'), lg = el('ul', 'legend');
    for (const [k, v] of types) {
      const seg = el('span');
      seg.style.cssText = `width:${pct(v.bytes, fstats.bytes)}%;background:${CAT[k][2]}`;
      seg.title = `${CAT[k][0]} ${fmtBytes(v.bytes)}`;
      m.append(seg);
      const dot = el('span', 'dot');
      dot.style.background = CAT[k][2];
      const li = el('li');
      li.append(dot, el('span', null, `${CAT[k][0]} · ${v.count.toLocaleString('th-TH')} ไฟล์`), el('span', null, fmtBytes(v.bytes)), el('span', 'pc', pct(v.bytes, fstats.bytes) + '%'));
      lg.append(li);
    }
    parts.push(el('h4', null, 'แยกตามประเภทไฟล์'), m, lg);
  }
  if (fstats.largest.length) {
    const ul = el('ul', 'biglist');
    for (const [name, path, size] of fstats.largest) {
      const li = el('li');
      li.title = path + '\nคลิกเพื่อเปิดด้วยโปรแกรมเริ่มต้น';
      li.append(icon('file-d'), el('span', 't', name), el('small', null, fmtBytes(size)));
      li.onclick = () => activate({ dir: false, path, name });
      ul.append(li);
    }
    parts.push(el('h4', null, 'ไฟล์ใหญ่ที่สุด'), ul);
  }
  box.replaceChildren(...parts);
}
function renderItemInfo(box, e) {
  const sz = sizeOf(e), ext = e.dir ? '' : (e.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
  const kv = el('dl', 'kv');
  const row = (k, v) => kv.append(el('dt', null, k), el('dd', null, v));
  row('ประเภท', CAT[e.kind][0] + (ext ? ` (.${ext.toLowerCase()})` : ''));
  row('ขนาด', sz == null ? 'กำลังคำนวณ…' : `${fmtBytes(sz)}${sz >= 1024 ? ` (${sz.toLocaleString('th-TH')} ไบต์)` : ''}`);
  if (e.dir && fstats) row('สัดส่วน', pct(sz, fstats.bytes) + '% ของโฟลเดอร์นี้');
  if (e.modified) row('แก้ไขล่าสุด', fmtDate(e.modified));
  row('ตำแหน่ง', e.rel);
  const acts = el('div', 'acts');
  if (e.dir) {
    acts.append(action('folder-open', 'เปิดและวิเคราะห์โฟลเดอร์นี้', () => browse(e.path), true),
      action('arrow-square-out', 'เปิดใน Explorer', () => activate({ ...e, dir: false })));
  } else {
    acts.append(action('arrow-square-out', 'เปิดด้วยโปรแกรมเริ่มต้น', () => activate(e), true));
    if (e.kind === 'image') {
      const list = folderMedia('image');
      acts.append(action('image', 'ดูในแอป', () => view(list, list.findIndex(x => x.path === e.path))));
    } else if (e.kind === 'audio' || e.kind === 'video') {
      const list = folderMedia(e.kind);
      acts.append(action('play', 'เล่นในแอป', () => play(list, list.findIndex(x => x.path === e.path))),
        action('list-plus', 'เพิ่มในคิว', () => enqueue(list.find(x => x.path === e.path))));
    }
    acts.append(action('folder-open', 'เปิดตำแหน่งใน Explorer', () => invoke('open', { path: fl.path })));
  }
  acts.append(action('arrow-left', 'กลับไปข้อมูลโฟลเดอร์', () => select(e)));
  box.replaceChildren(header(e.kind, e.name), kv, acts);
}

// ---------- settings ----------
function renderSettings() {
  document.querySelectorAll('#posPick button').forEach(b => {
    b.classList.toggle('on', b.dataset.pos === overlayPos());
    b.setAttribute('aria-checked', b.dataset.pos === overlayPos());
  });
  $('edgeHide').checked = !!settings.edgeHide;
  $('interval').value = String(settings.interval || 15);
}
$('openSettings').onclick = () => { renderSettings(); openScreen('settingsScreen'); };
document.querySelectorAll('#posPick button').forEach(b => (b.onclick = () => {
  settings.overlayPos = b.dataset.pos;
  saveSettings();
  renderSettings();
  toast('ตำแหน่ง overlay: ' + b.title);
}));
$('edgeHide').onchange = () => {
  settings.edgeHide = $('edgeHide').checked;
  saveSettings();
  if (!settings.edgeHide) peek(false);
};
$('interval').onchange = () => {
  settings.interval = +$('interval').value;
  saveSettings();
  applyWallpaper();
};
function closePlayer() {
  if (mini) setMini(false);
  media.pause();
  media.removeAttribute('src');
  media.load();
  queue = [];
  P.hidden = true;
  P.classList.remove('video', 'hasvideo', 'big');
  toggleQueue(false);
  markPlaying();
}
$('pClose').onclick = closePlayer;
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
}

// ---------- startup ----------
async function load() {
  [root, settings] = await Promise.all([
    invoke('info'),
    invoke('get_settings').then(JSON.parse).catch(() => ({})),
  ]);
  $('drive').replaceChildren(icon('usb-d'), ' ' + root);
  apps = (await invoke('apps')).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  renderApps();
  // real exe icons arrive a moment later
  const list = apps;
  invoke('icons', { paths: list.map(a => a.path) }).then(ic => {
    ic.forEach((d, i) => (list[i].icon = d));
    if (apps === list) renderApps(); // skip if a refresh replaced the list meanwhile
  });
  updRepeat();
  [images, music, videos] = await Promise.all([invoke('images'), invoke('music'), invoke('videos')]);
  applyWallpaper();
}
load();

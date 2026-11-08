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
  const id = stack.pop();
  if (!id) return;
  $(id).classList.remove('open');
  if (id === 'album') stopSelecting();
}
document.querySelectorAll('.back').forEach(b => (b.onclick = back));
document.addEventListener('keydown', e => {
  if (e.target === $('q')) return;
  if (e.key === 'Escape' && $('player').classList.contains('big')) return setBig(false);
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
$('openFiles').onclick = () => invoke('open', { path: root });
$('refresh').onclick = () => load().then(() => toast('รีเฟรชแล้ว'));

// ---------- albums = folders ----------
function albums(items, allTitle) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.dir)) m.set(it.dir, { title: it.album, dir: it.dir, items: [] });
    m.get(it.dir).items.push(it);
  }
  const list = [...m.values()].sort((a, b) => a.title.localeCompare(b.title, 'th'));
  return items.length ? [{ title: allTitle, dir: root, items }, ...list] : [];
}
function renderAlbums(box, list, cls, cover, unit, onOpen) {
  box.replaceChildren(...list.map(a => {
    const b = el('button', 'album ' + cls);
    const c = el('div', 'cover');
    c.append(cover(a));
    b.append(c, el('b', null, a.title), el('small', null, `${a.items.length} ${unit}`));
    b.onclick = () => onOpen(a);
    return b;
  }));
  if (!list.length) box.replaceChildren(el('p', 'empty', 'ไม่พบไฟล์ในแฟลชไดรฟ์'));
}

// ---------- gallery ----------
$('openGallery').onclick = () => {
  renderAlbums($('galleryAlbums'), albums(images, 'ทุกรูป'), '', a => {
    const i = new Image(); i.loading = 'lazy'; i.src = src(a.items[0].path); i.alt = ''; return i;
  }, 'รูป', openAlbum);
  $('galleryCount').textContent = images.length + ' รูป';
  openScreen('gallery');
};

let curAlbum = null, selecting = false;
const selected = new Set();
function openAlbum(a) {
  curAlbum = a;
  $('albumTitle').textContent = a.title;
  $('albumCount').textContent = a.items.length + ' รูป';
  $('photos').replaceChildren(...a.items.map((it, i) => {
    const d = el('div', 'ph');
    const img = new Image(); img.loading = 'lazy'; img.src = src(it.path); img.alt = it.name; img.title = it.name;
    d.append(img);
    d.onclick = () => selecting ? toggleSel(d, it) : view(a.items, i);
    return d;
  }));
  $('albumFolder').onclick = () => invoke('open', { path: a.dir });
  openScreen('album');
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
  $('selbar').hidden = true; setIc($('selectBtn'), 'check-square', 'เลือกทำวอลเปเปอร์');
  document.querySelectorAll('.ph.sel').forEach(x => x.classList.remove('sel'));
}
function toggleSel(d, it) {
  selected.has(it.rel) ? selected.delete(it.rel) : selected.add(it.rel);
  d.classList.toggle('sel', selected.has(it.rel));
  updSel();
}
function updSel() {
  $('selCount').textContent = selected.size > 1 ? `เลือก ${selected.size} รูป · สไลด์โชว์ทุก ${settings.interval || 15} วินาที` : `เลือก ${selected.size} รูป`;
  $('setSlide').disabled = !selected.size;
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
$('openMusic').onclick = () => {
  renderAlbums($('musicAlbums'), albums(music, 'ทุกเพลง'), 'music', () => icon('music-notes-d'), 'เพลง', openTracks);
  $('musicCount').textContent = music.length + ' เพลง';
  openScreen('music');
};
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
  $('tracksFolder').onclick = () => invoke('open', { path: a.dir });
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
$('openVideos').onclick = () => {
  renderAlbums($('videoAlbums'), albums(videos, 'ทุกวิดีโอ'), 'video', () => icon('film-strip-d'), 'วิดีโอ', openClips);
  $('videosCount').textContent = videos.length + ' วิดีโอ';
  openScreen('videosScreen');
};
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
  $('clipsFolder').onclick = () => invoke('open', { path: a.dir });
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

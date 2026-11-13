(function () {
  'use strict';

  /* ---------------- 基础常量与存储 ---------------- */
  const LS_SETTINGS = 'songci.settings.v1';
  const LS_CUSTOM = 'songci.custom.v1';
  const LS_LAST = 'songci.last.v1';
  const LS_FAV = 'songci.fav.v1';

  const DEFAULTS = {
    vertical: true,
    rtl: true,
    anim: 'line',
    speed: 'normal',
    size: 1,
    theme: 'paper',
    script: 's',
    font: 'song'
  };

  const SPEEDS = {
    slow: { line: 1900, char: 130, gap: 620, first: 520, tail: 1100 },
    normal: { line: 1150, char: 72, gap: 360, first: 300, tail: 900 },
    fast: { line: 720, char: 44, gap: 220, first: 180, tail: 700 }
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* 存储不可用时静默 */ }
  }

  let settings = Object.assign({}, DEFAULTS, readJSON(LS_SETTINGS, {}));
  let customPoems = readJSON(LS_CUSTOM, []);
  let favIds = new Set((readJSON(LS_FAV, []) || []).filter(function (x) { return typeof x === 'string'; }));
  if (!Array.isArray(customPoems)) customPoems = [];

  /* ---------------- 简繁转换（仅显示层，原始数据不动） ---------------- */
  const OC = window.OpenCC;
  const toSimp = OC ? OC.Converter({ from: 'tw', to: 'cn' }) : function (s) { return s; };
  const toTrad = OC ? OC.Converter({ from: 'cn', to: 'twp' }) : function (s) { return s; };
  function tx(s) {
    if (s == null) return s;
    return settings.script === 't' ? toTrad(s) : toSimp(s);
  }
  const simpCache = new Map();
  function simpText(poem) {
    let t = simpCache.get(poem.id);
    if (t == null) {
      t = toSimp(poem.r + '\n' + poem.a + '\n' + poem.text);
      simpCache.set(poem.id, t);
    }
    return t;
  }

  /* ---------------- 数据准备 ---------------- */
  const AUTHORS = window.DATA_AUTHORS || {};
  const RAW_POEMS = window.DATA_POEMS || [];

  const basePoems = RAW_POEMS.map(function (p, i) {
    const lines = Array.isArray(p.c) ? p.c : String(p.c || '').split('\n');
    return {
      id: 'b' + i,
      r: p.r || '无题',
      a: p.a || '佚名',
      c: lines,
      d: p.d || 'song',
      text: lines.join('')
    };
  });

  let allPoems = [];
  let poemById = new Map();
  let authorWorks = new Map();

  function normalizeCustom(list) {
    return list.filter(function (p) {
      return p && Array.isArray(p.c) && p.c.length;
    }).map(function (p) {
      return {
        id: p.id || ('u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        r: p.r || '无题',
        a: p.a || '佚名',
        c: p.c.slice(),
        d: p.d || 'custom',
        custom: true
      };
    });
  }

  function buildAll() {
    customPoems = normalizeCustom(customPoems);
    const custom = customPoems.map(function (p) {
      return {
        id: p.id,
        r: p.r,
        a: p.a,
        c: p.c,
        d: p.d || 'custom',
        text: p.c.join(''),
        custom: true
      };
    });
    allPoems = basePoems.concat(custom);
    poemById = new Map();
    authorWorks = new Map();
    allPoems.forEach(function (p) {
      poemById.set(p.id, p);
      let entry = authorWorks.get(p.a);
      if (!entry) {
        entry = { name: p.a, works: [] };
        authorWorks.set(p.a, entry);
      }
      entry.works.push(p);
    });
  }

  buildAll();

  /* ---------------- DOM ---------------- */
  const body = document.body;
  const reader = $('#reader');
  const poemEl = $('#poem');
  const linesEl = $('#poem-lines');
  const metaTitle = $('#meta-title');
  const metaAuthor = $('#meta-author');
  const hintEl = $('#hint');
  const posInfo = $('#pos-info');
  const panel = $('#panel');
  const scrim = $('#scrim');
  const panelTitle = $('#panel-title');
  const panelBack = $('#panel-back');
  const searchInput = $('#search-input');

  const views = {
    library: $('#view-library'),
    author: $('#view-author'),
    settings: $('#view-settings'),
    editor: $('#view-editor')
  };

  /* ---------------- 阅读状态 ---------------- */
  const view = { poem: null, list: [], pos: 0, origin: 'all' };
  const anim = { units: [], i: 0, timer: null, playing: false, done: false, lastLine: null };

  function escEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  /* ---------------- 排版自适应 ---------------- */
  function fitFont() {
    const poem = view.poem;
    if (!poem) return;
    const H = Math.max(220, reader.clientHeight - 56);
    const W = Math.max(220, reader.clientWidth - 60);
    const maxLine = poem.c.reduce(function (m, line) {
      return Math.max(m, Array.from(line).length);
    }, 6);
    const titleLen = Math.max(4, Array.from(poem.r).length);
    let fs;
    let byHeight = 0;
    if (settings.vertical) {
      byHeight = H / (Math.max(maxLine * 1.16, titleLen * 1.5, 9) + 1);
      const cols = poem.c.length + 1;
      const byWidth = W / (cols * 1.9 + 2.6);
      const allowScroll = W < 640;
      fs = allowScroll ? Math.min(byHeight, 46) : Math.min(byHeight, byWidth, 46);
      fs = Math.max(16, fs);
    } else {
      const narrow = W < 640;
      const spacing = narrow ? 1.05 : 1.16;
      const byWidth = W / (maxLine * spacing + 1);
      const byH = H / ((poem.c.length + 2.4) * 1.95);
      fs = Math.min(byWidth, byH);
      fs = Math.max(narrow ? 14 : 13, Math.min(40, fs));
    }
    fs *= settings.size;
    /* 竖排：列高有限，字号放大后不得超过列高，否则文字会被裁掉 */
    if (settings.vertical && byHeight) fs = Math.max(13, Math.min(fs, byHeight));
    poemEl.style.setProperty('--fs', fs.toFixed(1) + 'px');
  }

  function layoutPoem() {
    poemEl.style.paddingTop = '';
    poemEl.style.paddingLeft = '';
    poemEl.style.paddingRight = '';
    if (!settings.vertical) return;

    const width = poemEl.clientWidth;
    const height = poemEl.clientHeight;
    const columns = Array.prototype.slice.call(linesEl.children).concat([$('#poem-meta')]);
    let contentWidth = 0;
    let contentHeight = 0;
    columns.forEach(function (el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      contentWidth += rect.width;
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRect = range.getBoundingClientRect();
      contentHeight = Math.max(contentHeight, textRect.height);
    });
    const fs = parseFloat(getComputedStyle(poemEl).getPropertyValue('--fs')) || 30;
    contentWidth += fs * 1.1;

    if (contentWidth < width) {
      const pad = (width - contentWidth) / 2;
      if (settings.rtl) poemEl.style.paddingRight = pad + 'px';
      else poemEl.style.paddingLeft = pad + 'px';
    }
    if (contentHeight < height) {
      poemEl.style.paddingTop = ((height - contentHeight) / 2) + 'px';
    }
  }

  /* ---------------- 渲染与动画 ---------------- */
  function renderPoem() {
    const poem = view.poem;
    if (!poem) return;
    stopAnim();

    const charMode = settings.anim === 'char';
    const classes = ['poem', settings.vertical ? 'vertical' : 'horizontal'];
    if (settings.vertical && !settings.rtl) classes.push('v-ltr');
    if (!settings.vertical) classes.push(settings.rtl ? 'h-rtl' : 'h-ltr');
    poemEl.className = classes.join(' ');
    reader.style.direction = (settings.vertical && settings.rtl) ? 'rtl' : 'ltr';

    linesEl.textContent = '';
    const lineEls = [];
    poem.c.forEach(function (line) {
      const p = document.createElement('p');
      p.className = 'line';
      if (charMode) {
        Array.from(tx(line)).forEach(function (ch) {
          const span = document.createElement('span');
          span.className = 'ch unit';
          span.textContent = ch;
          p.appendChild(span);
        });
      } else {
        p.classList.add('unit');
        p.textContent = tx(line);
      }
      linesEl.appendChild(p);
      lineEls.push(p);
    });

    metaTitle.textContent = tx(poem.r);
    metaAuthor.textContent = tx(poem.a);
    metaTitle.classList.add('on');
    metaAuthor.classList.add('on');

    const lineUnits = charMode
      ? Array.prototype.slice.call(linesEl.querySelectorAll('.ch'))
      : lineEls;
    anim.units = lineUnits;
    anim.i = 0;
    anim.done = false;
    anim.lastLine = null;

    reader.scrollTo(0, 0);
    fitFont();
    layoutPoem();
    updatePager();
    updateFavBtn();
    document.title = tx(poem.r) + ' · ' + tx(poem.a) + ' — 诗词雅集';

    if (settings.anim === 'all') {
      anim.units.forEach(function (u) { u.classList.add('on'); });
      anim.i = anim.units.length;
      anim.done = true;
      anim.playing = false;
      hideHint();
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(startAnim);
      });
    }
  }

  function clearTimer() {
    if (anim.timer) {
      clearTimeout(anim.timer);
      anim.timer = null;
    }
  }

  function stopAnim() {
    clearTimer();
    anim.playing = false;
  }

  function schedule(delay) {
    clearTimer();
    anim.timer = setTimeout(step, delay);
  }

  function scrollToUnit(el) {
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function step() {
    if (!anim.playing) return;
    const unit = anim.units[anim.i];
    if (!unit) {
      finishAnim();
      return;
    }
    unit.classList.add('on');

    const lineEl = unit.closest('.line') || unit;
    if (lineEl !== anim.lastLine) {
      anim.lastLine = lineEl;
      scrollToUnit(lineEl);
    }

    anim.i += 1;
    const t = SPEEDS[settings.speed] || SPEEDS.normal;
    if (anim.i >= anim.units.length) {
      anim.playing = true;
      anim.timer = setTimeout(finishAnim, t.tail);
      return;
    }
    let delay;
    if (settings.anim === 'char') {
      const prev = unit;
      const next = anim.units[anim.i];
      delay = (next && next.parentElement !== prev.parentElement) ? t.char + t.gap : t.char;
    } else {
      delay = t.line;
    }
    schedule(delay);
  }

  function startAnim() {
    clearTimer();
    if (settings.anim === 'all') {
      anim.units.forEach(function (u) { u.classList.add('on'); });
      anim.i = anim.units.length;
      anim.done = true;
      anim.playing = false;
      hideHint();
      return;
    }
    anim.units.forEach(function (u) { u.classList.remove('on'); });
    anim.i = 0;
    anim.done = false;
    anim.playing = true;
    anim.lastLine = null;
    hideHint();
    const t = SPEEDS[settings.speed] || SPEEDS.normal;
    schedule(t.first);
  }

  function finishAnim() {
    clearTimer();
    anim.playing = false;
    anim.done = true;
    showHint('轻点词文可重播', 2600);
  }

  function toggleAnim() {
    if (settings.anim === 'all') return;
    if (!anim.units.length) return;
    if (anim.done) {
      startAnim();
      return;
    }
    if (anim.playing) {
      anim.playing = false;
      clearTimer();
      showHint('已暂停 · 轻点继续', 0);
    } else {
      anim.playing = true;
      hideHint();
      schedule(220);
    }
  }

  let hintTimer = null;
  function showHint(text, duration) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!text) { hideHint(); return; }
    hintEl.textContent = text;
    hintEl.classList.add('show');
    if (duration > 0) {
      hintTimer = setTimeout(hideHint, duration);
    }
  }

  function hideHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    hintEl.classList.remove('show');
  }

  /* ---------------- 打开词作 ---------------- */
  function openPoem(poem, list, pos, origin) {
    if (!poem) return;
    view.poem = poem;
    view.list = (list && list.length) ? list : allPoems;
    if (origin) view.origin = origin;
    let index = pos;
    if (index == null || index < 0) {
      index = view.list.findIndex(function (p) { return p.id === poem.id; });
    }
    view.pos = index < 0 ? 0 : index;
    writeJSON(LS_LAST, poem.id);
    renderPoem();
  }

  function updatePager() {
    if (!view.poem) {
      posInfo.textContent = '—';
      return;
    }
    posInfo.textContent = (view.pos + 1) + ' / ' + view.list.length;
  }

  function stepPoem(delta) {
    if (!view.list.length) return;
    let index = (view.pos + delta + view.list.length) % view.list.length;
    const poem = view.list[index];
    if (!poem) return;
    view.poem = poem;
    view.pos = index;
    writeJSON(LS_LAST, poem.id);
    renderPoem();
  }

  function poolForTab(tab) {
    if (tab === 'song') return allPoems.filter(function (p) { return p.d === 'song' || !p.d; });
    if (tab === 'tang') return allPoems.filter(function (p) { return p.d === 'tang'; });
    if (tab === 'mao') return allPoems.filter(function (p) { return p.d === 'mao'; });
    if (tab === 'wudai') return allPoems.filter(function (p) { return p.d === 'wudai'; });
    if (tab === 'hanjin') return allPoems.filter(function (p) { return p.d === 'hanwei' || p.d === 'jin'; });
    if (tab === 'mine') return allPoems.filter(function (p) { return p.custom; });
    if (tab === 'fav') return allPoems.filter(function (p) { return favIds.has(p.id); });
    return allPoems;
  }

  /* ---------------- 收藏 ---------------- */
  function saveFav() {
    writeJSON(LS_FAV, Array.from(favIds));
  }

  function updateFavBtn() {
    const btn = $('#btn-fav');
    if (!btn) return;
    const on = !!(view.poem && favIds.has(view.poem.id));
    btn.classList.toggle('active', on);
    btn.querySelector('span').textContent = on ? '已收藏' : '收藏';
    btn.title = on ? '取消收藏' : '收藏';
  }

  function toggleFav() {
    const poem = view.poem;
    if (!poem) return;
    if (favIds.has(poem.id)) {
      favIds.delete(poem.id);
      /* 若当前是从收藏列表打开的，取消后从翻页池里摘掉 */
      if (view.origin === 'fav') {
        view.list = view.list.filter(function (p) { return p.id !== poem.id; });
        if (view.pos >= view.list.length) view.pos = Math.max(0, view.list.length - 1);
        updatePager();
      }
      showHint('已取消收藏', 1200);
    } else {
      favIds.add(poem.id);
      if (view.origin === 'fav') view.list = view.list.concat([poem]);
      showHint('已加入收藏', 1200);
    }
    saveFav();
    updateFavBtn();
    if (!views.library.classList.contains('hidden') && lib.tab === 'fav') renderLibrary();
  }

  function randomPoem() {
    /* 随机范围 = 当前浏览范围（全部/某朝代/收藏/我的），收藏动作本身不改变它 */
    let pool = poolForTab(view.origin);
    if (!pool.length) pool = allPoems;
    const poem = pool[Math.floor(Math.random() * pool.length)];
    if (poem) openPoem(poem, pool, null, view.origin);
  }

  /* ---------------- 面板 ---------------- */
  let currentView = 'library';
  let backTo = null;

  function showView(name) {
    currentView = name;
    Object.keys(views).forEach(function (key) {
      views[key].classList.toggle('hidden', key !== name);
    });
    panelBack.classList.toggle('hidden', name !== 'author');
    const titles = { library: '目录', author: '作者', settings: '设置', editor: '添加词作' };
    panelTitle.textContent = titles[name] || '目录';
    if (name === 'library') renderLibrary();
    if (name === 'settings') syncSettings();
    $('.panel-body').scrollTop = 0;
  }

  function openPanel(name) {
    scrim.hidden = false;
    requestAnimationFrame(function () { scrim.classList.add('show'); });
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    showView(name);
  }

  function closePanel() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('show');
    setTimeout(function () {
      if (!panel.classList.contains('open')) scrim.hidden = true;
    }, 380);
  }

  function isPanelOpen() {
    return panel.classList.contains('open');
  }

  /* ---------------- 目录 ---------------- */
  const lib = { tab: 'all', query: '', limit: 60, results: [], cipai: null };

  function matches(poem, q) {
    if (!q) return true;
    return simpText(poem).indexOf(toSimp(q)) >= 0;
  }

  function makeItem(poem) {
    const item = document.createElement('button');
    item.className = 'item';
    item.type = 'button';

    const title = escEl('span', 't', tx(poem.r));
    const dyn = { song: '宋词', tang: '唐诗', mao: '毛词', custom: '自撰', wudai: '五代', hanwei: '汉魏', jin: '晋' }[poem.d] || '';
    if (dyn) {
      const dynBadge = escEl('span', 'badge dyn-' + (poem.d || ''), dyn);
      title.appendChild(dynBadge);
    }
    if (poem.custom) {
      const badge = escEl('span', 'badge', '自撰');
      title.appendChild(badge);
    }
    item.appendChild(title);
    item.appendChild(escEl('span', 'a', tx(poem.a)));
    item.appendChild(escEl('span', 's', tx(poem.c[0] || '')));
    return item;
  }

  function renderLibrary() {
    $('#library-tabs').querySelectorAll('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === lib.tab);
    });
    const listEl = $('#lib-list');
    listEl.textContent = '';
    if (lib.tab === 'author') {
      renderAuthorList(listEl);
    } else if (lib.tab === 'mine') {
      renderMineList(listEl);
    } else if (lib.tab === 'cipai') {
      renderCipaiList(listEl);
    } else {
      renderAllList(listEl);
    }
  }

  /* 词牌索引：按词牌聚合宋词 */
  function renderCipaiList(listEl) {
    const q = lib.query.trim();
    const map = new Map();
    allPoems.forEach(function (p) {
      if (p.d && p.d !== 'song') return;
      const name = String(p.r || '').split('·')[0].trim();
      if (!name) return;
      map.set(name, (map.get(name) || 0) + 1);
    });
    let entries = Array.from(map.keys()).map(function (name) {
      return { name: name, count: map.get(name) };
    });
    if (q) {
      entries = entries.filter(function (e) { return toSimp(e.name).indexOf(toSimp(q)) >= 0; });
    }
    entries.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'zh'); });
    if (!entries.length) {
      listEl.appendChild(escEl('div', 'empty', '没有找到这个词牌'));
      $('#load-more').hidden = true;
      return;
    }
    entries.slice(0, 200).forEach(function (e) {
      const item = document.createElement('button');
      item.className = 'item';
      item.type = 'button';
      item.appendChild(escEl('span', 't', tx(e.name)));
      item.appendChild(escEl('span', 'count', e.count + ' 首'));
      item.addEventListener('click', function () { jumpToCipai(e.name); });
      listEl.appendChild(item);
    });
    $('#load-more').hidden = true;
  }

  function jumpToCipai(name) {
    lib.tab = 'song';
    view.origin = 'song';
    lib.limit = 60;
    lib.query = '';
    lib.cipai = name;
    searchInput.value = '';
    renderLibrary();
    showHint('词牌 · ' + name, 1600);
  }

  function renderAllList(listEl) {
    const q = lib.query.trim();
    let source = poolForTab(lib.tab);
    if (lib.cipai) {
      source = source.filter(function (p) {
        return String(p.r || '').split('·')[0].trim() === lib.cipai;
      });
    }
    if (q) source = source.filter(function (p) { return matches(p, q); });
    lib.results = source;
    const slice = source.slice(0, lib.limit);
    if (!slice.length) {
      listEl.appendChild(escEl('div', 'empty', lib.tab === 'fav' ? '还没有收藏任何作品。点底部的「收藏」即可加入。' : '没有找到相关的词作'));
    }
    slice.forEach(function (poem) {
      const item = makeItem(poem);
      item.addEventListener('click', function () {
        openPoem(poem, source, null, lib.tab);
        closePanel();
      });
      listEl.appendChild(item);
    });
    const more = $('#load-more');
    more.hidden = source.length <= slice.length;
    more.textContent = '加载更多（' + slice.length + ' / ' + source.length + '）';
  }

  function renderAuthorList(listEl) {
    const q = lib.query.trim();
    const entries = Array.from(authorWorks.values())
      .filter(function (e) { return !q || toSimp(e.name).indexOf(toSimp(q)) >= 0; })
      .sort(function (a, b) {
        return b.works.length - a.works.length || a.name.localeCompare(b.name, 'zh');
      });
    if (!entries.length) {
      listEl.appendChild(escEl('div', 'empty', '没有找到这位作者'));
      $('#load-more').hidden = true;
      return;
    }
    const slice = entries.slice(0, 120);
    slice.forEach(function (entry) {
      const item = document.createElement('button');
      item.className = 'item';
      item.type = 'button';
      item.appendChild(escEl('span', 't', tx(entry.name)));
      item.appendChild(escEl('span', 'count', entry.works.length + ' 首'));
      item.appendChild(escEl('span', 's', AUTHORS[entry.name] ? tx(AUTHORS[entry.name].slice(0, 46)) : '暂无生平资料'));
      item.addEventListener('click', function () {
        renderAuthorDetail(entry.name);
        showView('author');
        backTo = 'library';
      });
      listEl.appendChild(item);
    });
    const more = $('#load-more');
    more.hidden = true;
  }

  function renderMineList(listEl) {
    const q = lib.query.trim();
    const source = customPoems.filter(function (p) {
      return !q || p.r.indexOf(q) >= 0 || p.a.indexOf(q) >= 0 || p.c.join('').indexOf(q) >= 0;
    });
    if (!source.length) {
      listEl.appendChild(escEl('div', 'empty', q ? '没有找到相关的词作' : '还没有自撰词作，点右上角「添加」试试'));
      $('#load-more').hidden = true;
      return;
    }
    source.forEach(function (raw) {
      const poem = poemById.get(raw.id) || raw;
      const item = document.createElement('div');
      item.className = 'item';
      const title = escEl('span', 't', tx(poem.r));
      title.appendChild(escEl('span', 'badge', '自撰'));
      item.appendChild(title);
      item.appendChild(escEl('span', 'a', poem.a));
      item.appendChild(escEl('span', 's', poem.c[0] || ''));
      const actions = escEl('div', 'row-actions');
      const openBtn = escEl('button', 'link-btn', '阅读');
      openBtn.type = 'button';
      openBtn.addEventListener('click', function () {
        openPoem(poem, customPoems.map(function (p) { return poemById.get(p.id) || p; }), null, 'mine');
        closePanel();
      });
      const editBtn = escEl('button', 'link-btn', '编辑');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { openEditor(poem); });
      const delBtn = escEl('button', 'link-btn', '删除');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () { deletePoem(poem.id); });
      actions.appendChild(openBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
    $('#load-more').hidden = true;
  }

  /* ---------------- 作者详情 ---------------- */
  let currentAuthorName = null;
  function renderAuthorDetail(name) {
    currentAuthorName = name;
    $('#author-name').textContent = tx(name);
    const works = authorWorks.get(name) || { works: [] };
    const dynSet = {};
    works.works.forEach(function (p) { dynSet[p.d] = true; });
    const dynList = [];
    if (dynSet.hanwei || dynSet.jin) dynList.push('汉魏晋');
    if (dynSet.wudai) dynList.push('五代词');
    if (dynSet.song) dynList.push('宋词');
    if (dynSet.tang) dynList.push('唐诗');
    if (dynSet.mao) dynList.push('毛词');
    $('#author-sub').textContent = (dynList.join(' / ') || '合集') + ' · 收录 ' + works.works.length + ' 首';
    const desc = AUTHORS[name];
    $('#author-desc').textContent = desc ? tx(desc) : '暂无生平资料。';
    const listEl = $('#author-works');
    listEl.textContent = '';
    const shown = works.works.slice(0, 300);
    if (!shown.length) {
      listEl.appendChild(escEl('div', 'empty', '暂无作品'));
      return;
    }
    shown.forEach(function (poem) {
      const item = makeItem(poem);
      item.addEventListener('click', function () {
        openPoem(poem, works.works, null, 'author');
        closePanel();
      });
      listEl.appendChild(item);
    });
    if (works.works.length > shown.length) {
      listEl.appendChild(escEl('div', 'empty', '仅展示前 ' + shown.length + ' 首'));
    }
  }

  /* ---------------- 设置 ---------------- */
  const THEMES = ['paper', 'plain', 'celadon', 'lotus', 'night'];

  function effectiveTheme() {
    if (settings.theme === 'auto') {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return dark ? 'night' : 'paper';
    }
    return THEMES.indexOf(settings.theme) >= 0 ? settings.theme : 'paper';
  }

  function syncSettings() {
    const theme = effectiveTheme();
    THEMES.forEach(function (name) {
      body.classList.toggle('theme-' + name, name === theme);
    });
    body.classList.toggle('font-kai', settings.font === 'kai');
    body.classList.toggle('font-fang', settings.font === 'fang');
    body.classList.toggle('font-xing', settings.font === 'xing');
    $$('.segmented').forEach(function (seg) {
      const key = seg.dataset.key;
      const current = settings[key];
      seg.querySelectorAll('button').forEach(function (btn) {
        let value = btn.dataset.value;
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (key === 'size') value = parseFloat(value);
        btn.classList.toggle('active', value === current);
      });
    });
    const tip = $('#direction-tip');
    if (settings.vertical) {
      tip.textContent = settings.rtl
        ? '竖排：自右向左成列，词牌与作者位于最末（最左）。'
        : '竖排：自左向右成列，词牌与作者位于最末（最右）。';
    } else {
      tip.textContent = settings.rtl
        ? '横排：词牌与作者统一置于最上方，词句右对齐。'
        : '横排：词牌与作者统一置于最上方，词句居中。';
    }
  }

  function saveSettings() {
    writeJSON(LS_SETTINGS, settings);
  }

  /* 简繁切换：全局生效（阅读页 + 目录 + 作者 + 搜索），仅转显示 */
  function updateScriptBtn() {
    const b = $('#btn-script');
    if (!b) return;
    b.querySelector('span').textContent = settings.script === 't' ? '简体' : '繁體';
    b.title = settings.script === 't' ? '当前繁體，点击切换为简体' : '当前简体，点击切换为繁體';
  }
  function refreshScriptViews() {
    updateScriptBtn();
    if (view.poem) renderPoem();
    if (currentView === 'library') renderLibrary();
    else if (currentView === 'author' && currentAuthorName) renderAuthorDetail(currentAuthorName);
  }

  /* ---------------- 编辑器 ---------------- */
  let editingId = null;

  function openEditor(poem) {
    editingId = poem ? poem.id : null;
    openPanel('editor');
    $('#edit-title').value = poem ? poem.r : '';
    $('#edit-author').value = poem ? poem.a : '';
    $('#edit-content').value = poem ? poem.c.join('\n') : '';
    $('#btn-delete').hidden = !poem;
    panelTitle.textContent = poem ? '编辑词作' : '添加词作';
    setTimeout(function () {
      (poem ? $('#edit-content') : $('#edit-title')).focus();
    }, 420);
  }

  function saveEditor() {
    const r = $('#edit-title').value.trim() || '无题';
    const a = $('#edit-author').value.trim() || '佚名';
    const lines = $('#edit-content').value.split('\n')
      .map(function (line) { return line.replace(/[\s\u3000]+/g, ''); })
      .filter(function (line) { return line.length; });
    if (!lines.length) {
      showHint('请先填写词文内容', 2200);
      $('#edit-content').focus();
      return;
    }
    if (editingId) {
      const target = customPoems.find(function (p) { return p.id === editingId; });
      if (target) {
        target.r = r;
        target.a = a;
        target.c = lines;
      }
    } else {
      customPoems.push({
        id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        r: r,
        a: a,
        c: lines
      });
    }
    writeJSON(LS_CUSTOM, customPoems);
    buildAll();
    const poem = poemById.get(editingId) || allPoems[allPoems.length - 1];
    editingId = null;
    closePanel();
    openPoem(poem, allPoems, null, view.origin);
    showHint('已保存', 1800);
  }

  function deletePoem(id) {
    const idx = customPoems.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return;
    if (!window.confirm('确定删除这首自撰词作吗？')) return;
    customPoems.splice(idx, 1);
    writeJSON(LS_CUSTOM, customPoems);
    buildAll();
    if (view.poem && view.poem.id === id) {
      openPoem(allPoems[0], allPoems);
    }
    if (currentView === 'editor') closePanel();
    if (currentView === 'library') renderLibrary();
    showHint('已删除', 1600);
  }

  /* ---------------- 事件绑定 ---------------- */
  $('#btn-home').addEventListener('click', function () {
    lib.tab = 'all';
    view.origin = 'all';
    openPanel('library');
  });

  $('#btn-library').addEventListener('click', function () {
    openPanel('library');
  });

  $('#btn-random').addEventListener('click', randomPoem);

  $('#btn-add').addEventListener('click', function () { openEditor(null); });

  $('#btn-settings').addEventListener('click', function () { openPanel('settings'); });
  $('#btn-script').addEventListener('click', function () {
    settings.script = settings.script === 't' ? 's' : 't';
    saveSettings();
    refreshScriptViews();
  });
  updateScriptBtn();

  /* 跟随系统深浅色 */
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSysTheme = function () { if (settings.theme === 'auto') syncSettings(); };
    if (mq.addEventListener) mq.addEventListener('change', onSysTheme);
    else if (mq.addListener) mq.addListener(onSysTheme);
  }

  $('#btn-prev').addEventListener('click', function () { stepPoem(-1); });
  $('#btn-next').addEventListener('click', function () { stepPoem(1); });
  $('#btn-fav').addEventListener('click', toggleFav);

  $('#panel-close').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);

  panelBack.addEventListener('click', function () {
    if (backTo === 'library') {
      lib.tab = 'author';
      showView('library');
    } else {
      showView('library');
    }
  });

  reader.addEventListener('click', function (e) {
    if (e.target.closest('button, a, input, textarea')) return;
    toggleAnim();
  });

  metaAuthor.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!view.poem) return;
    renderAuthorDetail(view.poem.a);
    backTo = 'library';
    openPanel('author');
  });

  $('#library-tabs').addEventListener('click', function (e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    lib.tab = tab.dataset.tab;
    lib.limit = 60;
    lib.cipai = null;
    /* 手动选分类 = 切换浏览/随机范围；作者、词牌是索引页，不参与 */
    if (lib.tab !== 'author' && lib.tab !== 'cipai') view.origin = lib.tab;
    renderLibrary();
  });

  let searchTimer = null;
  searchInput.addEventListener('input', function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      lib.query = searchInput.value.trim();
      lib.cipai = null;
      lib.limit = 60;
      renderLibrary();
    }, 180);
  });

  $('#load-more').addEventListener('click', function () {
    lib.limit += 60;
    renderLibrary();
  });

  $$('.segmented').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = seg.dataset.key;
      let value = btn.dataset.value;
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (key === 'size') value = parseFloat(value);
      settings[key] = value;
      saveSettings();
      syncSettings();
      if (view.poem) renderPoem();
    });
  });

  $('#btn-save').addEventListener('click', saveEditor);
  $('#btn-delete').addEventListener('click', function () {
    if (editingId) deletePoem(editingId);
  });

  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      if (isPanelOpen()) closePanel();
      return;
    }
    if (isPanelOpen()) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepPoem(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepPoem(1); }
    else if (e.key === ' ') { e.preventDefault(); toggleAnim(); }
    else if (e.key.toLowerCase() === 'r') { startAnim(); }
  });

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      fitFont();
      layoutPoem();
    }, 160);
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    syncSettings();
    /* 每次进入随机一首 */
    let initial = null;
    if (allPoems.length) initial = allPoems[Math.floor(Math.random() * allPoems.length)];
    if (initial) openPoem(initial, allPoems, null, 'all');

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      // 每次启动先清旧 SW 和缓存，确保拿到最新资源
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { r.unregister(); });
        if (window.caches) {
          caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k); }); });
        }
        // 再注册新的
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }).catch(function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  boot();
})();

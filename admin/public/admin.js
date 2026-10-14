// Local admin UI. Talks to admin/server.mjs over /api/*. No dependencies.

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const photosLabel = n => plural(n, 'photo', 'photos');
  const photosAcc = photosLabel;


  const S = {
    data: null,
    git: null,
    image: { format: 'webp', accepted: [] },
    filter: 'all',          // 'all' | 'none' | 'settings' | <collectionId>
    panel: 'auto',          // 'auto' | 'collection' | 'settings'
    selected: new Set(),
    lastIndex: -1,
  };

  // ---------- api ----------

  async function api(method, path, body, raw) {
    const opts = { method, headers: {} };
    if (raw) opts.body = raw;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 2400);
  }
  const fail = e => { console.error(e); toast(e.message, true); };

  let savingCount = 0;
  function saving(on) {
    savingCount += on ? 1 : -1;
    $('save-state').textContent = savingCount > 0 ? 'Saving…' : 'Saved';
    if (savingCount <= 0) { clearTimeout(saving.t); saving.t = setTimeout(() => ($('save-state').textContent = ''), 1800); }
  }

  let gitTimer;
  function refreshGitSoon(delay = 900) {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(async () => { try { S.git = await api('GET', '/api/git'); renderGit(); } catch (e) { console.warn(e); } }, delay);
  }

  // ---------- helpers ----------

  const photos = () => S.data.photos;
  const collById = id => S.data.collections.find(c => c.id === id);
  // Same order as the server keeps (lib/store.mjs): alphabetical in the gallery's locale.
  const cs = (a, b) => a.localeCompare(b, S.locale, { sensitivity: 'base', numeric: true }); // GALLERY_LOCALE, from /api/state
  const sortCollections = () => S.data.collections.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
    || (a.starred ? 0 : (a.group ? 0 : 1) - (b.group ? 0 : 1) || cs(a.group || '', b.group || ''))
    || cs(a.title, b.title)); // mirror of store.mjs collectionOrder
  const groupNames = () => [...new Set(S.data.collections.map(c => c.group).filter(Boolean))].sort(cs);
  const photoById = id => S.data.photos.find(p => p.id === id);
  const thumbUrl = (p, w = 480) => `/${p.draft ? 'drafts-img' : 'preview/img'}/${p.id}/${p.widths.find(x => x >= w) || p.widths[p.widths.length - 1]}.${p.format}?v=${p.version || 1}`;

  // Mirror of lib/order.mjs orderedPhotos(): automatic until a list has a stored order; photos
  // missing from a stored order (new uploads, newly added to the collection) come first.
  function orderedPhotos(list, stored) {
    const mode = S.data.settings.sort;
    const key = p => (mode === 'added' ? p.addedAt : (p.takenAt || p.addedAt)) || '';
    const auto = [...list].sort((a, b) => key(b).localeCompare(key(a)));
    if (!Array.isArray(stored)) return auto;
    const byId = new Map(list.map(p => [p.id, p]));
    const listed = new Set(stored);
    return [...auto.filter(p => !listed.has(p.id)), ...stored.filter(id => byId.has(id)).map(id => byId.get(id))];
  }

  // Published photos in their order; drafts have no place in an order until published.
  function sortedPhotos() {
    return orderedPhotos(photos().filter(p => !p.draft), S.data.settings.order);
  }
  const drafts = () => photos().filter(p => p.draft).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  const draftCount = () => photos().filter(p => p.draft).length;

  // Every view shows its drafts first (newest upload first), then the published photos.
  function visiblePhotos() {
    if (S.filter === 'drafts') return drafts();
    if (S.filter === 'all' || S.filter === 'settings') return [...drafts(), ...sortedPhotos()];
    if (S.filter === 'none') return [...drafts(), ...sortedPhotos()].filter(p => !p.collections.length);
    const c = collById(S.filter);
    if (!c) return [];
    const inC = p => p.collections.includes(c.id);
    return [...drafts().filter(inC), ...orderedPhotos(photos().filter(p => !p.draft && inC(p)), c.order)];
  }

  // The list whose order the current view shows: 'all', a collection id, or null ("No collection"
  // is just a filter and has no order of its own).
  function orderList() {
    if (S.filter === 'drafts') return null;
    if (S.filter === 'all' || S.filter === 'settings') return 'all';
    return collById(S.filter) ? S.filter : null;
  }
  const storedOrder = list => (list === 'all' ? S.data.settings.order : collById(list)?.order);

  async function changeOrder(action, ids = [], before = null) {
    const list = orderList();
    if (!list) return;
    saving(true);
    try {
      const r = await api('POST', '/api/order', { list, action, ids, before });
      if (list === 'all') S.data.settings.order = r.order; else collById(list).order = r.order;
      renderMain();
      if (action !== 'move') toast(action === 'reset' ? 'Back to sorting by date' : 'Order changed');
      refreshGitSoon();
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  // Order buttons shared by the single-photo editor and the multi-select panel.
  function orderControls(n) {
    if (!orderList()) return '';
    const where = orderList() === 'all' ? 'in All photos' : `in the collection "${esc(collById(orderList()).title)}"`;
    return `<div class="field"><div class="label">Order ${where}</div>
      <div class="row" style="margin-top:0">
        <button class="btn small" data-order="start">To the start</button>
        <button class="btn small" data-order="end">To the end</button>
        <button class="btn small" data-order="bydate" title="Moves ${n > 1 ? 'the selected photos' : 'the photo'} to where ${n > 1 ? 'they belong' : 'it belongs'} by date taken. The rest of the order stays.">Place by date</button>
      </div>
      <div class="hint">You can also drag photos in the grid.</div></div>`;
  }
  function bindOrderControls(root, ids) {
    root.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => changeOrder(b.dataset.order, ids)));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- rendering ----------

  function renderGit() {
    const g = S.git, el = $('git-state');
    if (!g) { el.textContent = ''; return; }
    if (!g.repo) { el.className = 'git-state dirty'; el.textContent = 'Not connected to GitHub'; el.title = 'See README: Connect to GitHub'; return; }
    const dirty = g.changes > 0 || g.ahead > 0;
    el.className = 'git-state ' + (dirty ? 'dirty' : 'clean');
    el.textContent = dirty ? '● Unpublished changes' : '✓ All published';
    el.title = g.remote || '';
    renderRepoSize(g.size);
    renderSync(g);
  }

  // Sync with GitHub: what the last fetch said, next to the publish state.
  function renderSync(g) {
    const el = $('sync-state');
    const n = g.behind || 0, few = n === 1 ? '1 change' : `${n} changes`;
    let html = '';
    if (g.fetchError) html = `<span class="sync warn" title="${esc(g.fetchError)}">GitHub unreachable</span>`;
    else if (n && (g.changes || g.ahead)) {
      html = `<span class="sync warn" title="GitHub has changes from another admin copy and you have unpublished edits. Publish pulls them first and merges them with yours.">↓ ${few} on GitHub · publish</span>`;
    } else if (n) {
      html = `<button class="btn small" id="sync-btn" title="Pulls what another admin copy published. Drafts are not synced, they stay in the copy where they were made.">↓ Sync (${few})</button>`;
    }
    if (g.restartNeeded) html += `<span class="sync warn" title="New admin code arrived from GitHub. It takes effect after a restart (close and start the admin again).">New code · restart the admin</span>`;
    el.innerHTML = html;
    $('sync-btn')?.addEventListener('click', syncNow);
  }

  async function syncNow() {
    saving(true);
    try {
      const r = await api('POST', '/api/sync', {});
      const st = await api('GET', '/api/state');
      S.data = st.data; S.git = st.git;
      S.selected.clear();
      renderAll();
      toast(r.pulled ? `Pulled from GitHub. Drafts stay in this copy only.` : 'Everything is up to date.');
    } catch (e) { fail(e); refreshGitSoon(0); }
    finally { saving(false); }
  }

  // Ask GitHub for news on start, every 5 minutes and when the window comes back to front.
  let lastCheck = 0;
  async function checkGitHub() {
    if (Date.now() - lastCheck < 60 * 1000) return;
    lastCheck = Date.now();
    try { S.git = await api('POST', '/api/sync/check', {}); renderGit(); } catch (e) { console.warn(e); }
  }
  setInterval(() => { lastCheck = 0; checkGitHub(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkGitHub(); });

  const fmtBytes = b => b >= 1e9 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;

  // Repository size incl. history against GitHub's 1 GB, with what the next publish will add.
  function renderRepoSize(size) {
    const el = $('repo-size');
    if (!size) { el.hidden = true; return; }
    const total = size.stored + size.pending, share = total / size.limit;
    el.hidden = false;
    el.className = 'repo-size' + (share >= 0.9 ? ' danger' : share >= 0.7 ? ' warn' : '');
    el.textContent = `${fmtBytes(total)} of 1 GB`;
    el.title = `Repository size on GitHub including history: ${fmtBytes(size.stored)}`
      + (size.pending ? `\nUnpublished photos will add about ${fmtBytes(size.pending)}.` : '')
      + `\nGitHub recommends repositories under 1 GB. Deleted and replaced photos stay in the history.`
      + (share >= 0.7 ? `\nTime to plan ahead (README → Limits).` : '');
  }

  function renderSide() {
    const all = photos();
    $('n-all').textContent = all.length;
    $('n-none').textContent = all.filter(p => !p.collections.length).length;
    $('n-drafts').textContent = draftCount() || '';
    renderConfirm();
    const item = c => {
      const inC = all.filter(p => p.collections.includes(c.id));
      const pub = inC.filter(p => !p.draft).length, dr = inC.length - pub;
      // A collection with nothing published is itself a draft: not on the site, not in git.
      const n = `${pub}${dr ? ` <i class="n-draft" title="${dr} in drafts">+${dr}</i>` : ''}`;
      const isDraft = !pub;
      return `<button class="side-item${isDraft ? ' is-draft' : ''}" data-filter="${c.id}"${isDraft ? ' title="Appears on the site once its first photo is published"' : ''}>${c.starred ? '<span class="star" title="Starred">★</span>' : ''}${esc(c.title)}<span class="n">${n}</span></button>`;
    };
    // Starred ones on top (as on the site), then every group with ALL its collections, starred
    // included: a group whose only collection is starred used to lose its heading here, and with
    // it the only way to rename it. A starred collection therefore shows twice; both open it.
    const colls = S.data.collections, groups = groupNames();
    const starred = colls.filter(c => c.starred);
    const html = (starred.length ? `<div class="side-group">Starred</div>${starred.map(item).join('')}` : '')
      + groups.map(g => `<button class="side-group" data-group="${esc(g)}" title="Rename group">${esc(g)}<span class="edit">✎</span></button>`
        + colls.filter(c => c.group === g).sort((a, b) => cs(a.title, b.title)).map(item).join('')).join('')
      + (() => {
        const rest = colls.filter(c => !c.group && !c.starred);
        return rest.length ? (groups.length || starred.length ? '<div class="side-group">No group</div>' : '') + rest.map(item).join('') : '';
      })();
    $('coll-list').innerHTML = html || '<div class="help" style="padding:4px 10px">No collections yet.</div>';
    document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.filter === S.filter));
  }

  function renderMain() {
    const list = visiblePhotos();
    const coll = collById(S.filter);
    $('view-title').textContent = S.filter === 'drafts' ? 'Drafts' : S.filter === 'none' ? 'Photos without a collection'
      : coll ? coll.title : 'All photos';
    $('view-sub').textContent = photosLabel(list.length) + (S.selected.size ? ` · ${S.selected.size} selected` : '');
    const ol = orderList(), custom = ol && Array.isArray(storedOrder(ol));
    $('order-state').innerHTML = !ol || !list.length ? ''
      : custom ? `Custom order · <button class="linkish" id="order-reset">back to sorting by ${S.data.settings.sort === 'added' ? 'upload' : 'date'}</button>`
      : `Sorted by ${S.data.settings.sort === 'added' ? 'upload' : 'date taken'} · drag a photo to make your own order`;
    $('order-reset')?.addEventListener('click', () => changeOrder('reset'));
    $('edit-collection').hidden = !coll;
    $('drop-hint').innerHTML = coll
      ? `Uploaded photos go straight into the collection <b>${esc(coll.title)}</b>`
      : 'JPG, PNG, WebP, TIFF · uploads start as drafts and go online only once confirmed';

    $('thumbs').innerHTML = list.map((p, i) => {
      const badges = [];
      if (p.draft) badges.push('draft');
      if (S.data.settings.coverPhotoId === p.id) badges.push('site preview');
      if (S.data.collections.some(c => c.coverId === p.id)) badges.push('cover');
      return `<button class="thumb${S.selected.has(p.id) ? ' sel' : ''}${p.draft ? ' is-draft' : ''}" data-id="${p.id}" data-i="${i}" draggable="true" style="background:${p.color}">
        <img src="${thumbUrl(p, 300)}" alt="" loading="lazy">
        ${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge${b === 'draft' ? ' draft' : ''}">${b}</span>`).join('')}</div>` : ''}
        ${p.title ? `<div class="t">${esc(p.title)}</div>` : ''}
      </button>`;
    }).join('');
    const empty = $('empty');
    empty.hidden = list.length > 0;
    empty.textContent = S.filter === 'all' ? 'No photos yet. Drop them into the box above.' : 'No photos in this view.';
  }

  let lastPanelKey = '';
  function renderPanel() {
    const panel = $('panel');
    const key = `${S.panel}|${S.filter}|${[...S.selected].join(',')}`;
    if (key !== lastPanelKey) { panel.scrollTop = 0; lastPanelKey = key; }
    if (S.panel === 'settings') return renderSettings(panel);
    if (S.panel === 'collection' && collById(S.filter)) return renderCollectionEditor(panel, collById(S.filter));
    if (S.selected.size === 1) return renderPhotoEditor(panel, photoById([...S.selected][0]));
    if (S.selected.size > 1) return renderMulti(panel);
    renderHelp(panel);
  }

  // Cheap update when only the selection changed (keeps thumbnails in place).
  function renderSelection() {
    document.querySelectorAll('#thumbs .thumb').forEach(t => t.classList.toggle('sel', S.selected.has(t.dataset.id)));
    const n = visiblePhotos().length;
    $('view-sub').textContent = photosLabel(n) + (S.selected.size ? ` · ${S.selected.size} selected` : '');
  }

  function renderAll() {
    renderSide();
    renderMain();
    renderPanel();
    renderGit();
  }

  // ---------- panel: help ----------

  function renderHelp(panel) {
    panel.innerHTML = `
      <h2>How it works</h2>
      <div class="help">
        <ol>
          <li><b>Upload photos</b> by dropping them into the box. Title and description are read from the metadata (Lightroom, Capture One, Photos…) when present.</li>
          <li><b>Click a photo</b> and fill in title, description, location and collections. Everything saves by itself.</li>
          <li><b>Ctrl/Shift + click</b> selects several photos. Selected photos can be dragged onto a collection on the left.</li>
          <li><b>Site preview</b> shows the gallery exactly as it will look online.</li>
          <li><b>Publish to GitHub</b> sends the changes to the site. They are online within a minute.</li>
        </ol>
        <p>Keys: <b>Ctrl+A</b> select all · <b>Esc</b> clear selection · <b>Delete</b> delete selected</p>
      </div>`;
  }

  // ---------- panel: single photo ----------

  function collectionChecks(p) {
    return S.data.collections.map(c => {
      const on = p.collections.includes(c.id);
      return `<div class="check">
        <label><input type="checkbox" data-coll="${c.id}" ${on ? 'checked' : ''}> ${esc(c.title)}</label>
        <button class="star${c.coverId === p.id ? ' on' : ''}" data-cover="${c.id}" title="Collection cover" ${on ? '' : 'disabled'}>★</button>
      </div>`;
    }).join('') || '<div class="help" style="padding:6px">No collections yet.</div>';
  }

  function renderPhotoEditor(panel, p) {
    if (!p) { renderHelp(panel); return; }
    const ex = p.exif || {};
    const exifRows = [['Camera', ex.camera], ['Lens', ex.lens], ['Exposure', [ex.focal, ex.aperture, ex.shutter, ex.iso].filter(Boolean).join(' · ')],
      ['Size', `${p.width} × ${p.height}`], ['Online', `${Math.round((p.bytes || 0) / 1024)} kB`], ['File', p.originalName]]
      .filter(r => r[1]);
    const isCover = S.data.settings.coverPhotoId === p.id;
    panel.innerHTML = `
      <img class="preview" data-replace="${p.id}" src="${thumbUrl(p, 960)}" alt="" style="aspect-ratio:${p.width}/${p.height};background:${p.color}" title="Drop an edited version here to replace this photo">
      <div class="field"><label for="f-title">Title</label><input type="text" id="f-title" value="${esc(p.title)}" placeholder="e.g. Morning in the mountains"></div>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" placeholder="A short story behind the photo (optional)">${esc(p.description)}</textarea></div>
      <div class="field"><label for="f-loc">Location</label><input type="text" id="f-loc" value="${esc(p.location)}" placeholder="e.g. Florence, Italy"></div>
      <div class="field"><label for="f-date">Date taken</label><input type="datetime-local" step="1" id="f-date" value="${esc(p.takenAt)}">
        <div class="hint">From EXIF. Photos are sorted by it.</div></div>
      <div class="field"><div class="label">Collections <span class="hint">(★ = collection cover)</span></div>
        <div class="checks" id="f-colls">${collectionChecks(p)}</div>
        <div class="row"><input type="text" id="f-newcoll" placeholder="New collection…" style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg)">
          <button class="btn small" id="f-newcoll-btn">Add</button></div>
      </div>
      ${exifRows.length ? `<div class="exif">${exifRows.map(r => `<div><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join('')}</div>` : ''}
      ${p.draft ? '' : orderControls(1)}
      ${p.draft
        ? `<div class="draft-box"><b>Draft.</b> Not on the site or on GitHub yet. <button class="btn small confirm" id="f-publish">Publish</button></div>`
        : ''}
      <div class="row">
        ${p.draft ? '' : `<button class="btn small" id="f-cover">${isCover ? '✓ Site preview image' : 'Use as site preview image'}</button>
        <a class="btn small ghost" href="/preview/f/${p.id}/" target="gallery-preview">On the site ↗</a>
        <button class="btn small ghost" id="f-unpublish">Back to drafts</button>`}
        <label class="btn small">Replace file…<input type="file" id="f-replace" accept="image/jpeg,image/png,image/webp,image/tiff" hidden></label>
        <button class="btn small danger" id="f-delete">Delete</button>
      </div>
      <div class="hint help" style="margin-top:8px">Site preview image = the picture shown when a link to the gallery is shared.<br>
        Replace file = upload an edited version (colours, crop). Title, description, collections and link stay. You can also drop the file onto the preview above.</div>`;

    const save = debounce(async patch => {
      saving(true);
      try { Object.assign(p, await api('PATCH', `/api/photos/${p.id}`, patch)); renderMain(); refreshGitSoon(); }
      catch (e) { fail(e); }
      finally { saving(false); }
    }, 450);
    const pending = {};
    const queue = (k, v) => { pending[k] = v; save({ ...pending }); };

    $('f-title').addEventListener('input', e => queue('title', e.target.value));
    $('f-desc').addEventListener('input', e => queue('description', e.target.value));
    $('f-loc').addEventListener('input', e => queue('location', e.target.value));
    $('f-date').addEventListener('change', e => queue('takenAt', e.target.value.length === 16 ? e.target.value + ':00' : e.target.value));

    $('f-colls').addEventListener('change', async e => {
      const id = e.target.dataset.coll;
      if (!id) return;
      const next = e.target.checked ? [...p.collections, id] : p.collections.filter(c => c !== id);
      await updatePhotoNow(p, { collections: next });
      e.target.closest('.check').querySelector('.star').disabled = !e.target.checked;
    });
    $('f-colls').addEventListener('click', async e => {
      const b = e.target.closest('[data-cover]');
      if (!b) return;
      const c = collById(b.dataset.cover);
      await updateCollectionNow(c, { coverId: c.coverId === p.id ? '' : p.id });
      renderPanel();
    });
    const addNew = async () => {
      const title = $('f-newcoll').value.trim();
      if (!title) return;
      try {
        const c = await api('POST', '/api/collections', { title });
        S.data.collections.push(c); sortCollections();
        await updatePhotoNow(p, { collections: [...p.collections, c.id] });
        renderPanel();
      } catch (e) { fail(e); }
    };
    $('f-newcoll-btn').addEventListener('click', addNew);
    $('f-newcoll').addEventListener('keydown', e => { if (e.key === 'Enter') addNew(); });
    $('f-publish')?.addEventListener('click', () => confirmDrafts([p.id]));
    $('f-unpublish')?.addEventListener('click', () => unpublish([p.id]));
    $('f-cover')?.addEventListener('click', async () => {
      await saveSettingsNow({ coverPhotoId: isCover ? '' : p.id });
      renderMain(); renderPanel();
    });
    $('f-delete').addEventListener('click', () => confirmDelete([p.id]));
    bindOrderControls(panel, [p.id]);
    $('f-replace').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) replaceFile(p, f); });
  }

  async function replaceFile(p, file) {
    saving(true);
    toast('Processing the new version…');
    try {
      const updated = await api('POST', `/api/photos/${p.id}/replace?${new URLSearchParams({ name: file.name })}`, undefined, file);
      Object.assign(p, updated);
      renderMain(); renderPanel();
      toast('Photo replaced with the new version');
      refreshGitSoon(1500);
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  async function updatePhotoNow(p, patch) {
    saving(true);
    try { Object.assign(p, await api('PATCH', `/api/photos/${p.id}`, patch)); renderSide(); renderMain(); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }
  async function updateCollectionNow(c, patch) {
    saving(true);
    try { Object.assign(c, await api('PATCH', `/api/collections/${c.id}`, patch)); sortCollections(); renderSide(); renderMain(); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }
  async function saveSettingsNow(patch) {
    saving(true);
    try { S.data.settings = await api('PATCH', '/api/settings', patch); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }

  // ---------- panel: multiple photos ----------

  function renderMulti(panel) {
    const ids = [...S.selected];
    const coll = collById(S.filter);
    // Existing collections grouped like the sidebar (optgroup per group), ungrouped ones last.
    const option = c => `<option value="${c.id}">${c.starred ? '★ ' : ''}${esc(c.title)}</option>`;
    const opts = groupNames().length
      ? groupNames().map(g => `<optgroup label="${esc(g)}">${S.data.collections.filter(c => c.group === g).map(option).join('')}</optgroup>`).join('')
        + (S.data.collections.some(c => !c.group) ? `<optgroup label="No group">${S.data.collections.filter(c => !c.group).map(option).join('')}</optgroup>` : '')
      : S.data.collections.map(option).join('');
    const sel = ids.map(photoById).filter(Boolean);
    // Prefill a field only when every selected photo has the same value; otherwise say they differ.
    const common = k => { const v = new Set(sel.map(p => p[k] || '')); return v.size === 1 ? [...v][0] : null; };
    const textField = (k, id, label, ph, area) => {
      const v = common(k);
      const attrs = `id="${id}" data-bulk="${k}" data-ph="${ph}" placeholder="${v === null ? 'different values' : ph}"`;
      return `<div class="field"><label for="${id}">${label}</label><div class="clearable">${area
        ? `<textarea ${attrs}>${esc(v || '')}</textarea>` : `<input type="text" ${attrs} value="${esc(v || '')}">`}
        <button type="button" class="clear-btn" data-clear="${k}" title="Clear for all selected" aria-label="Clear ${label.toLowerCase()} for all selected">×</button></div></div>`;
    };
    // Date inputs show no placeholder, so differing dates are described under the field.
    const dateField = () => {
      const v = common('takenAt');
      const dates = sel.map(p => p.takenAt).filter(Boolean).sort();
      const fmt = d => new Date(d).toLocaleDateString();
      const hint = v !== null ? 'Photos are sorted by date.'
        : `Different dates${dates.length ? ` (${fmt(dates[0])} – ${fmt(dates.at(-1))})` : ''}. A new date applies to all selected.`;
      return `<div class="field"><label for="m-date">Date taken</label><div class="clearable">
        <input type="datetime-local" step="1" id="m-date" data-bulk="takenAt" data-ph="" value="${esc(v || '')}">
        <button type="button" class="clear-btn" data-clear="takenAt" title="Clear for all selected" aria-label="Clear the date for all selected">×</button></div>
        <div class="hint">${hint}</div></div>`;
    };
    panel.innerHTML = `
      <h2>Selected: ${photosLabel(ids.length)}</h2>
      <div id="m-bulk">
      <div class="section-title">Fill in for all selected</div>
      ${textField('title', 'm-title', 'Title', 'e.g. Morning in the mountains')}
      ${textField('description', 'm-desc', 'Description', 'A short story behind the photos (optional)', true)}
      ${textField('location', 'm-loc', 'Location', 'e.g. Florence, Italy')}
      ${dateField()}
      <label class="inline-check"><input type="checkbox" id="m-only-empty"> Only where the field is empty</label>
      <div class="hint help" style="margin-top:6px">Saved when you click elsewhere or press Enter, for all selected photos. × clears the field for all of them. You can still edit each photo on its own.</div>
      </div>
      <hr class="sep">
      ${sel.some(p => !p.draft) ? orderControls(ids.length) : ''}
      <div class="field"><label for="m-coll">Add to collection</label>
        <div class="row" style="margin-top:0"><select id="m-coll" style="flex:1">${opts || '<option value="">(no collections)</option>'}</select>
        <button class="btn small" id="m-add" ${opts ? '' : 'disabled'}>Add</button></div></div>
      <div class="field"><label for="m-new">…or to a new collection</label>
        <div class="row" style="margin-top:0"><input type="text" id="m-new" placeholder="Collection title" style="flex:1">
        <button class="btn small" id="m-new-btn">Create</button></div>
        <input type="text" id="m-new-group" list="m-groups" placeholder="Group (optional), e.g. Italy" style="margin-top:6px">
        <datalist id="m-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
      <hr class="sep">
      ${sel.some(p => p.draft) || sel.some(p => !p.draft) ? `<div class="row">
        ${sel.some(p => p.draft) ? `<button class="btn small confirm" id="m-publish">Publish drafts (${sel.filter(p => p.draft).length})</button>` : ''}
        ${sel.some(p => !p.draft) ? `<button class="btn small ghost" id="m-unpublish">Back to drafts (${sel.filter(p => !p.draft).length})</button>` : ''}
      </div>` : ''}
      <div class="row">
        ${coll ? `<button class="btn small" id="m-remove">Remove from "${esc(coll.title)}"</button>` : ''}
        <button class="btn small danger" id="m-delete">Delete selected</button>
        <button class="btn small ghost" id="m-clear">Clear selection</button>
      </div>`;
    // Same rule as everywhere in the admin: a change is saved when you leave the field (or press
    // Enter). Not on every keystroke like the single-photo editor: with "only empty" ticked, saving
    // "Fl" would fill the photos and the finished "Florence" would then skip them as no longer empty.
    // Leaving a field empty clears it; × clears it too, which is the only way when values differ
    // (the field then starts empty, so there is nothing to delete).
    const box = $('m-bulk'); // re-created on every render, unlike `panel`, so listeners never pile up
    const saveField = (k, value) => {
      const v = value.trim();
      const input = box.querySelector(`[data-bulk="${k}"]`);
      input.placeholder = input.dataset.ph;
      return bulk(v ? { ids, set: { [k]: v }, onlyEmpty: $('m-only-empty').checked } : { ids, clear: [k] },
        v ? `Saved (${photosLabel(ids.length)})` : `Cleared (${photosLabel(ids.length)})`, { keepPanel: true });
    };
    box.addEventListener('change', e => { const k = e.target.dataset?.bulk; if (k) saveField(k, e.target.value); });
    box.addEventListener('click', e => {
      const k = e.target.closest('[data-clear]')?.dataset.clear;
      if (!k) return;
      box.querySelector(`[data-bulk="${k}"]`).value = '';
      saveField(k, '');
    });
    bindOrderControls(panel, ids);
    $('m-publish')?.addEventListener('click', () => confirmDrafts(sel.filter(p => p.draft).map(p => p.id)));
    $('m-unpublish')?.addEventListener('click', () => unpublish(sel.filter(p => !p.draft).map(p => p.id)));
    $('m-add').addEventListener('click', () => bulk({ ids, addCollection: $('m-coll').value }, 'Added to the collection'));
    const createAndAdd = async () => {
      const title = $('m-new').value.trim();
      if (!title) return;
      try {
        const c = await api('POST', '/api/collections', { title, group: $('m-new-group').value });
        S.data.collections.push(c); sortCollections();
        await bulk({ ids, addCollection: c.id }, `Created the collection "${c.title}"${c.group ? ` in the group ${c.group}` : ''}`);
      } catch (e) { fail(e); }
    };
    $('m-new-btn').addEventListener('click', createAndAdd);
    $('m-new').addEventListener('keydown', e => { if (e.key === 'Enter') createAndAdd(); });
    $('m-new-group').addEventListener('keydown', e => { if (e.key === 'Enter') createAndAdd(); });
    if (coll) $('m-remove').addEventListener('click', () => bulk({ ids, removeCollection: coll.id }, 'Removed from the collection'));
    $('m-delete').addEventListener('click', () => confirmDelete(ids));
    $('m-clear').addEventListener('click', () => { S.selected.clear(); renderSelection(); renderPanel(); });
  }

  // keepPanel: text fields in the multi-select panel save on blur; re-rendering the panel then
  // would steal focus from the field the user just clicked into.
  async function bulk(payload, okMsg, { keepPanel = false } = {}) {
    saving(true);
    try {
      const res = await api('POST', '/api/photos/bulk', payload);
      const set = new Set(payload.ids);
      if (res.photos) {
        for (const u of res.photos) Object.assign(photoById(u.id) || {}, u);
      } else if (payload.remove) {
        S.data.photos = S.data.photos.filter(p => !set.has(p.id));
        S.selected.clear();
      } else {
        for (const p of S.data.photos) {
          if (!set.has(p.id)) continue;
          if (payload.addCollection && !p.collections.includes(payload.addCollection)) p.collections.push(payload.addCollection);
          if (payload.removeCollection) p.collections = p.collections.filter(c => c !== payload.removeCollection);
        }
      }
      if (okMsg) toast(okMsg);
      if (keepPanel) { renderSide(); renderMain(); renderGit(); } else renderAll();
      refreshGitSoon();
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  function confirmDelete(ids) {
    modal(`Delete ${photosLabel(ids.length)}?`,
      '<p class="help">The photos leave the gallery and, once published, the site. Your originals on disk are not touched.</p>',
      [['Cancel', 'ghost'], ['Delete', 'primary', async () => { await bulk({ ids, remove: true }, 'Deleted'); }]]);
  }

  // ---------- panel: collection ----------

  function renderCollectionEditor(panel, c) {
    const n = photos().filter(p => p.collections.includes(c.id)).length;
    const cover = photoById(c.coverId) || sortedPhotos().find(p => p.collections.includes(c.id));
    panel.innerHTML = `
      <h2>Collection</h2>
      ${cover ? `<img class="preview" src="${thumbUrl(cover, 960)}" alt="" style="aspect-ratio:${cover.width}/${cover.height}">` : ''}
      <div class="field"><label for="c-title">Title</label><input type="text" id="c-title" value="${esc(c.title)}"></div>
      <div class="field"><label for="c-group">Group</label>
        <input type="text" id="c-group" value="${esc(c.group || '')}" list="c-groups" placeholder="e.g. Italy, Japan">
        <datalist id="c-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <div class="hint">Collections in the same group sort together and share a page on the site with all their photos. Empty = no group.</div></div>
      <label class="inline-check coll-star" title="Starred collections come first (alphabetically among themselves) and get a star and a frame on the site"><input type="checkbox" id="c-starred" ${c.starred ? 'checked' : ''}> ★ Star (list first)</label>
      <div class="field"><label for="c-desc">Description</label><textarea id="c-desc" placeholder="A few words about the collection (optional)">${esc(c.description)}</textarea></div>
      <div class="field"><label for="c-slug">Address</label><input type="text" id="c-slug" value="${esc(c.slug)}">
        <div class="hint">…/collections/<b>${esc(c.slug)}</b>/ — after a change the old address redirects to the new one, shared links keep working.</div></div>
      <div class="help">${photosLabel(n)} · pick the cover with the star next to a photo</div>
      <div class="row">
        <a class="btn small ghost" href="/preview/collections/${esc(c.slug)}/" target="gallery-preview">On the site ↗</a>
      </div>
      <hr class="sep">
      <div class="row"><button class="btn small danger" id="c-delete">Delete collection</button> <button class="btn small ghost" id="c-close">Done</button></div>
      <div class="hint help" style="margin-top:8px">Deleting a collection does not delete its photos.</div>`;

    const save = debounce(patch => updateCollectionNow(c, patch), 500);
    $('c-title').addEventListener('input', e => save({ title: e.target.value }));
    $('c-desc').addEventListener('input', e => save({ description: e.target.value }));
    $('c-starred').addEventListener('change', e => updateCollectionNow(c, { starred: e.target.checked }));
    $('c-group').addEventListener('change', e => updateCollectionNow(c, { group: e.target.value }));
    $('c-slug').addEventListener('change', async e => { await updateCollectionNow(c, { slug: e.target.value }); renderPanel(); });
    $('c-close').addEventListener('click', () => { S.panel = 'auto'; renderPanel(); });
    $('c-delete').addEventListener('click', () => modal(`Delete the collection "${c.title}"?`,
      '<p class="help">Its photos stay in the gallery, just no longer in this collection.</p>',
      [['Cancel', 'ghost'], ['Delete collection', 'primary', async () => {
        try {
          await api('DELETE', `/api/collections/${c.id}`);
          S.data.collections = S.data.collections.filter(x => x.id !== c.id);
          for (const p of S.data.photos) p.collections = p.collections.filter(x => x !== c.id);
          setFilter('all');
          refreshGitSoon();
        } catch (e) { fail(e); }
      }]]));
  }

  // ---------- panel: settings ----------

  function renderSettings(panel) {
    const s = S.data.settings;
    const links = s.links?.length ? s.links : [{ label: '', url: '' }];
    panel.innerHTML = `
      <h2>Profile & settings</h2>
      <div class="field"><div class="label">Profile photo</div>
        <div class="avatar-row">
          <img src="${s.avatar ? `/preview/${s.avatar}?v=${s.avatarVersion || 0}` : 'data:,'}" alt="">
          <label class="btn small">Upload…<input type="file" id="s-avatar" accept="image/*" hidden></label>
        </div></div>
      <div class="field"><label for="s-name">Name</label><input type="text" id="s-name" value="${esc(s.name)}"></div>
      <div class="field"><label for="s-bio">Short bio</label><textarea id="s-bio">${esc(s.bio)}</textarea></div>
      <div class="field"><label for="s-copyright">Copyright</label>
        <input type="text" id="s-copyright" value="${esc(s.copyright)}" placeholder="© 2026 Your Name. All rights reserved.">
        <div class="hint">Written into every photo on the site together with the name (author) and the contact e-mail (EXIF and XMP, including the "copyrighted" flag), so anyone who downloads a photo sees whose it is and whom to ask. Nothing else from the original is written. The same text is the site footer. Applies to new uploads. EXIF has no accents, so it gets "(C)" instead of "©". Empty = write nothing.</div>
        ${S.data.photos.length ? `<button class="btn small" id="s-rewrite" style="margin-top:8px">Apply name, copyright and contact to uploaded photos too (${S.data.photos.length})</button>` : ''}</div>
      <div class="field"><div class="label">Links (text · address)</div>
        <div id="s-links">${links.map(l => linkRow(l)).join('')}</div>
        <button class="btn small ghost" id="s-addlink">+ link</button></div>
      <hr class="sep">
      <div class="field"><label for="s-sort">Photo order</label>
        <select id="s-sort">
          <option value="taken" ${s.sort !== 'added' ? 'selected' : ''}>By date taken (newest first)</option>
          <option value="added" ${s.sort === 'added' ? 'selected' : ''}>By upload (newest first)</option>
        </select>
        <div class="hint">Automatic order. Applies to All photos and to every collection until you rearrange photos by hand; that list then keeps its own order.</div></div>
      <div class="field"><label for="s-url">Public address of the gallery</label>
        <input type="url" id="s-url" value="${esc(s.siteUrl)}" placeholder="https://example.com/photos/">
        <div class="hint">Needed for link previews when sharing (Messenger, WhatsApp…).</div></div>
      <div class="field"><label for="s-domain">Custom subdomain (only when the gallery runs on one)</label>
        <input type="text" id="s-domain" value="${esc(s.customDomain)}" placeholder="e.g. photos.example.com, or leave empty">
        <div class="hint">Only when the gallery runs on a subdomain. Written to the CNAME file.</div></div>
      <div class="field"><label for="s-analytics">Visitor analytics (Cloudflare Web Analytics)</label>
        <input type="text" id="s-analytics" value="${esc(s.analyticsToken || '')}" placeholder="token, or the whole snippet from Cloudflare">
        <div class="hint">Cloudflare → Analytics &amp; Logs → Web Analytics → Add a site → your domain. Paste the token (or the whole snippet) here. No cookies. The admin preview is not counted. Empty = no analytics.</div></div>
      <div class="field"><label for="s-contact">Contact e-mail</label>
        <input type="email" id="s-contact" value="${esc(s.contact ? `${s.contact.user}@${s.contact.domain}` : '')}" placeholder="photos@example.com">
        <div class="hint">Shown on the site as an <b>Email</b> link next to the profile links and in the footer. The address is stored split and only put together in the browser, so bots harvesting e-mails from pages or the repository do not find it. Empty = no contact.</div></div>`;

    const save = debounce(patch => saveSettingsNow(patch), 500);
    $('s-name').addEventListener('input', e => save({ name: e.target.value }));
    $('s-bio').addEventListener('input', e => save({ bio: e.target.value }));
    $('s-copyright').addEventListener('change', e => saveSettingsNow({ copyright: e.target.value }));
    $('s-rewrite')?.addEventListener('click', () => {
      const mb = S.data.photos.reduce((a, p) => a + (p.bytes || 0), 0) / 1e6;
      modal('Rewrite author and copyright in uploaded photos?',
        `<p>The files of all ${photosLabel(S.data.photos.length)} get the author <b>${esc(S.data.settings.name)}</b>, the copyright <b>${esc(S.data.settings.copyright || '(none)')}</b> and the contact for usage requests. Images are not re-compressed, quality stays the same. Files that already match are left alone.</p>
         <p class="hint">Git keeps every version of a file, so after publishing the repository grows by about ${mb.toFixed(0)} MB. Don't do this more often than needed.</p>`,
        [['Cancel', 'ghost'], ['Rewrite', 'primary', async () => {
          saving(true);
          try { const r = await api('POST', '/api/photos/rewrite-author', {}); toast(`Done: ${photosLabel(r.photos)}, files changed: ${r.files}`); refreshGitSoon(); }
          catch (e) { fail(e); }
          finally { saving(false); }
        }]]);
    });
    $('s-url').addEventListener('change', e => saveSettingsNow({ siteUrl: e.target.value }));
    $('s-domain').addEventListener('change', e => saveSettingsNow({ customDomain: e.target.value }));
    $('s-contact').addEventListener('change', async e => { await saveSettingsNow({ contactEmail: e.target.value }); const c = S.data.settings.contact; e.target.value = c ? `${c.user}@${c.domain}` : ''; });
    $('s-analytics').addEventListener('change', async e => { await saveSettingsNow({ analyticsToken: e.target.value }); e.target.value = S.data.settings.analyticsToken || ''; });
    $('s-sort').addEventListener('change', async e => { await saveSettingsNow({ sort: e.target.value }); renderMain(); });
    const saveLinks = debounce(() => {
      const rows = [...document.querySelectorAll('#s-links .link-row')].map(r => ({ label: r.children[0].value, url: r.children[1].value }));
      saveSettingsNow({ links: rows });
    }, 500);
    $('s-links').addEventListener('input', saveLinks);
    $('s-links').addEventListener('click', e => { if (e.target.dataset.rm !== undefined) { e.target.parentElement.remove(); saveLinks(); } });
    $('s-addlink').addEventListener('click', () => $('s-links').insertAdjacentHTML('beforeend', linkRow({ label: '', url: '' })));
    $('s-avatar').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      saving(true);
      try { S.data.settings = await api('POST', '/api/avatar', undefined, f); renderPanel(); refreshGitSoon(); }
      catch (err) { fail(err); }
      finally { saving(false); }
    });
  }
  const linkRow = l => `<div class="link-row"><input type="text" placeholder="Portfolio" value="${esc(l.label)}"><input type="url" placeholder="https://…" value="${esc(l.url)}"><button class="btn small ghost" data-rm title="Remove">×</button></div>`;

  // ---------- modal ----------

  function modal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const box = $('modal-actions');
    box.innerHTML = '';
    for (const [label, kind, fn] of actions) {
      const b = document.createElement('button');
      b.className = `btn ${kind || ''}`;
      b.textContent = label;
      b.addEventListener('click', async () => {
        if (fn) { b.disabled = true; const keep = await fn(); b.disabled = false; if (keep === 'keep') return; }
        $('modal').hidden = true;
      });
      box.appendChild(b);
    }
    $('modal').hidden = false;
    box.lastChild?.focus();
  }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').hidden = true; });

  // ---------- selection & filters ----------

  function setFilter(f) {
    S.filter = f;
    S.panel = f === 'settings' ? 'settings' : 'auto';
    if (f === 'settings') S.filter = 'all';
    S.selected.clear();
    S.lastIndex = -1;
    renderAll();
    if (f === 'settings') document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'settings'));
  }

  document.querySelector('.side').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (b) setFilter(b.dataset.filter);
  });

  // Rename a group: all its collections at once; the old group page keeps redirecting.
  $('coll-list').addEventListener('click', e => {
    const from = e.target.closest('[data-group]')?.dataset.group;
    if (!from) return;
    const n = S.data.collections.filter(c => c.group === from).length;
    modal('Rename group', `<div class="field"><label for="rg-name">Group name</label><input type="text" id="rg-name" value="${esc(from)}">
      <div class="hint">Changes ${n === 1 ? '1 collection' : `${n} collections`}. The group's old address redirects to the new one. Entering the name of another existing group merges the two.</div></div>`,
      [['Cancel', 'ghost'], ['Rename', 'primary', async () => {
        const to = $('rg-name').value.trim();
        if (!to) return 'keep';
        if (to === from) return;
        try {
          const r = await api('POST', '/api/groups/rename', { from, to });
          const key = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          for (const c of S.data.collections) if (c.group && key(c.group) === key(from)) c.group = r.group;
          sortCollections(); renderSide(); renderPanel(); refreshGitSoon();
          toast(`Group renamed to "${r.group}"`);
        } catch (err) { fail(err); return 'keep'; }
      }]]);
    setTimeout(() => { $('rg-name')?.focus(); $('rg-name')?.select(); }, 30);
    $('rg-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('modal-actions').lastChild.click(); });
  });

  $('add-collection').addEventListener('click', () => {
    modal('New collection', '<div class="field"><label for="nc-title">Title</label><input type="text" id="nc-title" placeholder="e.g. Tuscany 2025"></div>'
      + `<div class="field"><label for="nc-group">Group (optional)</label><input type="text" id="nc-group" list="nc-groups" placeholder="e.g. Italy">
         <datalist id="nc-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>`,
      [['Cancel', 'ghost'], ['Create', 'primary', async () => {
        const title = $('nc-title').value.trim();
        if (!title) return 'keep';
        try {
          const c = await api('POST', '/api/collections', { title, group: $('nc-group').value });
          S.data.collections.push(c); sortCollections();
          setFilter(c.id);
          refreshGitSoon();
        } catch (e) { fail(e); return 'keep'; }
      }]]);
    setTimeout(() => $('nc-title')?.focus(), 30);
    for (const id of ['nc-title', 'nc-group']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('modal-actions').lastChild.click(); });
  });

  $('edit-collection').addEventListener('click', () => { S.panel = 'collection'; S.selected.clear(); renderMain(); renderPanel(); });

  $('select-all').addEventListener('click', () => selectAll());
  function selectAll() {
    visiblePhotos().forEach(p => S.selected.add(p.id));
    S.panel = 'auto';
    renderSelection(); renderPanel();
  }

  $('thumbs').addEventListener('click', e => {
    const t = e.target.closest('.thumb');
    if (!t) return;
    const id = t.dataset.id, i = Number(t.dataset.i);
    const list = visiblePhotos();
    if (e.shiftKey && S.lastIndex >= 0) {
      const [a, b] = [Math.min(S.lastIndex, i), Math.max(S.lastIndex, i)];
      for (let k = a; k <= b; k++) S.selected.add(list[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
      S.lastIndex = i;
    } else {
      S.selected.clear();
      S.selected.add(id);
      S.lastIndex = i;
    }
    S.panel = 'auto';
    document.querySelectorAll('.side-item[data-filter=settings]').forEach(b => b.classList.remove('active'));
    renderSelection(); renderPanel();
  });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (!$('modal').hidden) { $('modal').hidden = true; return; }
      if (!typing && S.selected.size) { S.selected.clear(); renderSelection(); renderPanel(); }
    }
    if (typing || !$('modal').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected.size) { e.preventDefault(); confirmDelete([...S.selected]); }
  });

  // Drag selected thumbnails onto a collection in the sidebar.
  $('thumbs').addEventListener('dragstart', e => {
    const t = e.target.closest('.thumb');
    if (!t) return;
    const ids = S.selected.has(t.dataset.id) ? [...S.selected] : [t.dataset.id];
    e.dataTransfer.setData('application/x-photo-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove'; // copy onto a collection, move within the grid
  });

  // Drag thumbnails within the grid to reorder the current list. The marker shows on which side
  // of the photo under the pointer the dragged ones will land.
  let dropMark = null;
  const clearMark = () => { dropMark?.el.classList.remove('drop-before', 'drop-after'); dropMark = null; };
  $('thumbs').addEventListener('dragover', e => {
    if (!orderList() || !e.dataTransfer.types.includes('application/x-photo-ids')) return;
    const t = e.target.closest('.thumb');
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = t.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    if (dropMark?.el !== t || dropMark.after !== after) {
      clearMark();
      dropMark = { el: t, after };
      t.classList.add(after ? 'drop-after' : 'drop-before');
    }
  });
  $('thumbs').addEventListener('dragleave', e => { if (!e.currentTarget.contains(e.relatedTarget)) clearMark(); });
  $('thumbs').addEventListener('drop', e => {
    if (!dropMark) return;
    e.preventDefault();
    const ids = JSON.parse(e.dataTransfer.getData('application/x-photo-ids') || '[]').filter(id => !photoById(id)?.draft);
    const { el, after } = dropMark;
    clearMark();
    if (!ids.length) { toast('Drafts get a place in the order once published'); return; }
    let target = after ? el.nextElementSibling : el;
    // Next to itself, or onto the drafts at the top (they have no place in the order yet).
    while (target && (ids.includes(target.dataset.id) || photoById(target.dataset.id)?.draft)) target = target.nextElementSibling;
    changeOrder('move', ids, target?.dataset.id || null);
  });
  $('thumbs').addEventListener('dragend', clearMark);
  const side = document.querySelector('.side');
  side.addEventListener('dragover', e => {
    const item = e.target.closest('#coll-list [data-filter]');
    if (!item || !e.dataTransfer.types.includes('application/x-photo-ids')) return;
    e.preventDefault();
    side.querySelectorAll('.drop-target').forEach(x => x !== item && x.classList.remove('drop-target'));
    item.classList.add('drop-target');
  });
  side.addEventListener('dragleave', e => e.target.closest?.('[data-filter]')?.classList.remove('drop-target'));
  side.addEventListener('drop', e => {
    const item = e.target.closest('#coll-list [data-filter]');
    side.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    if (!item) return;
    const raw = e.dataTransfer.getData('application/x-photo-ids');
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const c = collById(item.dataset.filter);
    bulk({ ids: JSON.parse(raw), addCollection: c.id }, `Added to "${c.title}"`);
  });

  // ---------- upload ----------

  const queue = { items: [], active: 0, done: 0, total: 0, errors: 0 };
  const CONCURRENCY = 2;

  function renderQueue() {
    const el = $('queue');
    if (!queue.total) { el.hidden = true; return; }
    el.hidden = false;
    const finished = queue.done + queue.errors === queue.total;
    const pct = Math.round(((queue.done + queue.errors) / queue.total) * 100);
    const rows = queue.items.filter(i => i.status !== 'done').slice(0, 6);
    el.innerHTML = `
      <div class="q-head"><span>${finished ? `Done: uploaded ${queue.done} of ${queue.total}` : `Uploading ${queue.done + queue.errors + 1} of ${queue.total}…`}</span>
        ${finished ? '<button class="mini" id="q-close">Close</button>' : ''}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      ${rows.map(i => `<div class="q-item${i.status === 'error' ? ' err' : ''}"><span>${esc(i.file.name)}</span><span>${esc(i.label)}</span></div>`).join('')}`;
    $('q-close')?.addEventListener('click', () => { Object.assign(queue, { items: [], done: 0, total: 0, errors: 0 }); renderQueue(); });
  }

  function enqueue(files) {
    const accepted = S.image.accepted;
    const collection = collById(S.filter) ? S.filter : '';
    if (queue.done + queue.errors === queue.total) Object.assign(queue, { items: [], done: 0, total: 0, errors: 0 });
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const item = { file, collection, status: 'waiting', label: 'waiting' };
      if (!accepted.includes(ext)) { item.status = 'error'; item.label = 'unsupported format'; queue.errors++; }
      queue.items.push(item);
      queue.total++;
    }
    renderQueue();
    pump();
  }

  function pump() {
    while (queue.active < CONCURRENCY) {
      const item = queue.items.find(i => i.status === 'waiting');
      if (!item) break;
      queue.active++;
      upload(item).finally(() => { queue.active--; renderQueue(); pump(); });
    }
  }

  function upload(item) {
    item.status = 'uploading';
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      const qs = new URLSearchParams({ name: item.file.name, collection: item.collection });
      xhr.open('POST', `/api/upload?${qs}`);
      xhr.upload.onprogress = e => { item.label = `${Math.round((e.loaded / e.total) * 100)} %`; renderQueue(); };
      xhr.upload.onload = () => { item.label = 'processing…'; renderQueue(); };
      xhr.onload = () => {
        let res = {};
        try { res = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 200) {
          item.status = 'done';
          queue.done++;
          const existing = photoById(res.photo.id);
          if (existing) Object.assign(existing, res.photo);
          else S.data.photos.push(res.photo);
          renderSide(); renderMain();
          refreshGitSoon(1500);
        } else {
          item.status = 'error';
          item.label = res.error || `error ${xhr.status}`;
          queue.errors++;
        }
        resolve();
      };
      xhr.onerror = () => { item.status = 'error'; item.label = 'connection failed'; queue.errors++; resolve(); };
      xhr.send(item.file);
    });
  }

  $('file-input').addEventListener('change', e => { enqueue([...e.target.files]); e.target.value = ''; });

  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('drop').classList.toggle('over', !!e.target.closest?.('#drop'));
    document.querySelectorAll('[data-replace]').forEach(el => el.classList.toggle('over', el.contains(e.target)));
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    $('drop').classList.remove('over');
    const target = e.target.closest?.('[data-replace]');
    if (target) {
      target.classList.remove('over');
      const p = photoById(target.dataset.replace), f = e.dataTransfer.files[0];
      if (p && f) replaceFile(p, f);
      return;
    }
    if (e.target.closest?.('.main, .drop')) enqueue([...e.dataTransfer.files]);
  });

  // ---------- publish ----------

  $('publish-btn').addEventListener('click', () => {
    const g = S.git || {};
    const warn = !S.data.settings.siteUrl
      ? '<p class="help">Tip: fill in the public address in <b>Profile & settings</b> so shared links get a preview image.</p>' : '';
    if (!g.repo) {
      modal('This folder is not connected to GitHub yet', `<p class="help">See "Connect to GitHub" in the README (git init, remote, first push). After that everything happens here.</p>${g.error ? `<div class="log">${esc(g.error)}</div>` : ''}`, [['OK', 'primary']]);
      return;
    }
    const nd = draftCount();
    const run = confirmFirst => async () => {
        const btn = document.activeElement?.closest('#modal-actions button') || $('modal-actions').lastChild; // the one clicked
        btn.textContent = 'Publishing…';
        $('publish-btn').disabled = true;
        try {
          if (confirmFirst) await confirmDrafts(null, { quiet: true });
          const r = await api('POST', '/api/publish', { message: $('p-msg').value });
          S.git = r.status;
          renderGit();
          $('p-log').innerHTML = `<p><b>Done.</b> GitHub updates the site within about a minute.</p><div class="log">${esc(r.log)}</div>`;
          [...$('modal-actions').children].slice(1).forEach(b => b.remove()); // only "Close" stays
        } catch (e) {
          $('p-log').innerHTML = `<p style="color:var(--danger)"><b>Publishing failed.</b></p><div class="log">${esc(e.message)}</div>`;
          btn.textContent = 'Try again';
        } finally {
          $('publish-btn').disabled = false;
        }
        return 'keep';
      };
    modal('Publish to GitHub', `
      <div class="field"><label for="p-msg">Change description (optional)</label><input type="text" id="p-msg" placeholder="e.g. New photos from Tuscany"></div>
      <div id="p-changes" class="changes"><p class="help">Finding out what changes on the site…</p></div>
      ${warn}<div id="p-log"></div>`,
      nd ? [['Close', 'ghost'], ['Publish without drafts', '', run(false)], [`Confirm ${photosAcc(nd)} and publish`, 'primary', run(true)]]
         : [['Close', 'ghost'], ['Publish', 'primary', run(false)]]);
    loadChanges('publish');
  });

  // Preview of what the publish changes on the web, compared with GitHub's copy (/api/changes).
  // Drafts are listed apart: they only go along with "Confirm … and publish".
  // mode 'discard' lists the same changes as what gets thrown away (menu ⋯ → Discard my changes).
  function loadChanges(mode) {
    api('GET', '/api/changes').then(ch => renderChanges(ch, mode),
      e => { if ($('p-changes')) $('p-changes').innerHTML = `<p class="help">Could not work out the changes: ${esc(e.message)}</p>`; });
  }
  function renderChanges(ch, mode = 'publish') {
    const box = $('p-changes');
    if (!box) return; // dialog closed meanwhile
    const T = mode === 'discard'
      ? { added: 'New photos (will be deleted)', edited: 'Photo edits (reverted)', removed: 'Photos that come back to the site', cAdded: 'New collections (removed)', cEdited: 'Collection edits (reverted)', cRemoved: 'Collections that come back', order: 'Order (reverted)', settings: 'Settings (reverted)' }
      : { added: 'New photos', edited: 'Edited photos', removed: 'Leaving the site', cAdded: 'New collections', cEdited: 'Edited collections', cRemoved: 'Collections leaving the site', order: 'Changed order', settings: 'Settings' };
    const mini = id => { const p = photoById(id); return p ? `<button class="ch-thumb" data-goto="${p.id}" title="${esc(p.title || p.location || p.originalName)}" style="background:${p.color}"><img src="${thumbUrl(p, 300)}" alt="" loading="lazy"></button>` : ''; };
    const field = f => f.added || f.removed
      ? `<li><span class="ch-label">${esc(f.label)}:</span> ${[...f.added.map(t => `<ins>+ ${esc(t)}</ins>`), ...f.removed.map(t => `<del>− ${esc(t)}</del>`)].join(' ')}</li>`
      : 'from' in f
        ? `<li><span class="ch-label">${esc(f.label)}:</span> ${f.from ? `<del>${esc(f.from)}</del> → ` : ''}${f.to ? `<ins>${esc(f.to)}</ins>` : '<i>(cleared)</i>'}</li>`
        : `<li><span class="ch-label">${esc(f.label)}</span> changed</li>`;
    const section = (title, items, body) => items.length ? `<h3>${title} <span class="n">${items.length}</span></h3>${body}` : '';
    const names = list => `<p class="ch-names">${list.map(c => esc(c.label)).join(', ')}</p>`;
    const edited = list => `<ul class="ch-edited">${list.map(e => `<li>${e.id && photoById(e.id) ? mini(e.id) : ''}<div><b>${esc(e.label)}</b><ul>${e.fields.map(field).join('')}</ul></div></li>`).join('')}</ul>`;
    const drafts = mode === 'publish' ? photos().filter(p => p.draft) : [];
    const g = S.git || {};
    let html = ch.count ? '' : mode === 'discard'
      ? `<p class="help">${g.changes || g.ahead ? 'The gallery content does not change, only the regenerated site is discarded.' : 'You have no unpublished changes.'}</p>`
      : `<p class="help">${g.changes || g.ahead ? 'The gallery content does not change, only the regenerated site is sent.' : 'GitHub already has everything, nothing to send.'}</p>`;
    html += section(T.added, ch.photos.added, `<div class="ch-grid">${ch.photos.added.map(p => mini(p.id)).join('')}</div>`);
    html += section(T.edited, ch.photos.edited, edited(ch.photos.edited));
    html += section(T.removed, ch.photos.removed, `<div class="ch-grid">${ch.photos.removed.map(p => mini(p.id) || `<span class="ch-gone">${esc(p.label)}</span>`).join('')}</div>`);
    html += section(T.cAdded, ch.collections.added, names(ch.collections.added));
    html += section(T.cEdited, ch.collections.edited, edited(ch.collections.edited));
    html += section(T.cRemoved, ch.collections.removed, names(ch.collections.removed));
    html += section(T.order, ch.order, `<p class="ch-names">${ch.order.map(esc).join(', ')}</p>`);
    html += section(T.settings, ch.settings, `<ul class="ch-edited"><li><div><ul>${ch.settings.map(field).join('')}</ul></div></li></ul>`);
    if (drafts.length) html += `<h3>In drafts <span class="n">${drafts.length}</span></h3><p class="help">They go to GitHub only with <b>Confirm ${photosAcc(drafts.length)} and publish</b>.</p><div class="ch-grid is-draft">${drafts.map(p => mini(p.id)).join('')}</div>`;
    box.innerHTML = html;
  }
  // A thumbnail in the preview opens that photo in the panel (the dialog closes).
  $('modal').addEventListener('click', e => {
    const t = e.target.closest('[data-goto]');
    if (!t) return;
    $('modal').hidden = true;
    setFilter('all');
    S.selected.add(t.dataset.goto);
    renderAll();
    document.querySelector(`#thumbs .thumb[data-id="${t.dataset.goto}"]`)?.scrollIntoView({ block: 'center' });
  });

  // ---------- menu ⋯: pull latest, discard my changes ----------

  const gitMenu = open => {
    $('git-menu').hidden = !open;
    $('git-menu-btn').setAttribute('aria-expanded', String(open));
  };
  $('git-menu-btn').addEventListener('click', e => { e.stopPropagation(); gitMenu($('git-menu').hidden); });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) gitMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') gitMenu(false); });
  $('git-menu').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    gitMenu(false);
    if (act === 'pull') syncNow();
    if (act === 'discard') discardDialog();
  });

  function discardDialog() {
    if (!S.git?.repo) return fail(new Error('This folder is not connected to GitHub.'));
    modal('Discard my changes?', `
      <p>Everything from this copy that is not on GitHub yet is thrown away, and the gallery returns to the state GitHub has now (including what another copy published meanwhile).
      <b>Drafts stay.</b> The discarded state is kept as a backup in git on this computer (never sent to GitHub).</p>
      <div id="p-changes" class="changes"><p class="help">Finding out what gets discarded…</p></div>`,
      [['Cancel', 'ghost'], ['Discard changes', 'danger-fill', async () => {
        saving(true);
        try {
          const r = await api('POST', '/api/discard', {});
          const st = await api('GET', '/api/state');
          S.data = st.data; S.git = st.git;
          S.selected.clear();
          renderAll();
          toast(r.discarded ? 'Changes discarded, the gallery matches GitHub.' : 'Nothing to discard.');
        } catch (e) { fail(e); refreshGitSoon(0); }
        finally { saving(false); }
      }]]);
    $('modal-actions').firstChild.focus(); // the safe choice is the default one
    loadChanges('discard');
  }

  // ---------- drafts ----------

  function renderConfirm() {
    const n = draftCount();
    $('confirm-btn').hidden = !n;
    $('n-confirm').textContent = n;
  }
  $('confirm-btn').addEventListener('click', () => confirmDrafts(null));

  // Publish drafts (all when ids is null). Files move into docs/; GitHub gets them with Publish.
  async function confirmDrafts(ids, { quiet = false } = {}) {
    saving(true);
    try {
      const r = await api('POST', '/api/drafts/publish', ids ? { ids } : {});
      for (const u of r.photos) { const p = photoById(u.id); if (p) { Object.assign(p, u); delete p.draft; } }
      if (!quiet) toast(`Published: ${photosLabel(r.published)}. Publish sends them to GitHub.`);
      renderAll(); refreshGitSoon();
    } catch (e) { fail(e); if (quiet) throw e; }
    finally { saving(false); }
  }

  function unpublish(ids) {
    modal(`Move ${photosLabel(ids.length)} back to drafts?`,
      '<p>They leave the site and the next publish. <b>The version already on GitHub stays in the git history</b>, and anyone who knows where to look can find it.</p>',
      [['Cancel', 'ghost'], ['Back to drafts', 'primary', async () => {
        try {
          const r = await api('POST', '/api/photos/unpublish', { ids });
          for (const u of r.photos) Object.assign(photoById(u.id) || {}, u, { draft: true });
          for (const c of S.data.collections) if (Array.isArray(c.order)) c.order = c.order.filter(id => !ids.includes(id));
          if (Array.isArray(S.data.settings.order)) S.data.settings.order = S.data.settings.order.filter(id => !ids.includes(id));
          toast('Moved back to drafts'); renderAll(); refreshGitSoon();
        } catch (e) { fail(e); }
      }]]);
  }

  // ---------- boot ----------

  api('GET', '/api/state').then(r => {
    S.data = r.data;
    S.git = r.git;
    S.image = r.image;
    S.locale = r.locale;
    renderAll();
    checkGitHub();
  }).catch(fail);
})();

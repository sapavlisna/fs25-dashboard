// Shared cross-page setup: notification button + modal, WebSocket helper.
// Each page calls FS25App.connect(onData) — single dispatch point for WS.

(function () {
    // ─── Notification button + modal injection ───────────────────────────────

    const THEMES = [
        { id: 'dark-green',    label: 'Tmavě zelená',     icon: '🌿' },
        { id: 'dark-blue',     label: 'Tmavě modrá',      icon: '🌙' },
        { id: 'light',         label: 'Světlá',           icon: '☀️' },
        { id: 'high-contrast', label: 'Vysoký kontrast',  icon: '◐' },
        { id: 'fs25-native',   label: 'FS25 Native',      icon: '🚜' },
    ];
    const THEME_KEY = 'fs25.dash.v1.theme';

    // Dashboard sections — id matches the .section element on index.html. The
    // labels are static so the settings tab works on any page (when user
    // toggles a section while on /history, the change applies when they
    // navigate back to the dashboard).
    const DASHBOARD_SECTIONS = [
        { id: 'sec-fields',      label: '🌱 Pole – přehled' },
        { id: 'sec-vehicles',    label: '🚜 Vozidla' },
        { id: 'sec-animals',     label: '🐄 Zvířata' },
        { id: 'sec-storage',     label: '📦 Sklady' },
        { id: 'sec-productions', label: '🏭 Výrobny' },
        { id: 'sec-prices',      label: '💰 Výkupní ceny' },
    ];

    let _gearClicks = 0;

    function injectNotifUI() {
        const status = document.querySelector('.nav-status');
        if (!status) return;

        const s = window.Notifier ? window.Notifier.getSettings() : { enabled: false };
        const btn = document.createElement('button');
        btn.id = 'notif-toggle';
        btn.className = 'notif-btn' + (s.enabled ? ' on' : '');
        btn.textContent = '⚙';
        btn.title = 'Nastavení';
        btn.onclick = openNotifModal;
        status.appendChild(btn);

        // Modal HTML — tabbed sections for different setting groups.
        const themeButtons = THEMES.map(t =>
            `<button type="button" class="theme-card" data-theme-id="${t.id}"><span class="theme-card-icon">${t.icon}</span><span>${t.label}</span></button>`
        ).join('');

        const overlay = document.createElement('div');
        overlay.id = 'notif-modal-overlay';
        overlay.innerHTML = `
            <div id="notif-modal">
                <button class="settings-close" id="nt-close" type="button" aria-label="Zavřít" title="Zavřít">×</button>
                <h3><span id="settings-gear-icon" style="cursor:default;user-select:none">⚙</span> Nastavení</h3>
                <nav class="settings-tabs" id="settings-tabs">
                    <button type="button" data-tab="notif" class="active">🔔 Notifikace</button>
                    <button type="button" data-tab="sections">📋 Sekce</button>
                    <button type="button" data-tab="theme">🎨 Vzhled</button>
                    <button type="button" data-tab="sync">☁ Sync</button>
                    <button type="button" data-tab="diag" hidden>🐞 Diagnostika</button>
                </nav>

                <div class="settings-panels">
                <section class="settings-panel" data-panel="notif">
                    <div class="switch">
                        <input type="checkbox" id="nt-enabled">
                        <label for="nt-enabled" style="margin:0;color:var(--text)">Zapnout notifikace</label>
                    </div>

                    <label>Krmivo zvířat – varovat pod (%)</label>
                    <input type="number" id="nt-animal" min="0" max="100" step="5">

                    <label>Palivo vozidel – varovat pod (%)</label>
                    <input type="number" id="nt-fuel" min="0" max="100" step="5">

                    <label>Prázdné pole – varovat po (dnech)</label>
                    <input type="number" id="nt-empty" min="0" max="60" step="1">

                    <label>Cooldown (minut, mezi opakovanými upozorněními)</label>
                    <input type="number" id="nt-cooldown" min="1" max="1440" step="5">
                </section>

                <section class="settings-panel" data-panel="sections" hidden>
                    <label style="margin-bottom:8px;display:block">Sekce hlavního dashboardu</label>
                    <p class="settings-hint">
                        Přetáhni řádek pro změnu pořadí.
                        Přepínač vpravo skrývá/zobrazuje sekci.
                    </p>
                    <div class="section-list" id="section-list" data-tt-dnd-container="sections"></div>
                    <div class="section-reset-row">
                        <button class="secondary" id="sec-reset-order" type="button"
                                title="Vrátí výchozí pořadí, viditelnost zůstane">↺ Obnovit pořadí</button>
                        <button class="danger" id="sec-reset-all" type="button"
                                title="Zruší pořadí i to, co jsi skryl">Resetovat vše</button>
                    </div>
                </section>

                <section class="settings-panel" data-panel="theme" hidden>
                    <label style="margin-bottom:8px;display:block">Jazyk</label>
                    <select id="lang-select" class="lang-select"></select>
                    <p class="settings-hint" style="margin:4px 0 14px">
                        Přepne celé rozhraní; stránka se po změně načte znovu.
                        Synchronizuje se na ostatní zařízení.
                    </p>
                    <label style="margin-bottom:8px;display:block">Téma vzhledu</label>
                    <div class="theme-grid">${themeButtons}</div>
                </section>

                <section class="settings-panel" data-panel="sync" hidden>
                    <label style="margin-bottom:8px;display:block">Synchronizace se serverem</label>
                    <p class="settings-hint">
                        Téma, pořadí sekcí, skryté položky a další nastavení se ukládají na server.
                        Když si dashboard otevřeš na jiném zařízení (mobil, druhý počítač), uvidíš stejné rozložení.
                        Při změně na jednom zařízení se ostatní automaticky aktualizují.
                    </p>
                    <label class="section-row" style="cursor:default">
                        <span class="section-row-label">Synchronizovat s serverem</span>
                        <span class="section-row-toggle">
                            <input type="checkbox" id="sync-enabled">
                            <span class="switch-knob"></span>
                        </span>
                    </label>
                    <p class="settings-hint" style="margin-top:10px">
                        Pokud vypneš, toto zařízení bude mít vlastní lokální layout. Změny se nebudou propisovat
                        na ostatní zařízení (ani naopak).
                    </p>
                    <div class="section-reset-row">
                        <button class="secondary" id="sync-pull" type="button"
                                title="Stáhne aktuální nastavení ze serveru a přepíše lokální">↺ Načíst ze serveru</button>
                    </div>
                </section>

                <section class="settings-panel" data-panel="diag" hidden>
                    <label style="margin-bottom:8px;display:block">Diagnostický záznam</label>
                    <p class="settings-hint">
                        Když narazíš na chybu: spusť nahrávání, zopakuj co se dělo a zastav ho.
                        Vznikne jeden soubor (data + chyby prohlížeče + tvoje nastavení), který
                        stáhneš a pošleš. Drží se posledních ~1000 snímků.
                    </p>
                    <label for="diag-note">Co se stalo?</label>
                    <input type="text" id="diag-note" maxlength="200"
                           placeholder="např. špatně se zobrazují výrobny">
                    <div class="section-reset-row" style="margin-top:10px;align-items:center">
                        <button class="primary" id="diag-record-btn" type="button">● Spustit nahrávání</button>
                        <button class="secondary" id="diag-mark" type="button"
                                title="Vloží do záznamu značku „tady to nastalo“">⚑ Označit</button>
                        <span id="diag-record-status" style="font-size:12px;color:var(--muted);margin-left:auto"></span>
                    </div>
                    <div class="section-reset-row" style="margin-top:8px;align-items:center">
                        <button class="secondary" id="diag-save-buffer" type="button"
                                title="Uloží posledních pár minut, i když jsi nahrávání nezapnul předem">💾 Uložit poslední snímky zpětně</button>
                        <span id="diag-buffer-info" style="font-size:11px;color:var(--muted);margin-left:auto"></span>
                    </div>
                    <div id="diag-mockup-tools">
                        <label class="section-row" style="cursor:default;margin-top:14px">
                            <span class="section-row-label">Mockup režim (zobrazit ovládání přehrávání)</span>
                            <span class="section-row-toggle">
                                <input type="checkbox" id="diag-mockup-toggle">
                                <span class="switch-knob"></span>
                            </span>
                        </label>
                        <p class="settings-hint">
                            <strong>Mockup režim.</strong> Načti záznam (třeba od kamaráda) a přehraj
                            ho jako živá data — server poběží z něj místo ze hry.
                            Vypnutím přepínače ovládání zase schováš.
                        </p>
                        <div class="section-reset-row" style="margin-bottom:6px">
                            <label class="secondary diag-upload-btn">📂 Načíst soubory
                                <input type="file" id="diag-upload-files" accept=".jsonl" multiple hidden>
                            </label>
                            <label class="secondary diag-upload-btn">🗂 Načíst složku
                                <input type="file" id="diag-upload-dir" webkitdirectory hidden>
                            </label>
                        </div>
                        <label class="section-row" style="cursor:default">
                            <span class="section-row-label">🔁 Přehrávat ve smyčce (jinak jen jednou)</span>
                            <span class="section-row-toggle">
                                <input type="checkbox" id="diag-replay-loop">
                                <span class="switch-knob"></span>
                            </span>
                        </label>
                    </div>
                    <label style="margin:16px 0 6px;display:block">Uložené záznamy</label>
                    <div id="diag-list" class="diag-list"></div>
                </section>
                </div>

                <div id="nt-status" style="font-size:11px;color:var(--muted);margin-top:10px"></div>
                <div class="row settings-actions">
                    <button class="secondary" id="nt-test" data-only-tab="notif">Test notifikace</button>
                    <button class="primary"   id="nt-save" style="margin-left:auto">Uložit</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeNotifModal();
        });
        document.getElementById('nt-close').onclick = closeNotifModal;
        document.getElementById('nt-save').onclick  = saveNotifSettings;
        document.getElementById('nt-test').onclick  = testNotif;

        // Hidden diagnostics unlock — click the ⚙ inside the modal 4×.
        // Counter resets when the modal is closed (see closeNotifModal).
        document.getElementById('settings-gear-icon').addEventListener('click', () => {
            if (++_gearClicks >= 4) {
                const diagTab = document.querySelector('[data-tab="diag"]');
                if (diagTab) diagTab.hidden = false;
            }
        });

        // Tab switching
        document.getElementById('settings-tabs').addEventListener('click', e => {
            const t = e.target.closest('[data-tab]');
            if (!t) return;
            const tab = t.dataset.tab;
            document.querySelectorAll('#settings-tabs [data-tab]').forEach(b =>
                b.classList.toggle('active', b === t));
            document.querySelectorAll('.settings-panel').forEach(p =>
                p.hidden = (p.dataset.panel !== tab));
            // Hide notif-only action buttons on other tabs
            document.querySelectorAll('[data-only-tab]').forEach(b =>
                b.hidden = (b.dataset.onlyTab !== tab));
            // Diagnostics tab: refresh status + list on enter (status also pushed via WS).
            if (tab === 'diag') diagRefresh();
        });

        // Theme picker — clicking a card applies + persists immediately
        document.querySelectorAll('[data-theme-id]').forEach(card => {
            card.onclick = () => applyTheme(card.dataset.themeId);
        });

        // Sekce panel — toggles persist in DashState.hiddenSections, the
        // drag-reorder uses TableTools 'sections' scope (same one the main
        // dashboard reads). The two stay in sync because both read from the
        // same localStorage keys.
        renderSectionList();
        document.getElementById('section-list').addEventListener('change', e => {
            const cb = e.target.closest('input[data-section-id]');
            if (!cb) return;
            toggleSection(cb.dataset.sectionId, !cb.checked);
        });
        // Wire reset buttons
        const btnOrder = document.getElementById('sec-reset-order');
        const btnAll   = document.getElementById('sec-reset-all');
        if (btnOrder) btnOrder.onclick = () => {
            if (window.TableTools) TableTools.clearOrder('sections');
            renderSectionList();
            if (typeof window.applySectionOrder === 'function') window.applySectionOrder();
        };
        if (btnAll) btnAll.onclick = () => {
            if (!confirm('Opravdu zrušit pořadí i viditelnost sekcí?')) return;
            if (window.TableTools) TableTools.clearOrder('sections');
            if (window.DashState) window.DashState.set(window.DashState.KEYS.hiddenSections, []);
            renderSectionList();
            if (typeof window.applySectionOrder === 'function') window.applySectionOrder();
            if (typeof window.applyHiddenSections === 'function') window.applyHiddenSections();
        };
        // After a drag inside this panel, write the new order under the same
        // 'sections' scope key the main dashboard reads, then re-render the
        // panel (so the visible order stays in sync) and re-apply on the
        // dashboard if it's currently shown.
        if (window.TableTools) {
            TableTools.onChange('sections', () => {
                renderSectionList();
                if (typeof window.applySectionOrder === 'function') window.applySectionOrder();
            });
        }

        // Sync panel — toggle + manual pull from server.
        const syncCb   = document.getElementById('sync-enabled');
        const syncPull = document.getElementById('sync-pull');
        if (syncCb && window.ServerSync) {
            syncCb.checked = window.ServerSync.isEnabled();
            syncCb.onchange = () => window.ServerSync.setEnabled(syncCb.checked);
        }
        if (syncPull && window.ServerSync) {
            syncPull.onclick = async () => {
                syncPull.disabled = true;
                syncPull.textContent = 'Načítám…';
                await window.ServerSync.pullFromServer({ force: true });
                syncPull.textContent = '✓ Načteno';
                setTimeout(() => {
                    syncPull.disabled = false;
                    syncPull.textContent = '↺ Načíst ze serveru';
                }, 1500);
            };
        }

        // ─── Appearance panel — language selector ─────────────────────────
        const langSel = document.getElementById('lang-select');
        if (langSel && window.I18n) {
            langSel.innerHTML = window.I18n.AVAILABLE
                .map(l => `<option value="${l.id}">${l.flag} ${l.label}</option>`).join('');
            langSel.value = window.I18n.getLang();
            langSel.onchange = () => window.I18n.setLang(langSel.value);  // setLang reloads the page
        }

        // ─── Diagnostics panel — record / list / download ─────────────────
        wireDiagPanel();
    }

    function renderSectionList() {
        const wrap = document.getElementById('section-list');
        if (!wrap) return;
        const hidden = new Set(window.DashState
            ? (window.DashState.get(window.DashState.KEYS.hiddenSections, []) || [])
            : []);
        // Apply saved drag-order so the panel mirrors the dashboard layout.
        const ordered = window.TableTools
            ? TableTools.applyOrder(DASHBOARD_SECTIONS, 'sections', s => s.id.replace(/^sec-/, ''))
            : DASHBOARD_SECTIONS;
        wrap.innerHTML = ordered.map(s => {
            const checked = !hidden.has(s.id);
            // ttKey matches the data-tt-key on the corresponding .section in
            // index.html (e.g. sec-fields → ttKey="fields"). That's what gets
            // saved by Sortable to the 'sections' order key.
            const ttKey = s.id.replace(/^sec-/, '');
            return `<div class="section-row" data-tt-dnd="sections" data-tt-key="${ttKey}">
                <span class="drag-handle" title="Přetáhni pro změnu pořadí" aria-label="Přesunout">⠿</span>
                <span class="section-row-label">${s.label}</span>
                <label class="section-row-toggle">
                    <input type="checkbox" data-section-id="${s.id}"${checked ? ' checked' : ''}>
                    <span class="switch-knob"></span>
                </label>
            </div>`;
        }).join('');
    }

    function toggleSection(sectionId, hide) {
        if (!window.DashState) return;
        const key = window.DashState.KEYS.hiddenSections;
        const arr = window.DashState.get(key, []) || [];
        const set = new Set(arr);
        if (hide) set.add(sectionId); else set.delete(sectionId);
        window.DashState.set(key, [...set]);
        // If we're on the main dashboard, apply immediately
        if (typeof window.applyHiddenSections === 'function') window.applyHiddenSections();
    }

    function applyTheme(id) {
        document.documentElement.setAttribute('data-theme', id);
        try { localStorage.setItem(THEME_KEY, id); } catch (_) {}
        if (window.ServerSync) window.ServerSync.syncWrite('theme', id);
        // Keep the standalone theme-picker (cycle button) icon + tooltip in sync
        const picker = document.getElementById('theme-picker');
        if (picker) {
            const t = THEMES.find(x => x.id === id);
            picker.textContent = (t && t.icon) || '🎨';
            picker.title = 'Téma: ' + (t ? t.label : id) + ' (kliknutím další)';
        }
        document.querySelectorAll('[data-theme-id]').forEach(card =>
            card.classList.toggle('active', card.dataset.themeId === id));
    }

    // ─── Diagnostics panel logic ─────────────────────────────────────────────
    // Talks to the server's /diag/* REST endpoints (recorder.js). Recording
    // state is PUSHED over the WS (__recordStatus) — never polled — so the
    // button can't get stuck on a stale cached status.

    function tr(cs, params) { return window.t ? window.t(cs, params) : cs; }

    function diagEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function diagFmtSize(b) {
        if (!b) return '0 kB';
        return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB';
    }

    async function diagApi(method, url, body) {
        const opt = { method, cache: 'no-store' };   // never serve a stale status from cache
        if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
        try {
            const r = await fetch(url, opt);
            return await r.json();
        } catch (_) {
            return null;          // transient failure — callers keep current UI, don't revert
        }
    }

    function diagSetRecording(active, info) {
        const btn    = document.getElementById('diag-record-btn');
        const note   = document.getElementById('diag-note');
        const status = document.getElementById('diag-record-status');
        if (!btn) return;
        if (active) {
            btn.textContent = tr('■ Zastavit nahrávání');
            btn.classList.remove('primary'); btn.classList.add('danger');
            if (note) note.disabled = true;
            if (status) status.textContent = tr('Nahrávám… {n} snímků', { n: (info && info.frames) || 0 });
        } else {
            btn.textContent = tr('● Spustit nahrávání');
            btn.classList.remove('danger'); btn.classList.add('primary');
            if (note) note.disabled = false;
            if (status) status.textContent = '';
        }
    }

    // Apply a record-status object (from the WS push or a one-shot GET) to the UI.
    function diagApplyRecordStatus(st) {
        if (!st) return;
        diagSetRecording(!!st.active, st);
        const info = document.getElementById('diag-buffer-info');
        if (info) info.textContent = tr('V bufferu: {n} snímků', { n: st.buffered || 0 });
    }

    async function diagRefreshStatus() {
        const st = await diagApi('GET', '/diag/record/status');
        diagApplyRecordStatus(st);            // null (transient) → no-op, UI kept
        return st;
    }

    async function diagRefreshList() {
        const wrap = document.getElementById('diag-list');
        if (!wrap) return;
        const recs = await diagApi('GET', '/diag/recordings');
        if (!recs) return;                    // transient failure — keep the current list
        if (!Array.isArray(recs) || !recs.length) {
            wrap.innerHTML = `<p class="settings-hint">${tr('Zatím žádné záznamy.')}</p>`;
            return;
        }
        wrap.innerHTML = recs.map(r => {
            const when = r.startedAt ? new Date(r.startedAt).toLocaleString() : r.name;
            const errBadge = r.clientErrors ? ` · <span class="diag-err">⚠ ${r.clientErrors} ${tr('chyb')}</span>` : '';
            const modS = r.modVersion ? ` · mod ${diagEsc(r.modVersion)}` : '';
            const retro = r.retroactive ? ' · ⏪' : '';
            const meta = `${r.frames != null ? r.frames : '?'} ${tr('snímků')} · ${diagFmtSize(r.sizeBytes)}${errBadge}${modS}${retro}`;
            const note = r.note ? `<span class="diag-note-txt">${diagEsc(r.note)}</span>` : '';
            const dot  = r.active ? ' <span class="diag-rec-dot" title="' + tr('Nahrává se') + '">⏺</span>' : '';
            return `<div class="diag-row" data-name="${diagEsc(r.name)}">
                <div class="diag-row-main">
                    <span class="diag-row-when">${diagEsc(when)}${dot}</span>
                    ${note}
                    <span class="diag-row-meta">${meta}</span>
                </div>
                <button class="primary diag-play" type="button" title="${tr('Přehrát jako živá data')}">▶</button>
                <a class="secondary diag-dl" href="/diag/recordings/${encodeURIComponent(r.name)}" download title="${tr('Stáhnout')}">⬇</a>
                <button class="danger diag-del" type="button" title="${tr('Smazat')}">×</button>
            </div>`;
        }).join('');
    }

    // Record status is PUSHED over the WS (__recordStatus), so no polling here.
    // A one-shot refresh just seeds the panel when it opens.
    async function diagRefresh() {
        await diagRefreshStatus();
        await diagRefreshList();
    }

    function wireDiagPanel() {
        const btn  = document.getElementById('diag-record-btn');
        const note = document.getElementById('diag-note');
        const list = document.getElementById('diag-list');
        if (btn) {
            btn.onclick = async () => {
                const st = await diagApi('GET', '/diag/record/status');
                if (st && st.active) {
                    diagSetRecording(false);                       // optimistic; WS push confirms
                    await diagApi('POST', '/diag/record/stop');
                } else {
                    diagSetRecording(true, { frames: 0 });         // optimistic; WS push confirms
                    await diagApi('POST', '/diag/record/start', {
                        note: note ? note.value : '',
                        lang: window.I18n ? window.I18n.getLang() : 'cs',
                    });
                }
                await diagRefreshList();
            };
        }
        if (list) {
            list.addEventListener('click', async (e) => {
                const row = e.target.closest('.diag-row');
                const name = row && row.dataset.name;
                if (!name) return;
                if (e.target.closest('.diag-play')) {
                    await diagApi('POST', '/diag/replay/start', { name, loop: diagReplayLoop() });
                    return;
                }
                if (e.target.closest('.diag-del')) {
                    if (!confirm(tr('Smazat tento záznam?'))) return;
                    await diagApi('DELETE', '/diag/recordings/' + encodeURIComponent(name));
                    await diagRefreshList();
                }
            });
        }

        // ─── Mockup mode — upload recording(s) to replay ──────────────────
        async function uploadFileList(fileList) {
            const files = Array.from(fileList || []).filter(f => /\.jsonl$/i.test(f.name));
            if (!files.length) { alert(tr('Nenašel jsem žádný .jsonl soubor.')); return; }
            for (const f of files) {
                let text = '';
                try { text = await f.text(); } catch (_) { continue; }
                await fetch('/diag/replay/upload?name=' + encodeURIComponent(f.name), {
                    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text,
                });
            }
            await diagRefreshList();
        }
        const upFiles = document.getElementById('diag-upload-files');
        const upDir   = document.getElementById('diag-upload-dir');
        if (upFiles) upFiles.onchange = () => { uploadFileList(upFiles.files); upFiles.value = ''; };
        if (upDir)   upDir.onchange   = () => { uploadFileList(upDir.files);   upDir.value = ''; };

        // Mockup-mode on/off switch (itself only visible while mockup mode is on).
        const mockupToggle = document.getElementById('diag-mockup-toggle');
        if (mockupToggle) {
            mockupToggle.checked = isMockup();
            mockupToggle.onchange = () => setMockup(mockupToggle.checked);
        }

        // Flag the current moment.
        const markBtn = document.getElementById('diag-mark');
        if (markBtn) markBtn.onclick = async () => {
            await diagApi('POST', '/diag/record/marker', { label: '' });
            markBtn.textContent = tr('⚑ Označeno');
            setTimeout(() => { markBtn.textContent = tr('⚑ Označit'); }, 1200);
        };

        // Retroactive capture — save the always-on rolling buffer.
        const saveBuf = document.getElementById('diag-save-buffer');
        if (saveBuf) saveBuf.onclick = async () => {
            await diagApi('POST', '/diag/record/save-buffer', {
                note: note ? note.value : '',
                lang: window.I18n ? window.I18n.getLang() : 'cs',
            });
            await diagRefreshList();
        };
    }

    async function openNotifModal() {
        const s = window.Notifier.getSettings();
        document.getElementById('nt-enabled').checked  = s.enabled;
        document.getElementById('nt-animal').value     = s.animalFood;
        document.getElementById('nt-fuel').value       = s.vehicleFuel;
        document.getElementById('nt-empty').value      = s.emptyFieldDays;
        document.getElementById('nt-cooldown').value   = s.cooldownMinutes;

        const status = document.getElementById('nt-status');
        if (Notification.permission === 'granted') status.textContent = '✓ Povolení uděleno';
        else if (Notification.permission === 'denied') status.textContent = '✗ Notifikace zablokovány v prohlížeči';
        else status.textContent = '⚠ Klikni "Uložit" – prohlížeč se zeptá na povolení';

        // Highlight the current theme card
        const curTheme = document.documentElement.getAttribute('data-theme') || 'dark-green';
        document.querySelectorAll('[data-theme-id]').forEach(card =>
            card.classList.toggle('active', card.dataset.themeId === curTheme));

        document.getElementById('notif-modal-overlay').classList.add('open');
    }
    function closeNotifModal() {
        document.getElementById('notif-modal-overlay').classList.remove('open');
        _gearClicks = 0;
    }

    async function saveNotifSettings() {
        const enabled = document.getElementById('nt-enabled').checked;
        if (enabled) {
            const ok = await window.Notifier.requestPermission();
            if (!ok) return;
        }
        window.Notifier.saveSettings({
            enabled,
            animalFood:     parseInt(document.getElementById('nt-animal').value)    || 25,
            vehicleFuel:    parseInt(document.getElementById('nt-fuel').value)      || 20,
            emptyFieldDays: parseInt(document.getElementById('nt-empty').value)     || 5,
            cooldownMinutes: parseInt(document.getElementById('nt-cooldown').value) || 60,
        });
        document.getElementById('notif-toggle').classList.toggle('on', enabled);
        closeNotifModal();
    }

    async function testNotif() {
        const ok = await window.Notifier.requestPermission();
        if (!ok) return;
        new Notification('FS25 Dashboard – test', {
            body: 'Notifikace fungují ✓',
            tag: 'test',
        });
    }

    // ─── WebSocket connect (single shared logic) ──────────────────────────────

    let lastData = null;
    let onDataCb = null;

    function connect(onData) {
        const dot     = document.getElementById('ws-dot');
        const wsLabel = document.getElementById('ws-label');
        let ws, reconnectTimer;
        onDataCb = onData;

        function open() {
            ws = new WebSocket(`ws://${location.host}`);
            // Expose the live socket so the smoke suite can drive a disconnect
            // (window.__ws.close()) — there's no server endpoint to force one.
            window.__ws = ws;
            ws.onopen = () => {
                dot.className = 'dot live';
                wsLabel.textContent = 'Live';
                clearTimeout(reconnectTimer);
            };
            ws.onmessage = e => {
                try {
                    const data = JSON.parse(e.data);
                    // Settings sync envelope — handled by ServerSync; not a
                    // real game-data payload, so short-circuit before the
                    // regular renderers run.
                    if (window.ServerSync && window.ServerSync.handleWsMessage(data)) return;
                    // Mockup/replay state envelope — drives the banner, not a payload.
                    if (data.__replayStatus) { updateReplayBanner(data.__replayStatus); return; }
                    // Recording state envelope — pushed, drives the record button.
                    if (data.__recordStatus) { diagApplyRecordStatus(data.__recordStatus); return; }
                    if (window.CropIcons && Array.isArray(data.availableFruits)) {
                        window.CropIcons.setCatalog(data.availableFruits);
                    }
                    if (window.FS25Money && data.currency) FS25Money.setCurrency(data.currency);
                    if (data.saveMeta) updateSaveMeta(data.saveMeta);
                    if (window.Notifier) window.Notifier.process(data);
                    if (window.FS25Bell) window.FS25Bell.update(data);
                    lastData = data;
                    onData && onData(data);
                    if (inspectorOpen) refreshInspector();
                } catch (_) {}
            };
            ws.onclose = ws.onerror = () => {
                dot.className = 'dot error';
                wsLabel.textContent = 'Odpojeno – reconnect za 5s…';
                reconnectTimer = setTimeout(open, 5000);
            };
        }

        open();
    }

    // Re-run the page's render callback against the last received payload —
    // used when a settings toggle (e.g. "show empty implements") needs to
    // refresh the UI without waiting for the next WS tick.
    function rerender() {
        if (lastData && onDataCb) onDataCb(lastData);
    }

    // ─── Save metadata in nav ─────────────────────────────────────────────────
    // The server reads careerSavegame.xml and includes { name, mapTitle, ... }
    // in every WS payload. We render "<savename> · <map>" right of the brand
    // so the player can see at a glance which save they're looking at.

    function updateSaveMeta(meta) {
        const brand = document.querySelector('.nav-brand');
        if (!brand) return;
        let el = document.getElementById('nav-save');
        if (!el) {
            el = document.createElement('span');
            el.id = 'nav-save';
            el.className = 'nav-save';
            brand.insertAdjacentElement('afterend', el);
        }
        const name = meta.name || '';
        const map  = meta.mapTitle || '';
        el.textContent = name && map ? `${name} · ${map}` : (name || map);
        if (meta.saveDateFormatted) el.title = 'Uloženo ' + meta.saveDateFormatted;
    }

    // ─── Server version badge in nav ─────────────────────────────────────────
    // /api/version returns { server, schema, mod: { schemaVersion, modVersion } }.
    // We surface this as a small "v1.1.2" tag next to the brand, with a
    // tooltip showing the matching mod version once it's been seen.

    async function showServerVersion() {
        const brand = document.querySelector('.nav-brand');
        if (!brand) return;
        let el = document.getElementById('nav-version');
        if (!el) {
            el = document.createElement('span');
            el.id = 'nav-version';
            el.className = 'nav-version';
            brand.insertAdjacentElement('afterend', el);
        }
        try {
            const v = await fetch('/api/version').then(r => r.json());
            const srv = v.server || '?';
            const mod = (v.mod && (v.mod.modVersion || v.mod.schemaVersion))
                ? `mod ${v.mod.modVersion || '?'}`
                : 'mod není připojen';
            el.textContent = `v${srv}`;
            el.title = `server v${srv} · ${mod}`;
        } catch (e) {
            el.textContent = 'v?';
            el.title = 'verze serveru se nepodařilo načíst: ' + e.message;
        }
    }

    // ─── Mockup mode (hidden) + replay banner ─────────────────────────────────
    // A hidden gesture (10× click the brand) flips this page into "mockup mode",
    // which reveals the diag panel's upload/replay controls. State is per-tab
    // (sessionStorage) so it never leaks into a normal session or syncs.

    const MOCKUP_KEY = 'fs25.dash.mockup';
    let currentReplayName = null;   // name of the recording currently playing (for restart)

    function diagReplayLoop() {
        const cb = document.getElementById('diag-replay-loop');
        return !!(cb && cb.checked);
    }
    function isMockup() {
        try { return sessionStorage.getItem(MOCKUP_KEY) === '1'; } catch (_) { return false; }
    }
    function applyMockupMode() {
        document.body.classList.toggle('mockup-mode', isMockup());
    }
    function setMockup(on) {
        try { on ? sessionStorage.setItem(MOCKUP_KEY, '1') : sessionStorage.removeItem(MOCKUP_KEY); } catch (_) {}
        applyMockupMode();
        const cb = document.getElementById('diag-mockup-toggle');
        if (cb) cb.checked = isMockup();
    }
    function disableMockup() { setMockup(false); }
    function enableMockup() {
        setMockup(true);
        // Mockup mode is a dev tool — reveal the (normally hidden) Diagnostics
        // tab so its controls are reachable, then jump straight to it.
        openNotifModal();
        const dt = document.querySelector('[data-tab="diag"]');
        if (dt) { dt.hidden = false; dt.click(); }
        alert(tr('Mockup režim zapnut. V Nastavení → 🐞 Diagnostika ho zase vypneš přepínačem.'));
    }
    function wireMockupGesture() {
        const brand = document.querySelector('.nav-brand');
        if (!brand) return;
        let clicks = 0, timer = null;
        brand.style.cursor = 'default';
        brand.addEventListener('click', () => {
            if (isMockup()) return;
            clicks++;
            clearTimeout(timer);
            timer = setTimeout(() => { clicks = 0; }, 1500);
            if (clicks >= 10) { clicks = 0; enableMockup(); }
        });
    }

    let lastReplayStatus = null;
    function replayPost(path, body) {
        fetch(path, {
            method:  'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body:    body ? JSON.stringify(body) : undefined,
        }).catch(() => {});
    }

    function injectReplayBanner() {
        if (document.getElementById('replay-banner')) return;
        const bar = document.createElement('div');
        bar.id = 'replay-banner';
        bar.hidden = true;
        bar.innerHTML =
            '<span class="replay-banner-txt"></span>' +
            '<span class="replay-ctl">' +
              '<button type="button" id="rp-restart" title="Od začátku">↺</button>' +
              '<button type="button" id="rp-back" title="O snímek zpět">◀</button>' +
              '<button type="button" id="rp-play" title="Přehrát/Pauza">⏸</button>' +
              '<button type="button" id="rp-fwd" title="O snímek vpřed">▶</button>' +
              '<input type="range" id="rp-seek" min="0" max="0" value="0" list="rp-marks" aria-label="Pozice přehrávání">' +
              '<datalist id="rp-marks"></datalist>' +
              '<span id="rp-count" class="replay-count">0/0</span>' +
              '<button type="button" id="rp-mark" title="Skočit na další značku">⚑</button>' +
              '<button type="button" id="rp-inspect" title="Inspektor snímku">{ }</button>' +
            '</span>' +
            '<button type="button" id="replay-banner-stop" class="replay-banner-stop"></button>';
        document.body.appendChild(bar);

        bar.querySelector('#replay-banner-stop').onclick = () => replayPost('/diag/replay/stop');
        bar.querySelector('#rp-restart').onclick = () => {
            if (currentReplayName) replayPost('/diag/replay/start', { name: currentReplayName, loop: diagReplayLoop() });
        };
        bar.querySelector('#rp-back').onclick = () => replayPost('/diag/replay/step', { delta: -1 });
        bar.querySelector('#rp-fwd').onclick  = () => replayPost('/diag/replay/step', { delta: 1 });
        bar.querySelector('#rp-play').onclick = () => {
            const paused = lastReplayStatus && lastReplayStatus.paused;
            replayPost(paused ? '/diag/replay/resume' : '/diag/replay/pause');
        };
        const seek = bar.querySelector('#rp-seek');
        let seekTimer = null;
        seek.addEventListener('input', () => {
            const v = Number(seek.value);
            clearTimeout(seekTimer);
            seekTimer = setTimeout(() => replayPost('/diag/replay/seek', { idx: v }), 60);
        });
        bar.querySelector('#rp-mark').onclick = () => {
            const st = lastReplayStatus;
            if (!st || !st.markers || !st.markers.length) return;
            const cur = st.idx || 0;
            const next = st.markers.find(m => m.idx > cur) || st.markers[0];
            replayPost('/diag/replay/seek', { idx: next.idx });
        };
        bar.querySelector('#rp-inspect').onclick = () => toggleInspector();
    }

    function updateReplayBanner(st) {
        const bar = document.getElementById('replay-banner');
        if (!bar) return;
        lastReplayStatus = (st && st.active) ? st : null;
        if (st && st.active) {
            currentReplayName = st.name;
            const total = st.total || 0;
            bar.querySelector('.replay-banner-txt').textContent =
                `${tr('▶ MOCKUP — přehrávám záznam')} ${st.name}${st.loop ? ' 🔁' : ''}${st.done ? ' ✓' : ''}`;
            bar.querySelector('#rp-count').textContent = `${(st.idx || 0) + 1}/${total}`;
            const seek = bar.querySelector('#rp-seek');
            seek.max = String(Math.max(0, total - 1));
            seek.value = String(st.idx || 0);
            bar.querySelector('#rp-play').textContent = st.paused ? '▶' : '⏸';
            const dl = bar.querySelector('#rp-marks');
            if (dl) dl.innerHTML = (st.markers || []).map(m => `<option value="${m.idx}"></option>`).join('');
            const markBtn = bar.querySelector('#rp-mark');
            if (markBtn) markBtn.style.display = (st.markers && st.markers.length) ? '' : 'none';
            bar.querySelector('#replay-banner-stop').textContent = tr('■ Zpět na živá data');
            bar.hidden = false;
            document.body.classList.add('replaying');
            if (inspectorOpen) refreshInspector();
        } else {
            bar.hidden = true;
            document.body.classList.remove('replaying');
            closeInspector();
        }
    }

    // ─── Frame inspector — raw JSON of the currently shown payload ─────────────
    let inspectorOpen = false;
    function ensureInspector() {
        let el = document.getElementById('replay-inspector');
        if (!el) {
            el = document.createElement('div');
            el.id = 'replay-inspector';
            el.hidden = true;
            el.innerHTML = '<div class="ri-head"><span>Inspektor snímku</span>' +
                '<button type="button" id="ri-close" aria-label="Zavřít">×</button></div>' +
                '<pre id="ri-body"></pre>';
            document.body.appendChild(el);
            el.querySelector('#ri-close').onclick = () => closeInspector();
        }
        return el;
    }
    function refreshInspector() {
        const el = ensureInspector();
        const data = (window.FS25App && window.FS25App.getData) ? window.FS25App.getData() : null;
        const body = el.querySelector('#ri-body');
        try { body.textContent = data ? JSON.stringify(data, null, 2) : '—'; }
        catch (_) { body.textContent = '—'; }
    }
    function toggleInspector() { inspectorOpen ? closeInspector() : openInspector(); }
    function openInspector()  { inspectorOpen = true;  ensureInspector().hidden = false; refreshInspector(); }
    function closeInspector() { inspectorOpen = false; const el = document.getElementById('replay-inspector'); if (el) el.hidden = true; }

    // ─── Init ─────────────────────────────────────────────────────────────────

    // On mobile the nav links don't fit alongside the brand + status + save
    // chip. Inject a hamburger button that toggles `.nav-links.open` — CSS
    // does the rest (hidden by default desktop, dropdown on mobile).
    function injectNavBurger() {
        const nav = document.querySelector('nav');
        const links = nav && nav.querySelector('.nav-links');
        if (!nav || !links) return;
        if (nav.querySelector('.nav-burger')) return;
        const btn = document.createElement('button');
        btn.className = 'nav-burger';
        btn.setAttribute('aria-label', 'Menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '☰';
        nav.insertBefore(btn, links);
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const open = links.classList.toggle('open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.textContent = open ? '✕' : '☰';
        });
        // Close the dropdown on any link click (it'll navigate away anyway,
        // but feels snappier) and on outside-click.
        links.addEventListener('click', e => {
            if (e.target.tagName === 'A') {
                links.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = '☰';
            }
        });
        document.addEventListener('click', e => {
            if (!links.classList.contains('open')) return;
            if (nav.contains(e.target)) return;
            links.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = '☰';
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        injectNotifUI();
        injectNavBurger();
        showServerVersion();
        injectReplayBanner();
        wireMockupGesture();
        applyMockupMode();
    });

    window.FS25App = { connect, rerender, getData: () => lastData };
})();

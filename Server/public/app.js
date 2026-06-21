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
                    <button type="button" data-tab="relay">📡 Sdílení</button>
                    <button type="button" data-tab="setup">📁 Připojení</button>
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
                    <div id="lang-block">
                        <label style="margin-bottom:8px;display:block">Jazyk</label>
                        <select id="lang-select" class="lang-select"></select>
                        <p class="settings-hint" style="margin:4px 0 14px">
                            Přepne celé rozhraní; stránka se po změně načte znovu.
                            Synchronizuje se na ostatní zařízení.
                        </p>
                    </div>
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

                <section class="settings-panel" data-panel="relay" hidden>
                    <label style="margin-bottom:8px;display:block">Sdílení dashboardu (relay)</label>
                    <p class="settings-hint">
                        Server se připojí k relay serveru odchozím spojením a vygeneruje odkaz, který
                        pošleš divákům — uvidí dashboard živě, jen pro čtení (žádné ovládání). Publish
                        klíč musí být povolený v <code>publishers.json</code> na relay.
                    </p>
                    <label class="section-row" style="cursor:default">
                        <span class="section-row-label">Zapnout sdílení</span>
                        <span class="section-row-toggle">
                            <input type="checkbox" id="relay-enabled">
                            <span class="switch-knob"></span>
                        </span>
                    </label>
                    <label>Relay URL</label>
                    <input type="text" id="relay-url" placeholder="wss://stroj.tailnet.ts.net  ·  ws://localhost:8082">
                    <label>Publish klíč</label>
                    <input type="password" id="relay-key" placeholder="(beze změny)" autocomplete="new-password">
                    <div class="section-reset-row" style="margin-top:10px;align-items:center">
                        <button class="primary" id="relay-save" type="button">Uložit a připojit</button>
                        <span id="relay-status" style="font-size:12px;color:var(--muted);margin-left:auto"></span>
                    </div>
                    <div id="relay-viewer-card" class="relay-viewer-card" hidden>
                        <div class="relay-viewer-title">📡 Odkaz pro diváky</div>
                        <div id="relay-viewer-row" class="section-reset-row" style="align-items:center;gap:6px" hidden>
                            <input type="text" id="relay-viewer-url" readonly style="flex:1">
                            <button class="secondary" id="relay-copy" type="button" title="Kopírovat odkaz">⧉</button>
                        </div>
                        <p id="relay-viewer-pending" class="relay-viewer-pending" hidden></p>
                    </div>
                </section>

                <section class="settings-panel" data-panel="setup" hidden>
                    <label style="margin-bottom:8px;display:block">Připojení k FS25</label>
                    <p class="settings-hint">
                        Server čte data ze složky <code>Documents/My Games/FarmingSimulator2025</code>.
                        Standardní cestu detekuje sám — měň ji jen když máš hru jinde (jiný disk, OneDrive).
                        Změna se projeví po restartu serveru.
                    </p>
                    <label>Složka FS25 (Documents)</label>
                    <div class="setup-dir-row">
                        <input type="text" id="setup-dir" class="setup-dir-input" placeholder="C:\Users\…\Documents\My Games\FarmingSimulator2025" autocomplete="off">
                        <button class="secondary" id="setup-browse" type="button">Procházet…</button>
                    </div>
                    <div id="setup-candidates" class="setup-chips"></div>
                    <label>Port serveru</label>
                    <input type="number" id="setup-port" min="1" max="65535" step="1">
                    <label class="section-row" style="cursor:default;margin-top:10px">
                        <span class="section-row-label">Po spuštění otevřít dashboard v prohlížeči</span>
                        <span class="section-row-toggle">
                            <input type="checkbox" id="setup-open-browser">
                            <span class="switch-knob"></span>
                        </span>
                    </label>
                    <div class="setup-actions">
                        <button class="secondary" id="setup-check" type="button">Zkontrolovat</button>
                        <button class="primary" id="setup-save" type="button">Uložit</button>
                        <span id="setup-status" style="font-size:12px;color:var(--muted);margin-left:auto"></span>
                    </div>
                    <div id="setup-probe" class="setup-probe" hidden></div>
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

        // Relay viewer: the modal is theme-only (everything else hidden via CSS),
        // so reframe the entry as a palette rather than full "settings". Keep the
        // #settings-gear-icon span intact — later wiring attaches a listener to it.
        if (window.readOnlyMode) {
            btn.textContent = '🎨';
            btn.title = 'Barevné téma';
            const gi = overlay.querySelector('#settings-gear-icon');
            if (gi) {
                gi.textContent = '🎨';
                if (gi.nextSibling && gi.nextSibling.nodeType === 3) gi.nextSibling.textContent = ' Téma';
            }
        }

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
            // Relay tab: pull current relay state from the server on enter.
            if (tab === 'relay') relayRefresh();
            // Setup tab: pull current paths + probe state on enter.
            if (tab === 'setup') setupRefresh();
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

        // ─── Relay sharing panel ──────────────────────────────────────────
        wireRelayPanel();

        // ─── First-run setup panel + overlay ──────────────────────────────
        wireSetupPanel();
    }

    // ─── First-run setup wizard (Nastavení → Připojení + boot overlay) ─────────
    // Shared fetch + render helpers so the modal tab and the first-run overlay
    // drive the same /api/setup endpoint without duplicating logic.

    function shortenPath(p) {
        if (!p) return '';
        // Collapse a leading ...\Users\<name> to ~ for a shorter chip label.
        return p.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~').replace(/\\/g, '/');
    }

    async function setupProbe(dir) {
        try {
            const u = dir ? `/api/setup?dir=${encodeURIComponent(dir)}` : '/api/setup';
            const r = await fetch(u);
            return r.ok ? r.json() : null;
        } catch (_) { return null; }
    }
    async function setupSave(fs25DocsDir, port, openBrowser) {
        try {
            const body = { fs25DocsDir, port };
            if (typeof openBrowser === 'boolean') body.openBrowser = openBrowser;
            const r = await fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await r.json().catch(() => ({}));
            return { ok: r.ok, ...j };
        } catch (e) { return { ok: false, error: e.message }; }
    }
    // Ask the server to open a native folder dialog; returns { path, status } or null.
    async function setupBrowse(initialDir) {
        try {
            const u = initialDir ? `/api/setup/browse?dir=${encodeURIComponent(initialDir)}` : '/api/setup/browse';
            const r = await fetch(u);
            return r.ok ? r.json() : null;
        } catch (_) { return null; }
    }

    // Render the ✓/✗ file-presence rows for a probed folder.
    function renderSetupStatus(el, status) {
        if (!el) return;
        if (!status) { el.hidden = true; el.innerHTML = ''; return; }
        const mark = ok => ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>';
        let rows;
        if (!status.exists) {
            rows = [`${mark(false)} Složka neexistuje nebo není dostupná`];
        } else {
            rows = [
                `${mark(status.logFileExists)} log.txt ${status.logFileExists ? 'nalezen' : 'chybí'}`,
                `${mark(status.savegamesFound > 0)} savegamy: ${status.savegamesFound}`,
                `${mark(status.dataFileExists)} dashboard_data.json ${status.dataFileExists ? 'nalezen' : 'chybí — objeví se, až spustíš hru se zapnutým módem'}`,
            ];
        }
        el.innerHTML = rows.map(r => `<div class="setup-probe-row">${r}</div>`).join('');
        el.hidden = false;
    }

    // Render auto-detected folders as one-click chips that fill `input`.
    // Only folders that actually exist are offered — no point suggesting a path
    // that isn't there.
    function renderSetupCandidates(wrap, candidates, input) {
        if (!wrap) return;
        const found = (Array.isArray(candidates) ? candidates : []).filter(c => c && c.exists);
        if (!found.length) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = found.map((c, i) => {
            const good = c.logFileExists || c.savegamesFound > 0;
            return `<button type="button" class="setup-chip${good ? ' good' : ''}" data-dir-idx="${i}" title="${c.dir}">${good ? '✓ ' : ''}${shortenPath(c.dir)}</button>`;
        }).join('');
        wrap.querySelectorAll('[data-dir-idx]').forEach(btn => {
            btn.onclick = () => { if (input) input.value = found[+btn.dataset.dirIdx].dir; };
        });
    }

    function setupRefresh() {
        setupProbe().then(s => {
            if (!s) return;
            const dirEl  = document.getElementById('setup-dir');
            const portEl = document.getElementById('setup-port');
            const obEl   = document.getElementById('setup-open-browser');
            if (dirEl  && document.activeElement !== dirEl)  dirEl.value  = s.fs25DocsDir || '';
            if (portEl && document.activeElement !== portEl) portEl.value = s.port || '';
            if (obEl) obEl.checked = s.openBrowser !== false;
            renderSetupCandidates(document.getElementById('setup-candidates'), s.candidates, dirEl);
            renderSetupStatus(document.getElementById('setup-probe'), s.status);
        });
    }

    function wireSetupPanel() {
        const check  = document.getElementById('setup-check');
        const save   = document.getElementById('setup-save');
        const browse = document.getElementById('setup-browse');
        if (browse) browse.onclick = async () => {
            const dirEl = document.getElementById('setup-dir');
            browse.disabled = true; const old = browse.textContent; browse.textContent = 'Otevírám…';
            const res = await setupBrowse(dirEl.value.trim());
            if (res && res.path) {
                dirEl.value = res.path;
                renderSetupStatus(document.getElementById('setup-probe'), res.status);
            }
            browse.disabled = false; browse.textContent = old;
        };
        if (check) check.onclick = async () => {
            const dir = document.getElementById('setup-dir').value.trim();
            check.disabled = true;
            const s = await setupProbe(dir);
            renderSetupStatus(document.getElementById('setup-probe'), s && s.status);
            check.disabled = false;
        };
        if (save) save.onclick = async () => {
            const dir  = document.getElementById('setup-dir').value.trim();
            const port = document.getElementById('setup-port').value;
            const openBrowser = document.getElementById('setup-open-browser').checked;
            const statusEl = document.getElementById('setup-status');
            save.disabled = true; const old = save.textContent; save.textContent = 'Ukládám…';
            const res = await setupSave(dir, port, openBrowser);
            if (!res.ok) { if (statusEl) statusEl.textContent = '⚠ ' + (res.error || 'chyba'); }
            else {
                renderSetupStatus(document.getElementById('setup-probe'), res.status);
                if (statusEl) statusEl.textContent = '✓ Uloženo — restartuj server (.exe), aby se změna projevila.';
            }
            save.disabled = false; save.textContent = old;
        };
    }

    // ── First-run overlay ──────────────────────────────────────────────────
    function injectSetupOverlay() {
        if (window.readOnlyMode) return;            // viewers never see it
        if (document.getElementById('setup-overlay')) return;
        const el = document.createElement('div');
        el.id = 'setup-overlay';
        el.hidden = true;
        el.innerHTML = `
            <div class="setup-card">
                <div class="setup-card-icon">🚜</div>
                <h2>Vítej ve FS25 Dashboard</h2>
                <p class="setup-card-lead">
                    Zatím nepřišla žádná data z FS25. Zkontroluj, že server míří na správnou složku hry —
                    obvykle ji najde sám, jinak ji vyber níže.
                </p>
                <label>Složka FS25 (Documents)</label>
                <div class="setup-dir-row">
                    <input type="text" id="su-dir" class="setup-dir-input" autocomplete="off"
                           placeholder="C:\\Users\\…\\Documents\\My Games\\FarmingSimulator2025">
                    <button class="secondary" id="su-browse" type="button">Procházet…</button>
                </div>
                <div id="su-candidates" class="setup-chips"></div>
                <div id="su-probe" class="setup-probe" hidden></div>
                <div class="setup-card-actions">
                    <button class="secondary" id="su-check" type="button">Zkontrolovat</button>
                    <button class="primary" id="su-save" type="button">Uložit</button>
                </div>
                <span id="su-status" class="setup-card-msg"></span>
                <div class="setup-card-foot">
                    <button class="linklike" id="su-close" type="button">Zavřít</button>
                    <button class="linklike" id="su-advanced" type="button">Pokročilé nastavení →</button>
                </div>
            </div>`;
        document.body.appendChild(el);
    }
    function hideSetupOverlay() {
        const el = document.getElementById('setup-overlay');
        if (el) el.hidden = true;
    }
    function maybeShowSetupOverlay() {
        if (window.readOnlyMode) return;
        setupProbe().then(s => {
            if (!s || !s.status) return;
            // Already getting frames? source is fine — never nag.
            if (window.FS25App && window.FS25App.getData && window.FS25App.getData()) return;
            if (s.status.dataFileExists) return;
            const dirEl = document.getElementById('su-dir');
            if (dirEl) dirEl.value = s.fs25DocsDir || '';
            renderSetupCandidates(document.getElementById('su-candidates'), s.candidates, dirEl);
            renderSetupStatus(document.getElementById('su-probe'), s.status);
            const el = document.getElementById('setup-overlay');
            if (el) el.hidden = false;
        });
    }
    function wireSetupOverlay() {
        const check  = document.getElementById('su-check');
        const save   = document.getElementById('su-save');
        const close  = document.getElementById('su-close');
        const adv    = document.getElementById('su-advanced');
        const browse = document.getElementById('su-browse');
        if (browse) browse.onclick = async () => {
            const dirEl = document.getElementById('su-dir');
            browse.disabled = true; const old = browse.textContent; browse.textContent = 'Otevírám…';
            const res = await setupBrowse(dirEl.value.trim());
            if (res && res.path) {
                dirEl.value = res.path;
                renderSetupStatus(document.getElementById('su-probe'), res.status);
            }
            browse.disabled = false; browse.textContent = old;
        };
        if (check) check.onclick = async () => {
            const dir = document.getElementById('su-dir').value.trim();
            check.disabled = true;
            const s = await setupProbe(dir);
            renderSetupStatus(document.getElementById('su-probe'), s && s.status);
            check.disabled = false;
        };
        if (save) save.onclick = async () => {
            const dir = document.getElementById('su-dir').value.trim();
            const statusEl = document.getElementById('su-status');
            save.disabled = true; const old = save.textContent; save.textContent = 'Ukládám…';
            const res = await setupSave(dir, '');
            if (!res.ok) { if (statusEl) statusEl.textContent = '⚠ ' + (res.error || 'chyba'); }
            else {
                renderSetupStatus(document.getElementById('su-probe'), res.status);
                if (statusEl) statusEl.textContent = '✓ Uloženo. Restartuj server (.exe) a načti stránku znovu.';
            }
            save.disabled = false; save.textContent = old;
        };
        if (close) close.onclick = hideSetupOverlay;
        if (adv) adv.onclick = () => {
            hideSetupOverlay();
            openNotifModal();
            const tab = document.querySelector('[data-tab="setup"]');
            if (tab) tab.click();
        };
    }

    // ─── Relay sharing (Nastavení → Sdílení) ──────────────────────────────────
    function applyRelayState(s) {
        if (!s) return;
        const urlEl    = document.getElementById('relay-url');
        const enEl     = document.getElementById('relay-enabled');
        const keyEl    = document.getElementById('relay-key');
        const statusEl = document.getElementById('relay-status');
        const card     = document.getElementById('relay-viewer-card');
        const row      = document.getElementById('relay-viewer-row');
        const viewer   = document.getElementById('relay-viewer-url');
        const pending  = document.getElementById('relay-viewer-pending');
        // Don't clobber a field the user is mid-edit.
        if (urlEl && document.activeElement !== urlEl) urlEl.value = s.url || '';
        if (enEl) enEl.checked = !!s.enabled;
        if (keyEl) keyEl.placeholder = s.hasKey ? '(beze změny — klíč uložen)' : 'publish klíč';
        const labels = { disabled: 'vypnuto', connecting: 'připojuji…', connected: '✓ připojeno', error: '⚠ chyba spojení' };
        if (statusEl) statusEl.textContent = labels[s.status] || s.status || '';
        // Viewer-link card: show the link once the relay confirms a room; while
        // sharing is on but not yet connected, explain WHY there's no link yet
        // (instead of an empty/hidden area that reads as "feature missing").
        if (viewer && s.viewerUrl) viewer.value = s.viewerUrl;
        if (card && row && pending) {
            if (s.viewerUrl) {
                card.hidden = false; row.hidden = false; pending.hidden = true;
            } else if (s.enabled) {
                card.hidden = false; row.hidden = true; pending.hidden = false;
                pending.textContent = s.status === 'error'
                    ? '⚠ Spojení s relayem selhalo — zkontroluj Relay URL a publish klíč. Odkaz se objeví po připojení.'
                    : 'Připojuji k relayi… odkaz se objeví, jakmile relay potvrdí spojení.';
            } else {
                card.hidden = true;
            }
        }
    }

    async function relayRefresh() {
        try { applyRelayState(await fetch('/api/relay').then(r => r.json())); }
        catch (_) { const el = document.getElementById('relay-status'); if (el) el.textContent = 'stav nedostupný'; }
    }

    function wireRelayPanel() {
        const save = document.getElementById('relay-save');
        const copy = document.getElementById('relay-copy');
        if (save) save.onclick = async () => {
            const url     = document.getElementById('relay-url').value.trim();
            const key     = document.getElementById('relay-key').value;
            const enabled = document.getElementById('relay-enabled').checked;
            const statusEl = document.getElementById('relay-status');
            save.disabled = true; const old = save.textContent; save.textContent = 'Ukládám…';
            try {
                const res = await fetch('/api/relay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, key, enabled }),
                });
                const s = await res.json();
                if (!res.ok) { if (statusEl) statusEl.textContent = '⚠ ' + (s.error || 'chyba'); }
                else {
                    document.getElementById('relay-key').value = '';   // never keep the secret in the field
                    applyRelayState(s);
                    // Poll a few times so the user sees connecting → connected + the link.
                    let n = 0;
                    const iv = setInterval(async () => {
                        if (++n > 6) return clearInterval(iv);
                        try { applyRelayState(await fetch('/api/relay').then(r => r.json())); } catch (_) {}
                    }, 1500);
                }
            } catch (e) { if (statusEl) statusEl.textContent = '⚠ ' + e.message; }
            finally { save.disabled = false; save.textContent = old; }
        };
        if (copy) copy.onclick = () => {
            const v = document.getElementById('relay-viewer-url').value;
            if (v && navigator.clipboard) navigator.clipboard.writeText(v)
                .then(() => { copy.textContent = '✓'; setTimeout(() => { copy.textContent = '⧉'; }, 1200); });
        };
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

        // Relay viewer: force the theme panel active (tabs are hidden), so the
        // modal opens straight to the colour-theme picker.
        if (window.readOnlyMode) {
            document.querySelectorAll('.settings-panel').forEach(p => {
                p.hidden = (p.dataset.panel !== 'theme');
            });
        }

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

    // ─── Read-only viewer detection ───────────────────────────────────────────
    // window.readOnlyMode is pre-set synchronously by an inline <head> script
    // (from the room-token hash) so no module writes back before we know the mode.
    // /api/mode is authoritative and may correct it. The class lives on <html>.
    if (typeof window.readOnlyMode === 'undefined') window.readOnlyMode = false;
    function applyReadOnlyClass() {
        document.documentElement.classList.toggle('read-only', !!window.readOnlyMode);
        if (document.body) document.body.classList.toggle('read-only', !!window.readOnlyMode);
    }
    applyReadOnlyClass();
    const readOnlyReady = fetch('/api/mode')
        .then(r => (r.ok ? r.json() : null))
        .then(m => { if (m) window.readOnlyMode = !!m.readOnly; applyReadOnlyClass(); })
        .catch(() => {});
    window.__readOnlyReady = readOnlyReady;
    document.addEventListener('DOMContentLoaded', applyReadOnlyClass);

    // Build the WS URL. Over HTTPS (Tailscale Funnel is TLS-only) use wss. A room
    // token in location.hash means we're a viewer → connect to /ws/view/<token>;
    // otherwise connect to the root (local control server).
    function wsUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = (location.hash || '').replace(/^#/, '').trim();
        return token
            ? `${proto}//${location.host}/ws/view/${encodeURIComponent(token)}`
            : `${proto}//${location.host}`;
    }

    // ─── Source-offline overlay (relay viewer only) ───────────────────────────
    // Full-page fallback so a viewer never stares at stale/blank data without
    // explanation. No-op on the local operator dashboard (it has the ws-dot).
    function showSourceOverlay(title, msg, opts) {
        if (!window.readOnlyMode) return;
        const el = document.getElementById('source-overlay');
        if (!el) return;
        const t  = document.getElementById('so-title');
        const m  = document.getElementById('so-msg');
        const ic = document.getElementById('so-icon');
        if (t)  t.textContent  = title;
        if (m)  m.textContent  = msg;
        if (ic) ic.textContent = (opts && opts.terminal) ? '🔌' : '📡';
        el.classList.toggle('terminal', !!(opts && opts.terminal));
        el.hidden = false;
    }
    function hideSourceOverlay() {
        const el = document.getElementById('source-overlay');
        if (el) el.hidden = true;
    }

    // ─── WebSocket connect (single shared logic) ──────────────────────────────

    let lastData = null;
    let onDataCb = null;

    function connect(onData) {
        const dot     = document.getElementById('ws-dot');
        const wsLabel = document.getElementById('ws-label');
        let ws, reconnectTimer, backoff = 2000;
        onDataCb = onData;

        function open() {
            ws = new WebSocket(wsUrl());
            // Expose the live socket so the smoke suite can drive a disconnect
            // (window.__ws.close()) — there's no server endpoint to force one.
            window.__ws = ws;
            ws.onopen = () => {
                dot.className = 'dot live';
                wsLabel.textContent = 'Live';
                clearTimeout(reconnectTimer);
                backoff = 2000;
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
                    // Source (publisher) liveness from the relay — drives the viewer overlay.
                    if (data.__sourceStatus) {
                        if (data.__sourceStatus.online) hideSourceOverlay();
                        else showSourceOverlay('Zdroj se odpojil', 'Čekám na obnovení spojení…');
                        return;
                    }
                    // A real data frame means the source is live → clear any overlay.
                    hideSourceOverlay();
                    hideSetupOverlay();   // game data flowing → first-run helper no longer needed
                    if (window.CropIcons && Array.isArray(data.availableFruits)) {
                        window.CropIcons.setCatalog(data.availableFruits);
                    }
                    if (window.FS25Money && data.currency) FS25Money.setCurrency(data.currency);
                    if (data.saveMeta) updateSaveMeta(data.saveMeta);
                    // Notifications + bell are local-server only — never in the relay viewer.
                    if (!window.readOnlyMode) {
                        if (window.Notifier) window.Notifier.process(data);
                        if (window.FS25Bell) window.FS25Bell.update(data);
                    }
                    lastData = data;
                    onData && onData(data);
                    if (inspectorOpen) refreshInspector();
                } catch (_) {}
            };
            ws.onclose = (ev) => {
                dot.className = 'dot error';
                const code = ev && ev.code;
                // Permanent room death → stop reconnecting, tell the viewer why.
                if (code === 4404) { wsLabel.textContent = 'Odkaz neplatný nebo vypršel'; showSourceOverlay('Odkaz je neplatný', 'Tento sdílecí odkaz vypršel nebo neexistuje.', { terminal: true }); return; }
                if (code === 4410) { wsLabel.textContent = 'Vysílající se odpojil';        showSourceOverlay('Stream ukončen', 'Vysílající ukončil sdílení.', { terminal: true });       return; }
                // Transient (network/relay blip) → reconnect with backoff + jitter.
                wsLabel.textContent = 'Odpojeno – obnovuji…';
                showSourceOverlay('Spojení přerušeno', 'Obnovuji spojení s relayem…');
                const jitter = Math.floor(backoff * 0.2 * Math.random());
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(open, backoff + jitter);
                backoff = Math.min(Math.round(backoff * 1.5), 30000);
            };
            ws.onerror = () => { try { ws.close(); } catch (_) {} };
        }

        // open() regardless of how readOnlyReady settles — the WS must always be
        // attempted even if mode detection somehow rejects. In the relay viewer,
        // show a "connecting to source" overlay until the first frame / status.
        readOnlyReady.then(() => { showSourceOverlay('Připojuji se ke zdroji…', 'Načítám živá data…'); open(); }, open);
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
        if (window.readOnlyMode) return;   // relay has no /api/version; skip the call
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
            if (window.readOnlyMode) return;   // viewer mode: no mockup/diag unlock
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
        // First-run helper: inject + wire the overlay, then show it once we know
        // the mode (viewers are skipped) if no game data is arriving yet.
        injectSetupOverlay();
        wireSetupOverlay();
        readOnlyReady.then(maybeShowSetupOverlay, maybeShowSetupOverlay);
    });

    window.FS25App = { connect, rerender, getData: () => lastData };
})();

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
                <h3>⚙ Nastavení</h3>
                <nav class="settings-tabs" id="settings-tabs">
                    <button type="button" data-tab="notif" class="active">🔔 Notifikace</button>
                    <button type="button" data-tab="sections">📋 Sekce</button>
                    <button type="button" data-tab="vehicles">🚜 Vozidla</button>
                    <button type="button" data-tab="theme">🎨 Vzhled</button>
                    <button type="button" data-tab="sync">☁ Sync</button>
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

                <section class="settings-panel" data-panel="vehicles" hidden>
                    <label style="margin-bottom:8px;display:block">Sekce vozidel</label>
                    <p class="settings-hint">
                        V rozšířeném zobrazení vidíš pod každým vozidlem i jeho
                        nářadí (vlečky, semenovody, sila kombajnu) s aktuálním
                        naplněním. Sekce se taky roztáhne přes dva sloupce, ať
                        je víc místa pro detail.
                    </p>
                    <label class="section-row" style="cursor:default">
                        <span class="section-row-label">Rozšířené zobrazení (nářadí + 2 sloupce)</span>
                        <span class="section-row-toggle">
                            <input type="checkbox" id="vehicles-expanded">
                            <span class="switch-knob"></span>
                        </span>
                    </label>
                    <label class="section-row" style="cursor:default">
                        <span class="section-row-label">Zobrazit i prázdné nářadí v základním pohledu</span>
                        <span class="section-row-toggle">
                            <input type="checkbox" id="vehicles-show-empty-impl">
                            <span class="switch-knob"></span>
                        </span>
                    </label>
                </section>

                <section class="settings-panel" data-panel="theme" hidden>
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

        // ─── Vehicles panel — basic vs expanded toggle ────────────────────
        const vehExp = document.getElementById('vehicles-expanded');
        if (vehExp && window.DashState) {
            const KEY = window.DashState.KEYS.vehiclesExpanded;
            vehExp.checked = !!window.DashState.get(KEY, false);
            vehExp.onchange = () => {
                window.DashState.set(KEY, vehExp.checked);
                if (window.ServerSync) window.ServerSync.syncWrite(KEY, vehExp.checked);
                applyVehiclesExpanded();
            };
        }
        // ─── Vehicles panel — show empty implements in basic view ─────────
        const vehShowEmpty = document.getElementById('vehicles-show-empty-impl');
        if (vehShowEmpty && window.DashState) {
            const KEY = 'vehicleShowEmptyImplements';
            vehShowEmpty.checked = !!window.DashState.get(KEY, false);
            vehShowEmpty.onchange = () => {
                window.DashState.set(KEY, vehShowEmpty.checked);
                if (window.ServerSync) window.ServerSync.syncWrite(KEY, vehShowEmpty.checked);
                // Re-render vehicles to pick up the new filter; uses the
                // last live data cached on FS25App.
                if (window.FS25App && window.FS25App.rerender) window.FS25App.rerender();
            };
        }
    }

    // Toggle the .expanded-vehicles class on the vehicles section based on
    // DashState. Re-applied on load, on user toggle, and on cross-device
    // sync (handled by serverSync.js patches).
    function applyVehiclesExpanded() {
        if (!window.DashState) return;
        const on  = !!window.DashState.get(window.DashState.KEYS.vehiclesExpanded, false);
        const sec = document.querySelector('.section[data-tt-key="vehicles"]');
        if (sec) sec.classList.toggle('expanded-vehicles', on);
    }
    window.applyVehiclesExpanded = applyVehiclesExpanded;

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
                    if (window.CropIcons && Array.isArray(data.availableFruits)) {
                        window.CropIcons.setCatalog(data.availableFruits);
                    }
                    if (window.FS25Money && data.currency) FS25Money.setCurrency(data.currency);
                    if (data.saveMeta) updateSaveMeta(data.saveMeta);
                    if (window.Notifier) window.Notifier.process(data);
                    if (window.FS25Bell) window.FS25Bell.update(data);
                    lastData = data;
                    onData && onData(data);
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

    // ─── Init ─────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', () => {
        injectNotifUI();
        showServerVersion();
    });

    window.FS25App = { connect, rerender };
})();

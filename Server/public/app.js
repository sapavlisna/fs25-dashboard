// Shared cross-page setup: notification button + modal, WebSocket helper.
// Each page calls FS25App.connect(onData) — single dispatch point for WS.

(function () {
    // ─── Notification button + modal injection ───────────────────────────────

    const THEMES = [
        { id: 'dark-green',    label: 'Tmavě zelená',     icon: '🌿' },
        { id: 'dark-blue',     label: 'Tmavě modrá',      icon: '🌙' },
        { id: 'light',         label: 'Světlá',           icon: '☀️' },
        { id: 'high-contrast', label: 'Vysoký kontrast',  icon: '◐' },
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
        { id: 'sec-storage',     label: '🏚 Sklady' },
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
                    <button type="button" data-tab="theme">🎨 Vzhled</button>
                </nav>

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
                    <div class="section-list" id="section-list"></div>
                </section>

                <section class="settings-panel" data-panel="theme" hidden>
                    <label style="margin-bottom:8px;display:block">Téma vzhledu</label>
                    <div class="theme-grid">${themeButtons}</div>
                </section>

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

        // Sekce panel — toggles persist in DashState.hiddenSections and apply
        // to the main dashboard immediately (when modal is open from /).
        renderSectionList();
        document.getElementById('section-list').addEventListener('change', e => {
            const cb = e.target.closest('input[data-section-id]');
            if (!cb) return;
            toggleSection(cb.dataset.sectionId, !cb.checked);
        });
    }

    function renderSectionList() {
        const wrap = document.getElementById('section-list');
        if (!wrap) return;
        const hidden = new Set(window.DashState
            ? (window.DashState.get(window.DashState.KEYS.hiddenSections, []) || [])
            : []);
        wrap.innerHTML = DASHBOARD_SECTIONS.map(s => {
            const checked = !hidden.has(s.id);
            return `<label class="section-row">
                <span class="section-row-label">${s.label}</span>
                <span class="section-row-toggle">
                    <input type="checkbox" data-section-id="${s.id}"${checked ? ' checked' : ''}>
                    <span class="switch-knob"></span>
                </span>
            </label>`;
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

    function connect(onData) {
        const dot     = document.getElementById('ws-dot');
        const wsLabel = document.getElementById('ws-label');
        let ws, reconnectTimer;

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
                    if (window.CropIcons && Array.isArray(data.availableFruits)) {
                        window.CropIcons.setCatalog(data.availableFruits);
                    }
                    if (window.FS25Money && data.currency) FS25Money.setCurrency(data.currency);
                    if (data.saveMeta) updateSaveMeta(data.saveMeta);
                    if (window.Notifier) window.Notifier.process(data);
                    if (window.FS25Bell) window.FS25Bell.update(data);
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

    // ─── Init ─────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', injectNotifUI);

    window.FS25App = { connect };
})();

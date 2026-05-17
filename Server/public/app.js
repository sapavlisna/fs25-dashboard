// Shared cross-page setup: notification button + modal, WebSocket helper.
// Each page calls FS25App.connect(onData) — single dispatch point for WS.

(function () {
    // ─── Notification button + modal injection ───────────────────────────────

    function injectNotifUI() {
        const status = document.querySelector('.nav-status');
        if (!status) return;

        const s = window.Notifier ? window.Notifier.getSettings() : { enabled: false };
        const btn = document.createElement('button');
        btn.id = 'notif-toggle';
        btn.className = 'notif-btn' + (s.enabled ? ' on' : '');
        btn.textContent = '🔔';
        btn.title = 'Nastavení notifikací';
        btn.onclick = openNotifModal;
        status.appendChild(btn);

        // Modal HTML
        const overlay = document.createElement('div');
        overlay.id = 'notif-modal-overlay';
        overlay.innerHTML = `
            <div id="notif-modal">
                <h3>🔔 Nastavení notifikací</h3>
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

                <button class="primary" id="nt-save">Uložit</button>
                <div class="row" style="margin-top:8px">
                    <button class="secondary" id="nt-test">Test</button>
                    <button class="secondary" id="nt-close" style="margin-left:auto">Zavřít</button>
                </div>
                <div id="nt-status" style="font-size:11px;color:var(--muted);margin-top:10px"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeNotifModal();
        });
        document.getElementById('nt-close').onclick = closeNotifModal;
        document.getElementById('nt-save').onclick  = saveNotifSettings;
        document.getElementById('nt-test').onclick  = testNotif;
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

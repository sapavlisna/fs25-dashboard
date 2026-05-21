// bell.js — in-nav notification bell.
//
// Aggregates active alerts from the latest WS payload and renders them as:
//   1. A bell button in the nav with a count badge + first-alert preview.
//   2. A drop-down panel listing all alerts; clicking an alert scrolls to
//      its target section and pulses the card briefly.
//
// Pages opt in by calling FS25Bell.update(data) from their WS handler.
// All thresholds match `bell-panel` rules in REDESIGN-V2.md.

(function () {

    // ─── Threshold constants ────────────────────────────────────────────
    const FOOD_LOW   = 25;
    const WATER_LOW  = 20;
    const STRAW_LOW  = 25;
    const OUTPUT_HI  = 90;
    const FUEL_LOW   = 15;
    const STORAGE_HI = 95;

    // ─── Alert generation ──────────────────────────────────────────────
    // Returns array of { key, icon, title, detail, target, severity }.

    function genAlerts(d) {
        const out = [];
        const animals  = d.animals  || [];
        const fields   = d.fields   || [];
        const vehicles = d.vehicles || [];
        const storage  = d.storage  || [];

        // Animals — low food
        const lowFood = animals.filter(a => a.count > 0 && (a.foodPercent ?? 100) < FOOD_LOW);
        if (lowFood.length) out.push({
            key: 'anim-food', icon: '🐄', severity: 'warning',
            title: `${lowFood.length} ${plural(lowFood.length, 'chov potřebuje krmivo', 'chovy potřebují krmivo', 'chovů potřebuje krmivo')}`,
            detail: lowFood.map(a => a.husbandryName).join(' · '),
            target: 'sec-animals',
        });

        // Animals — low water
        const lowWater = animals.filter(a => a.count > 0 && (a.waterPercent ?? 100) < WATER_LOW);
        if (lowWater.length) out.push({
            key: 'anim-water', icon: '💧', severity: 'warning',
            title: `${lowWater.length} ${plural(lowWater.length, 'chov potřebuje vodu', 'chovy potřebují vodu', 'chovů potřebuje vodu')}`,
            detail: lowWater.map(a => a.husbandryName).join(' · '),
            target: 'sec-animals',
        });

        // Animals — low straw (only where strawPercent is reported)
        const lowStraw = animals.filter(a => a.count > 0 && a.strawPercent != null && a.strawPercent < STRAW_LOW);
        if (lowStraw.length) out.push({
            key: 'anim-straw', icon: '🛏', severity: 'warning',
            title: `${lowStraw.length} ${plural(lowStraw.length, 'chov potřebuje podestýlku', 'chovy potřebují podestýlku', 'chovů potřebuje podestýlku')}`,
            detail: lowStraw.map(a => a.husbandryName).join(' · '),
            target: 'sec-animals',
        });

        // Animals — outputs full (milk/manure/liquidManure). Empty pens skipped.
        const outputsFull = animals.filter(a => a.count > 0 && (
            (a.milkPercent != null && a.milkPercent >= OUTPUT_HI) ||
            (a.manurePercent != null && a.manurePercent >= OUTPUT_HI) ||
            (a.liquidManurePercent != null && a.liquidManurePercent >= OUTPUT_HI)
        ));
        if (outputsFull.length) out.push({
            key: 'anim-output', icon: '📦', severity: 'info',
            title: `${outputsFull.length} ${plural(outputsFull.length, 'chov má plný výstup', 'chovy mají plný výstup', 'chovů má plný výstup')}`,
            detail: outputsFull.map(a => a.husbandryName).join(' · '),
            target: 'sec-animals',
        });

        // Fields — ready to harvest
        const ready = fields.filter(f => f.owned && f.isReadyToHarvest);
        if (ready.length) out.push({
            key: 'field-ready', icon: '🌾', severity: 'info',
            title: `${ready.length} ${plural(ready.length, 'pole připravené ke sklizni', 'pole připravená ke sklizni', 'polí připravených ke sklizni')}`,
            detail: ready.map(f => `#${f.id} ${f.fruitName || ''}`.trim()).join(' · '),
            target: 'sec-fields',
        });

        // Vehicles — low fuel. Skip vehicles the user has hidden (drag-and-drop
        // hide zone on the Dashboard) and ones with no fuel tank (wheelbarrows,
        // rest-station placeables — they report fuelCapacity=0, which would
        // otherwise pin fuelPercent at 0 and trip the threshold spuriously).
        const ds = window.DashState;
        const hiddenVehicles = ds
            ? new Set((ds.get(ds.KEYS.hiddenVehicles, []) || []).map(String))
            : new Set();
        const lowFuel = vehicles.filter(v =>
            (v.fuelCapacity || 0) > 0 &&
            !hiddenVehicles.has(String(v.name)) &&
            (v.fuelPercent ?? 100) < FUEL_LOW);
        if (lowFuel.length) out.push({
            key: 'veh-fuel', icon: '🚜', severity: 'urgent',
            title: `${lowFuel.length} ${plural(lowFuel.length, 'vozidlo s nízkým palivem', 'vozidla s nízkým palivem', 'vozidel s nízkým palivem')}`,
            detail: lowFuel.map(v => `${v.name} (${v.fuelPercent}%)`).join(' · '),
            target: 'sec-vehicles',
        });

        // Storage — silos with any item ≥ 95 % full
        const fullSilos = [];
        for (const silo of storage) {
            for (const item of (silo.items || [])) {
                if (item.capacity > 0 && item.amount / item.capacity >= STORAGE_HI / 100) {
                    fullSilos.push(`${silo.storageName}: ${item.name}`);
                    break;
                }
            }
        }
        if (fullSilos.length) out.push({
            key: 'storage-full', icon: '🏚', severity: 'info',
            title: `${fullSilos.length} ${plural(fullSilos.length, 'sklad téměř plný', 'sklady téměř plné', 'skladů téměř plných')}`,
            detail: fullSilos.join(' · '),
            target: 'sec-storage',
        });

        return out;
    }

    // Czech plural picker: 1 / 2-4 / 5+
    function plural(n, one, few, many) {
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return few;
        return many;
    }

    // ─── Mounting & rendering ──────────────────────────────────────────

    let mounted = false;
    let bellEl, badgeEl, panelEl, listEl;

    function mount() {
        if (mounted) return;
        const slot = document.getElementById('bell-slot');
        if (!slot) return;

        slot.innerHTML = `
            <button class="bell" id="bell-btn" aria-haspopup="true" aria-expanded="false" title="Upozornění">
                <span class="bell-icon">🔔</span>
                <span class="bell-count" id="bell-count" hidden>0</span>
            </button>
            <div class="bell-panel" id="bell-panel" hidden>
                <header class="bell-panel-head">
                    <h3>Upozornění</h3>
                    <button class="bell-close" id="bell-close" title="Zavřít">×</button>
                </header>
                <ul class="bell-list" id="bell-list"></ul>
                <footer class="bell-empty" id="bell-empty">Žádná upozornění.</footer>
            </div>
        `;

        bellEl  = document.getElementById('bell-btn');
        badgeEl = document.getElementById('bell-count');
        panelEl = document.getElementById('bell-panel');
        listEl  = document.getElementById('bell-list');

        bellEl.addEventListener('click', togglePanel);
        document.getElementById('bell-close').addEventListener('click', closePanel);

        // Close on click outside or Esc
        document.addEventListener('click', e => {
            if (panelEl.hidden) return;
            if (slot.contains(e.target)) return;
            closePanel();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !panelEl.hidden) closePanel();
        });

        // Click on alert row → scroll to target section + pulse.
        // Targets live on the main Dashboard; if we're on a side page and the
        // section doesn't exist here, jump to "/#<target>" and let the
        // Dashboard's deep-link handler (below) finish the scroll.
        listEl.addEventListener('click', e => {
            const li = e.target.closest('li[data-target]');
            if (!li) return;
            const targetId = li.dataset.target;
            const target = document.getElementById(targetId);
            closePanel();
            if (target) {
                scrollAndFlash(target);
            } else {
                location.href = '/#' + encodeURIComponent(targetId);
            }
        });

        mounted = true;
    }

    function scrollAndFlash(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.remove('card-flash');
        void el.offsetWidth;          // force reflow to restart animation
        el.classList.add('card-flash');
    }

    // Deep-link handler: a bell click on a side page redirects here with
    // location.hash = "#sec-animals" (or similar). After the first WS render
    // populates the section, scroll it into view and flash. We poll briefly
    // because the section may not exist at DOMContentLoaded if WS is slow.
    function handleDeepLink() {
        const hash = location.hash.slice(1);
        if (!hash || !/^sec-[a-z]+$/.test(hash)) return;
        let attempts = 0;
        const tick = () => {
            const el = document.getElementById(hash);
            if (el) {
                scrollAndFlash(el);
                history.replaceState(null, '', location.pathname);
                return;
            }
            if (++attempts < 20) setTimeout(tick, 200);  // up to 4 s
        };
        // Small initial delay so the first WS payload renders content first.
        setTimeout(tick, 400);
    }
    document.addEventListener('DOMContentLoaded', handleDeepLink);

    function togglePanel() {
        if (panelEl.hidden) openPanel(); else closePanel();
    }
    function openPanel() {
        panelEl.hidden = false;
        bellEl.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
        panelEl.hidden = true;
        bellEl.setAttribute('aria-expanded', 'false');
    }

    function update(data) {
        mount();
        if (!mounted) return;
        const alerts = genAlerts(data || {});
        const n = alerts.length;

        // Badge
        if (n > 0) {
            badgeEl.textContent = n > 9 ? '9+' : String(n);
            badgeEl.hidden = false;
            bellEl.classList.add('has-alerts');
            bellEl.title = alerts[0].title;
        } else {
            badgeEl.hidden = true;
            bellEl.classList.remove('has-alerts');
            bellEl.title = 'Upozornění';
        }

        // Panel content
        listEl.innerHTML = alerts.map(a => `
            <li class="bell-item bell-${a.severity}" data-target="${a.target}">
                <span class="bell-item-icon">${a.icon}</span>
                <div class="bell-item-text">
                    <div class="bell-item-title">${escapeHtml(a.title)}</div>
                    <div class="bell-item-detail">${escapeHtml(a.detail)}</div>
                </div>
                <span class="bell-item-arrow">→</span>
            </li>
        `).join('');
        document.getElementById('bell-empty').hidden = n > 0;
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.FS25Bell = { update };
})();

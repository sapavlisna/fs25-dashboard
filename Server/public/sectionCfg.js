// sectionCfg.js — per-section settings panel (dropdown below section header).
// Each section registers itself via SectionCfg.define(key, def). Clicking
// the .sec-cfg-btn in any section header opens/closes the panel.
(function () {
    const _defs = {};
    let _currentKey = null;

    // ── Public API ───────────────────────────────────────────────────────────

    // Register a section's settings definition.
    // def = { title, basic: [item], advanced: [{group, items:[item]}] }
    // item = { key, label, default, expanded?, onchange? }
    //   expanded: true  → toggling this item also applies .expanded-<sectionKey> CSS class
    //   onchange: fn(bool) → custom callback (runs instead of default rerender)
    function define(key, def) {
        _defs[key] = def;
    }

    // Apply .expanded-<sectionKey> class based on DashState value.
    function applyExpanded(sectionKey, dashKey, defaultVal) {
        const on = !!DashState.get(dashKey, defaultVal || false);
        const sec = document.querySelector(`.section[data-tt-key="${sectionKey}"]`);
        if (sec) sec.classList.toggle('expanded-' + sectionKey, on);
    }

    // Apply expanded state for every registered section that has an expanded item.
    function applyAllExpanded() {
        for (const [key, def] of Object.entries(_defs)) {
            const exp = (def.basic || []).find(i => i.expanded);
            if (exp) applyExpanded(key, exp.key, exp.default);
        }
    }

    // All settings items for a section (basic + advanced flattened).
    function _allItems(def) {
        return [
            ...(def.basic || []),
            ...(def.advanced || []).flatMap(g => g.items || []),
        ];
    }

    // Read an item's current value — via custom get() if present (flash
    // channels live in a separate map), otherwise straight from DashState.
    function _itemValue(item) {
        return item.get ? item.get() : DashState.get(item.key, item.default);
    }
    // Write an item's value — via custom set() if present, else DashState.
    function _itemSet(item, value) {
        if (item.set) item.set(value); else DashState.set(item.key, value);
    }

    // Does this section have at least one non-default value? (V-2 indicator)
    function _isDirty(key) {
        const def = _defs[key];
        if (!def) return false;
        return _allItems(def).some(item => {
            const raw = _itemValue(item);
            if (item.type === 'select') return raw !== item.default;
            return !!raw !== !!item.default;
        });
    }

    // Toggle the .has-custom class on every section's ⚙ button to reflect
    // whether the section currently has non-default settings.
    function applyDirtyIndicators() {
        for (const key of Object.keys(_defs)) {
            const btn = document.querySelector(`.sec-cfg-btn[data-sec-cfg="${key}"]`);
            if (btn) btn.classList.toggle('has-custom', _isDirty(key));
        }
    }

    // Reset every setting in a section back to its default. (V-1)
    function reset(key) {
        const def = _defs[key];
        if (!def) return;
        for (const item of _allItems(def)) {
            _itemSet(item, item.default);
        }
        const exp = (def.basic || []).find(i => i.expanded);
        if (exp) applyExpanded(key, exp.key, exp.default);
        applyDirtyIndicators();
        if (window.FS25App && window.FS25App.rerender) window.FS25App.rerender();
        if (typeof relayoutMasonry === 'function') relayoutMasonry();
    }

    // Create the singleton panel DOM node and attach global event listeners.
    function init() {
        if (document.getElementById('sec-cfg-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'sec-cfg-panel';
        panel.hidden = true;
        document.body.appendChild(panel);

        document.addEventListener('mousedown', e => {
            if (!_currentKey) return;
            if (e.target.closest('#sec-cfg-panel') || e.target.closest('.sec-cfg-btn')) return;
            close();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && _currentKey) close();
        });
    }

    // Toggle panel for a section. Opens if closed, closes if already open for same key.
    function toggle(key, anchorEl) {
        if (_currentKey === key) { close(); return; }
        _open(key, anchorEl);
    }

    // Close the panel.
    function close() {
        const panel = document.getElementById('sec-cfg-panel');
        if (panel) panel.hidden = true;
        if (_currentKey) {
            const btn = document.querySelector(`.sec-cfg-btn[data-sec-cfg="${_currentKey}"]`);
            if (btn) btn.classList.remove('active');
        }
        _currentKey = null;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _rowHTML(item) {
        const raw = _itemValue(item);
        if (item.type === 'select') {
            const opts = (item.options || []).map(o =>
                `<option value="${o.value}"${o.value === raw ? ' selected' : ''}>${o.label}</option>`
            ).join('');
            return `<label class="section-row" style="cursor:default">
                <span class="section-row-label">${item.label}</span>
                <select class="sec-cfg-select" data-cfg-key="${item.key}">${opts}</select>
            </label>`;
        }
        // Checkbox. Default false → unchecked unless raw === true; default true → checked unless raw === false.
        const checked = (item.default === false)
            ? (raw === true ? 'checked' : '')
            : (raw !== false ? 'checked' : '');
        return `<label class="section-row" style="cursor:default">
            <span class="section-row-label">${item.label}</span>
            <span class="section-row-toggle">
                <input type="checkbox" data-cfg-key="${item.key}" ${checked}>
                <span class="switch-knob"></span>
            </span>
        </label>`;
    }

    function _open(key, anchorEl) {
        const def = _defs[key];
        if (!def) return;
        const panel = document.getElementById('sec-cfg-panel');
        if (!panel) return;

        _currentKey = key;
        const btn = document.querySelector(`.sec-cfg-btn[data-sec-cfg="${key}"]`);
        if (btn) btn.classList.add('active');

        const basicHTML = (def.basic || []).map(_rowHTML).join('');
        let advHTML = '';
        if (def.advanced && def.advanced.length) {
            const groups = def.advanced.map(g => {
                const items = (g.items || []).map(_rowHTML).join('');
                const note = g.note ? `<div class="sec-cfg-group-note">${g.note}</div>` : '';
                return `<div class="sec-cfg-group">
                    <div class="sec-cfg-group-label">${g.group}</div>
                    ${items}
                    ${note}
                </div>`;
            }).join('');
            advHTML = `<button class="sec-cfg-adv-toggle" type="button">▶ Rozšířené nastavení</button>
                <div class="sec-cfg-adv" hidden>${groups}</div>`;
        }

        panel.innerHTML = `
            <div class="sec-cfg-header">
                <span>⚙ ${def.title}</span>
                <button class="sec-cfg-close" type="button" title="Zavřít">×</button>
            </div>
            <div class="sec-cfg-body">
                ${basicHTML}
                ${advHTML}
            </div>
            <div class="sec-cfg-footer">
                <button class="sec-cfg-reset" type="button" title="Vrátit všechna nastavení této sekce na výchozí">↺ Výchozí</button>
            </div>`;

        const allItems = _allItems(def);

        const applyChange = (item, value) => {
            _itemSet(item, value);
            applyDirtyIndicators();
            if (item.onchange) {
                item.onchange(value);
            } else if (item.expanded) {
                applyExpanded(key, item.key, item.default);
                if (window.FS25App && window.FS25App.rerender) window.FS25App.rerender();
                if (typeof relayoutMasonry === 'function') relayoutMasonry();
            } else {
                if (window.FS25App && window.FS25App.rerender) window.FS25App.rerender();
            }
        };

        panel.querySelectorAll('input[type="checkbox"][data-cfg-key]').forEach(cb => {
            cb.onchange = () => {
                const item = allItems.find(i => i.key === cb.dataset.cfgKey);
                if (item) applyChange(item, cb.checked);
            };
        });
        panel.querySelectorAll('select[data-cfg-key]').forEach(sel => {
            sel.onchange = () => {
                const item = allItems.find(i => i.key === sel.dataset.cfgKey);
                if (!item) return;
                // Coerce numeric option values back to number when default is numeric.
                const v = (typeof item.default === 'number') ? Number(sel.value) : sel.value;
                applyChange(item, v);
            };
        });

        const advToggle = panel.querySelector('.sec-cfg-adv-toggle');
        if (advToggle) {
            advToggle.onclick = () => {
                const adv = panel.querySelector('.sec-cfg-adv');
                const willOpen = adv.hidden;
                adv.hidden = !willOpen;
                advToggle.textContent = (willOpen ? '▼' : '▶') + ' Rozšířené nastavení';
                if (typeof relayoutMasonry === 'function') relayoutMasonry();
            };
        }

        // Reset to defaults — re-render the panel so checkboxes reflect new state.
        panel.querySelector('.sec-cfg-reset').onclick = () => {
            reset(key);
            _open(key, anchorEl);   // re-render panel in place
        };

        panel.querySelector('.sec-cfg-close').onclick = close;
        panel.hidden = false;
        _position(panel, anchorEl);
    }

    function _position(panel, anchorEl) {
        if (!anchorEl) return;
        const rect = anchorEl.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.zIndex   = '9999';

        const vw = document.documentElement.clientWidth;
        const panelW = 280;
        let left = rect.right - panelW;
        if (left < 8) left = 8;
        if (left + panelW > vw - 8) left = vw - panelW - 8;

        panel.style.left = left + 'px';
        panel.style.top  = (rect.bottom + 4) + 'px';

        // If panel overflows viewport bottom, flip above anchor
        requestAnimationFrame(() => {
            const vh  = document.documentElement.clientHeight;
            const pr  = panel.getBoundingClientRect();
            if (pr.bottom > vh - 8) {
                panel.style.top = (rect.top - pr.height - 4) + 'px';
            }
        });
    }

    window.SectionCfg = { define, init, toggle, close, reset, applyExpanded, applyAllExpanded, applyDirtyIndicators };
})();

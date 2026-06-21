// theme.js — dashboard theme picker (cycles through themes on click).
// Pre-paint application happens inline in each HTML's <head>.
// This script only handles the picker UI and persistence.

(function () {
    const THEMES = [
        { id: 'dark-green',    label: 'Tmavě zelená' },
        { id: 'dark-blue',     label: 'Tmavě modrá' },
        { id: 'light',         label: 'Světlá' },
        { id: 'high-contrast', label: 'Vysoký kontrast' },
        { id: 'fs25-native',   label: 'FS25 Native' },
    ];
    const STORAGE_KEY = 'fs25.dash.v1.theme';
    const ICONS = { 'dark-green': '🌿', 'dark-blue': '🌙', 'light': '☀️', 'high-contrast': '◐', 'fs25-native': '🚜' };

    function currentId() {
        return document.documentElement.getAttribute('data-theme') || 'dark-green';
    }

    function applyTheme(id) {
        // Normalise: only ever store/sync a known theme id. This collapses a
        // legacy-raw or JSON-over-encoded value back to a clean id, killing the
        // re-stringification loop that bloated the 'theme' key (raw write here vs
        // JSON write in serverSync added a quote layer every round-trip).
        if (!THEMES.some(t => t.id === id)) id = 'dark-green';
        document.documentElement.setAttribute('data-theme', id);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(id)); } catch (_) {}
        // Mirror theme choice to the server so other devices follow.
        if (window.ServerSync) window.ServerSync.syncWrite('theme', id);
        const btn = document.getElementById('theme-picker');
        if (btn) {
            btn.textContent = ICONS[id] || '🎨';
            const t = THEMES.find(x => x.id === id);
            btn.title = 'Téma: ' + (t ? t.label : id) + ' (kliknutím další)';
        }
    }

    function cycle() {
        const i = THEMES.findIndex(t => t.id === currentId());
        const next = THEMES[(i + 1) % THEMES.length].id;
        applyTheme(next);
    }

    function injectButton() {
        const status = document.querySelector('.nav-status');
        if (!status || document.getElementById('theme-picker')) return;

        const btn = document.createElement('button');
        btn.id = 'theme-picker';
        btn.className = 'theme-btn';
        btn.onclick = cycle;
        // Insert before the notification bell (which app.js appends to .nav-status)
        status.appendChild(btn);
        applyTheme(currentId());  // sets icon + title
    }

    document.addEventListener('DOMContentLoaded', injectButton);
})();

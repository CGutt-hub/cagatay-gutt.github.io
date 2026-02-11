// Theme toggle functionality with system preference as default
(function() {
    const THEME_KEY = 'theme-preference';
    
    // Get system preference
    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    // Get current theme (user preference or system default)
    function getCurrentTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        return stored || getSystemTheme();
    }
    
    // Apply theme to document
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }
    
    // Toggle theme
    function toggleTheme() {
        const current = getCurrentTheme();
        const newTheme = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, newTheme);
        applyTheme(newTheme);
    }
    
    // Initialize theme on page load
    document.addEventListener('DOMContentLoaded', function() {
        const theme = getCurrentTheme();
        applyTheme(theme);
        
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.addEventListener('click', toggleTheme);
        }
    });
    
    // Apply theme immediately to prevent flash
    applyTheme(getCurrentTheme());
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem(THEME_KEY)) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
})();

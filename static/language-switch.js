// Language switching functionality (English/German)
(function() {
    const LANG_KEY = 'language-preference';
    const DEFAULT_LANG = 'en';
    
    // Translation dictionary for static content
    const translations = {
        en: {
            'nav-home': 'home',
            'nav-cv': 'cv',
            'nav-publications': 'publications',
            'nav-projects': 'projects',
            'nav-blog': 'blog',
            'nav-contact': 'contact',
            'footer-info': 'This site syncs automatically with GitHub (projects) and ORCID (publications). Last build:',
            'lang-toggle-title': 'Switch to German',
            'theme-toggle-title-dark': 'Switch to light mode',
            'theme-toggle-title-light': 'Switch to dark mode'
        },
        de: {
            'nav-home': 'startseite',
            'nav-cv': 'lebenslauf',
            'nav-publications': 'publikationen',
            'nav-projects': 'projekte',
            'nav-blog': 'blog',
            'nav-contact': 'kontakt',
            'footer-info': 'Diese Seite synchronisiert sich automatisch mit GitHub (Projekte) und ORCID (Publikationen). Letzter Build:',
            'lang-toggle-title': 'Zu Englisch wechseln',
            'theme-toggle-title-dark': 'Zum Hellen Modus wechseln',
            'theme-toggle-title-light': 'Zum Dunklen Modus wechseln'
        }
    };
    
    // Get current language
    function getCurrentLanguage() {
        return localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
    }
    
    // Apply language
    function applyLanguage(lang) {
        document.documentElement.setAttribute('lang', lang);
        
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(function(element) {
            const key = element.getAttribute('data-i18n');
            if (translations[lang] && translations[lang][key]) {
                element.textContent = translations[lang][key];
            }
        });
        
        // Update language toggle button
        const toggle = document.getElementById('lang-toggle');
        if (toggle) {
            toggle.textContent = lang === 'en' ? 'DE' : 'EN';
            toggle.setAttribute('aria-label', translations[lang]['lang-toggle-title']);
        }
    }
    
    // Toggle language
    function toggleLanguage() {
        const current = getCurrentLanguage();
        const newLang = current === 'en' ? 'de' : 'en';
        localStorage.setItem(LANG_KEY, newLang);
        applyLanguage(newLang);
    }
    
    // Initialize language on page load
    document.addEventListener('DOMContentLoaded', function() {
        const lang = getCurrentLanguage();
        applyLanguage(lang);
        
        const toggle = document.getElementById('lang-toggle');
        if (toggle) {
            toggle.addEventListener('click', toggleLanguage);
        }
    });
    
    // Apply language immediately
    applyLanguage(getCurrentLanguage());
})();

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle functionality
    const themeToggle = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;

    // Language toggle functionality
    const languageToggle = document.getElementById('language-toggle');

    // Load saved theme preference or default to dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    htmlElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // Load saved language preference or default to EN
    let savedLanguage = localStorage.getItem('language') || 'en';
    updateLanguageLabel(savedLanguage);

    // Theme toggle event listener
    themeToggle.addEventListener('click', () => {
        const currentTheme = htmlElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });

    // Language toggle event listener
    languageToggle.addEventListener('click', () => {
        const currentLanguage = localStorage.getItem('language') || 'en';
        const newLanguage = currentLanguage === 'en' ? 'de' : 'en';
        localStorage.setItem('language', newLanguage);
        updateLanguageLabel(newLanguage);
        // In a full implementation, this would reload the page with the new language
        // For now, we just update the button label
        alert(`Language switching to ${newLanguage.toUpperCase()} - Full i18n implementation required`);
    });

    function updateThemeIcon(theme) {
        themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        themeToggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    }

    function updateLanguageLabel(language) {
        languageToggle.textContent = language.toUpperCase();
        languageToggle.setAttribute('aria-label', `Switch to ${language === 'en' ? 'German' : 'English'}`);
    }
});

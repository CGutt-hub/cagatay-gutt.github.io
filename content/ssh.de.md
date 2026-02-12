+++
title = "SSH-Zugang"
+++

## Zero Trust SSH Bastion

Greifen Sie sicher über den Browser auf Ihren Server zu – mit Cloudflare Zero Trust.

<div class="ssh-access-card">
    <h3>🔐 Browser-basiertes SSH Terminal</h3>
    <p>Klicken Sie unten, um eine sichere SSH-Sitzung direkt in Ihrem Browser zu öffnen. Die Authentifizierung erfolgt über Cloudflare Access.</p>
    <a href="#" class="ssh-button ssh-disabled" onclick="alert('SSH-Endpunkt noch nicht konfiguriert. Schauen Sie bald wieder vorbei!'); return false;">
        SSH Terminal starten
    </a>
    <p class="ssh-note"><em>🚧 Demnächst verfügbar - SSH-Endpunkt wird konfiguriert.</em></p>
</div>

---

### So funktioniert es

Dieser SSH-Bastion verwendet **Cloudflare Zero Trust** für sicheren, browserbasierten Zugriff auf Remote-Server:

1. **Zero Trust Architektur**: Kein VPN erforderlich - Authentifizierung erfolgt an der Edge
2. **Browser-basiertes Terminal**: Vollständiges SSH-Terminal direkt im Browser
3. **Identitätsbasierter Zugriff**: Nur autorisierte Benutzer können sich verbinden
4. **Audit-Protokollierung**: Alle Sitzungen werden für Sicherheitszwecke protokolliert

### Voraussetzungen

- Autorisierte E-Mail/Identität in Cloudflare Access
- Moderner Webbrowser (Chrome, Firefox, Safari, Edge)
- Gültige Anmeldedaten für den Zielserver

---

### Sicherheitsfunktionen

| Funktion | Beschreibung |
|----------|--------------|
| **MFA-Unterstützung** | Multi-Faktor-Authentifizierung über Identity Provider |
| **Sitzungsaufzeichnung** | Optionale Sitzungserfassung für Audit-Zwecke |
| **Kurzlebige Zertifikate** | Automatische Zertifikatsrotation |
| **IP-Einschränkungen** | Optionale geo/IP-basierte Zugriffsregeln |

<style>
.ssh-access-card {
    background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
    border-radius: 12px;
    padding: 2rem;
    margin: 2rem 0;
    text-align: center;
    color: #fff;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

.ssh-access-card h3 {
    margin-top: 0;
    color: #fff;
}

.ssh-button {
    display: inline-block;
    background: #f6821f;
    color: #fff !important;
    padding: 1rem 2rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: bold;
    font-size: 1.1rem;
    margin: 1rem 0;
    transition: all 0.3s ease;
}

.ssh-button:hover {
    background: #ff9633;
    transform: translateY(-2px);
    box-shadow: 0 4px 15px rgba(246, 130, 31, 0.4);
}

.ssh-note {
    font-size: 0.9rem;
    opacity: 0.9;
    margin-bottom: 0;
}
</style>

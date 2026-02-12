+++
title = "SSH Access"
+++

## Zero Trust SSH Bastion

Access your server securely through the browser using Cloudflare Zero Trust.

<div class="ssh-access-card">
    <h3>🔐 Browser-Based SSH Terminal</h3>
    <p>Click below to open a secure SSH session directly in your browser. Authentication is handled through Cloudflare Access.</p>
    <a href="#" class="ssh-button ssh-disabled" onclick="alert('SSH endpoint not configured yet. Check back soon!'); return false;">
        Launch SSH Terminal
    </a>
    <p class="ssh-note"><em>🚧 Coming soon - SSH endpoint is being configured.</em></p>
</div>

---

### How It Works

This SSH bastion uses **Cloudflare Zero Trust** to provide secure, browser-based access to remote servers:

1. **Zero Trust Architecture**: No VPN required - authentication happens at the edge
2. **Browser-Based Terminal**: Full SSH terminal rendered directly in your browser
3. **Identity-Aware Access**: Only authorized users can connect
4. **Audit Logging**: All sessions are logged for security compliance

### Requirements

- Authorized email/identity in Cloudflare Access
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Valid credentials for the target server

---

### Security Features

| Feature | Description |
|---------|-------------|
| **MFA Support** | Multi-factor authentication via identity provider |
| **Session Recording** | Optional session capture for audit purposes |
| **Short-Lived Certificates** | Automatic certificate rotation |
| **IP Restrictions** | Optional geo/IP-based access rules |

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

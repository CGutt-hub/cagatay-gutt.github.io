# Cloudflare Zero Trust SSH Bastion Setup Guide

This guide walks you through setting up browser-based SSH access to your VPS using Cloudflare Zero Trust.

## Prerequisites

- A Cloudflare account (free tier works)
- A domain managed by Cloudflare
- SSH access to your VPS
- Root/sudo privileges on the VPS

## Step 1: Create a Cloudflare Tunnel on Your VPS

### Install cloudflared

**Debian/Ubuntu:**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**RHEL/CentOS:**
```bash
curl -L --output cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.rpm
sudo rpm -i cloudflared.rpm
```

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

### Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser to authenticate with your Cloudflare account.

### Create the Tunnel

```bash
cloudflared tunnel create ssh-bastion
```

Note the tunnel ID that's returned (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

## Step 2: Configure the Tunnel

Create the configuration file:

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Add this configuration:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: ssh.yourdomain.com
    service: ssh://localhost:22
  - service: http_status:404
```

Replace:
- `YOUR_TUNNEL_ID` with your actual tunnel ID
- `ssh.yourdomain.com` with your desired subdomain

### Create DNS Record

```bash
cloudflared tunnel route dns ssh-bastion ssh.yourdomain.com
```

## Step 3: Configure Cloudflare Zero Trust Dashboard

### Enable Browser-Based SSH

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com)
2. Navigate to **Access** → **Applications**
3. Click **Add an application** → **Self-hosted**
4. Configure:
   - **Application name**: SSH Bastion
   - **Session Duration**: 24 hours (or your preference)
   - **Application domain**: `ssh.yourdomain.com`

5. Under **Application settings**, enable:
   - ✅ **Enable browser rendering** (for SSH)

6. Create an **Access Policy**:
   - **Policy name**: Allow Authorized Users
   - **Action**: Allow
   - **Include rules**: 
     - Emails: `your-email@example.com`
     - Or: Email domain: `yourdomain.com`
     - Or: Identity provider group

7. Save the application

### Configure SSH Short-Lived Certificates (Optional but Recommended)

1. In Zero Trust Dashboard, go to **Access** → **Service Auth**
2. Click **SSH** tab
3. **Generate certificate** for your application
4. Add the public key to your server:

```bash
# On your VPS, edit sshd_config
sudo nano /etc/ssh/sshd_config

# Add these lines:
PubkeyAuthentication yes
TrustedUserCAKeys /etc/ssh/ca.pub
```

5. Save the CA public key:
```bash
echo "YOUR_CA_PUBLIC_KEY" | sudo tee /etc/ssh/ca.pub
sudo systemctl restart sshd
```

## Step 4: Start the Tunnel

### Run as a service (recommended)

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### Or run manually (for testing)

```bash
cloudflared tunnel run ssh-bastion
```

## Step 5: Update Your Website

Update the SSH page on your website by replacing `YOUR_DOMAIN.com` with your actual domain in:

- `content/ssh.md`
- `content/ssh.de.md`

Replace:
```html
<a href="https://ssh.YOUR_DOMAIN.com" ...>
```

With your actual URL:
```html
<a href="https://ssh.yourdomain.com" ...>
```

## Testing

1. Visit `https://ssh.yourdomain.com` in your browser
2. Authenticate via Cloudflare Access
3. You should see a browser-based SSH terminal
4. Log in with your VPS credentials

## Troubleshooting

### Tunnel not connecting
```bash
# Check tunnel status
cloudflared tunnel info ssh-bastion

# Check logs
sudo journalctl -u cloudflared -f
```

### Access denied errors
- Verify your email is in the Access policy
- Check that the application domain matches exactly
- Ensure browser rendering is enabled for SSH

### SSH connection refused
```bash
# Verify SSH is running
sudo systemctl status sshd

# Check if cloudflared can reach SSH locally
curl -v localhost:22
```

## Security Best Practices

1. **Use short-lived certificates** instead of static SSH keys
2. **Enable MFA** in your identity provider
3. **Restrict IP ranges** if accessing from known locations
4. **Enable session recording** for audit compliance
5. **Set appropriate session timeouts**
6. **Use Access Groups** for team management

## Architecture Overview

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Browser    │────▶│ Cloudflare Edge │────▶│   cloudflared│
│  (Your Site) │     │  (Zero Trust)   │     │   (Your VPS) │
└──────────────┘     └─────────────────┘     └──────────────┘
                            │
                     ┌──────▼──────┐
                     │   Identity  │
                     │   Provider  │
                     │ (IdP/Email) │
                     └─────────────┘
```

## Resources

- [Cloudflare Zero Trust Docs](https://developers.cloudflare.com/cloudflare-one/)
- [Browser SSH Rendering](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/use-cases/ssh/browser-rendered-terminal/)
- [cloudflared GitHub](https://github.com/cloudflare/cloudflared)

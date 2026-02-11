# Zola GitHub Pages Site - Scientific Hub

This is a static website built with [Zola](https://www.getzola.org/) that automatically syncs content from your scientific profiles.

## Automatic Content Updates

The site **automatically pulls data** from:
- **GitHub** — Your repositories and code projects
- **OSF** — Research projects and data
- **ORCID** — Publications and works

You don't need to manually update the website! When you push to GitHub, the deployment workflow automatically:
1. Fetches latest data from GitHub, OSF, and ORCID APIs
2. Generates a projects page with your repositories and research
3. Builds and deploys the site

## Manual Updates (Optional)

To preview updates locally before they deploy:

```powershell
.\update.ps1
```

This will fetch data and rebuild the site locally.

## Local Development

1. Make content changes in `content/` folder (home page, research page)
2. Run `zola serve` to preview at http://127.0.0.1:1111
3. Push to GitHub — the rest happens automatically!

## Deployment

The site automatically deploys to GitHub Pages when you push to the `main` branch.

### Repository Visibility Requirements

**Important:** GitHub Pages visibility depends on your account type:

- **Free GitHub Account:** Repository MUST be **public** for GitHub Pages to work
- **GitHub Pro/Team/Enterprise:** Repository CAN be **private** and still use GitHub Pages

If you have a free account and want to keep your repository private, you'll need to either:
1. Upgrade to GitHub Pro ($4/month as of 2024), or
2. Keep the repository public

**Current Status:** Based on the workflow runs, your repository appears to be **public** and GitHub Pages is working correctly.

### Custom Domain Setup (cagatay.gutt.github.io)

This site is configured to use the custom domain **cagatay.gutt.github.io**. 

#### GitHub Configuration (Already Done ✓)
- CNAME file has been added to `static/CNAME`
- Base URL is set to `https://cagatay.gutt.github.io` in config files

#### DNS Configuration Required

**IMPORTANT:** To use `cagatay.gutt.github.io` as your custom domain, you must own and control the DNS for the domain `gutt.github.io`.

**Note:** `github.io` is GitHub's top-level domain, so `gutt.github.io` would only work if you have registered it as a GitHub Pages user site. This is an unusual setup.

**If you own `gutt.github.io`:**

Add a CNAME record in your DNS settings:
- **Type:** CNAME
- **Name:** cagatay
- **Value:** cgutt-hub.github.io.
- **TTL:** 3600 (or your provider's default)

**If you own a different domain (e.g., `gutt.com`):**

You would use `cagatay.gutt.com` instead. Update the CNAME file to match your actual domain, and configure:
- **Type:** CNAME
- **Name:** cagatay
- **Value:** cgutt-hub.github.io.
- **TTL:** 3600

#### Verify Custom Domain in GitHub

After DNS is configured:
1. Go to your repository Settings → Pages
2. Under "Custom domain", enter: `cagatay.gutt.github.io`
3. Click Save
4. Wait for DNS check to pass (can take a few minutes to 48 hours)
5. Enable "Enforce HTTPS" once DNS is verified

Your site will be accessible at: **https://cagatay.gutt.github.io**

### Alternative: Use Standard GitHub Pages URL

If you prefer not to set up a custom domain, you can use the standard GitHub Pages URL by:
1. Removing `static/CNAME`
2. Changing `base_url` in `config.toml` to `https://cgutt-hub.github.io/cagatay-gutt.github.io`
3. Site will be at: https://cgutt-hub.github.io/cagatay-gutt.github.io

## Project Structure

- `config.toml` - Site configuration
- `content/` - Markdown content files
- `templates/` - HTML templates
- `static/` - Static assets (CSS, images, etc.)
- `sass/` - Sass files for styling (optional)
- `public/` - Generated site (don't commit this)

## Customization

- Edit `config.toml` to change site settings
- Modify templates in `templates/` to change the layout
- Add content in `content/` as Markdown files
- Update styles in `static/style.css`

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

### GitHub Pages URL

This site is configured to use the **FREE standard GitHub Pages URL**:

**https://cgutt-hub.github.io/cagatay-gutt.github.io**

✅ **Completely FREE** - No domain purchase required  
✅ **No DNS configuration** - Works immediately after deployment  
✅ **Simple setup** - Just merge to main and it's live!

#### How to Deploy

1. **Merge to main branch** - The pull request will trigger GitHub Actions
2. **Wait for build** - GitHub Actions will automatically:
   - Fetch data from your GitHub, OSF, and ORCID profiles
   - Build the site with Zola
   - Deploy to the `gh-pages` branch
3. **Site is live!** - Your website will be accessible at the URL above

#### Custom Domain (Optional)

If you want to use a custom domain like `www.your-domain.com`:

1. **Purchase a domain** from a registrar (Namecheap, Google Domains, etc.) - ~$10-15/year
2. **Add CNAME file** to `static/CNAME` with your domain name
3. **Update base_url** in `config.toml` to match your domain
4. **Configure DNS** - Add a CNAME record pointing to `cgutt-hub.github.io`
5. **Enable in GitHub** - Go to Settings → Pages and enter your custom domain

For most users, the free GitHub Pages URL works perfectly!

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

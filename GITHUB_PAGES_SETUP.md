# GitHub Pages Setup Guide

This guide will help you configure GitHub Pages to work with this repository.

## Prerequisites

- Repository must be **public** (for free GitHub accounts) or you have GitHub Pro/Team/Enterprise
- You must have admin access to the repository

## Step-by-Step Setup

### 1. Navigate to Repository Settings

1. Go to your repository on GitHub: https://github.com/CGutt-hub/cagatay-gutt.github.io
2. Click on **Settings** (gear icon in the top menu)

### 2. Configure GitHub Pages

1. In the left sidebar, scroll down and click on **Pages**
2. Under **Source**, select **GitHub Actions** from the dropdown
3. That's it! No need to select a branch or folder

### 3. Verify the Workflow

1. Go to the **Actions** tab in your repository
2. You should see a workflow named "Build and Deploy"
3. If the workflow hasn't run yet, you can trigger it manually:
   - Click on "Build and Deploy" in the workflows list
   - Click "Run workflow" button
   - Select the `main` branch
   - Click "Run workflow"

### 4. Access Your Website

Once the workflow completes successfully:

1. Go back to **Settings → Pages**
2. You'll see a message: "Your site is live at https://cgutt-hub.github.io/cagatay-gutt.github.io"
3. Click the link to view your website!

## How It Works

### Automatic Deployment

Every time you push to the `main` branch:

1. GitHub Actions automatically triggers the workflow
2. The workflow:
   - Checks out your code
   - Fetches data from GitHub API, ORCID, etc.
   - Builds your Zola static site
   - Deploys it to GitHub Pages
3. Your website updates automatically (usually within 1-2 minutes)

### Manual Deployment

You can also trigger a deployment manually:

1. Go to **Actions** tab
2. Click "Build and Deploy" workflow
3. Click "Run workflow"
4. Select `main` branch
5. Click "Run workflow"

## Troubleshooting

### Website Not Updating?

1. **Check the workflow status:**
   - Go to **Actions** tab
   - Look for a green checkmark ✓ (success) or red X (failure)
   - If failed, click on the workflow run to see error details

2. **Check GitHub Pages status:**
   - Go to **Settings → Pages**
   - Verify "Source" is set to "GitHub Actions"
   - Check if there's a deployment URL shown

3. **Clear browser cache:**
   - Press `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
   - Or try opening in incognito/private browsing mode

### Build Failing?

Common issues and solutions:

1. **Zola syntax errors:**
   - Check the workflow logs in Actions tab
   - Look for Zola error messages
   - Fix the syntax in your markdown files

2. **Python script errors:**
   - Check if `scripts/fetch_data.py` is running correctly
   - Verify API credentials if using private data sources

3. **Permissions issues:**
   - The workflow should have `pages: write` permission
   - This is automatically granted when using GitHub Actions as source

### Still Having Issues?

1. Check the full workflow logs in the Actions tab
2. Look for the specific error message
3. Common fixes:
   - Ensure repository is public
   - Verify workflow file is in `.github/workflows/`
   - Check that all required files exist

## Advanced Configuration

### Custom Domain

To use a custom domain (e.g., www.example.com):

1. Create a file `static/CNAME` with your domain name
2. Update `base_url` in `config.toml` to your custom domain
3. Configure DNS at your domain registrar:
   - Add a CNAME record pointing to `cgutt-hub.github.io`
4. In **Settings → Pages**, add your custom domain under "Custom domain"

### Workflow Customization

The workflow file is located at `.github/workflows/deploy.yml`

You can customize:
- Build steps
- Data fetching scripts
- Zola version
- Python version

**Note:** Be careful when editing the workflow. Test changes on a branch first!

## Security

### Permissions

The workflow uses minimal required permissions:
- `contents: read` - Read repository code
- `pages: write` - Deploy to GitHub Pages
- `id-token: write` - Required for Pages deployment

### Secrets

The workflow uses `GITHUB_TOKEN` which is automatically provided by GitHub.
No manual secret configuration is needed.

## Additional Resources

- [Zola Documentation](https://www.getzola.org/documentation/)
- [GitHub Pages Documentation](https://docs.github.com/pages)
- [GitHub Actions Documentation](https://docs.github.com/actions)
- [Repository README](README.md) - For development and content editing

## Support

If you encounter issues:
1. Check the workflow logs in Actions tab
2. Review this guide and the README
3. Open an issue in the repository with the error details

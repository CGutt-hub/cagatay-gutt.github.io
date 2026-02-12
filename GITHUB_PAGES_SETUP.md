# GitHub Pages Setup Guide

This guide will help you configure GitHub Pages to work with this repository.

## Quick Setup Checklist ✅

Before you start, here's everything you need to configure in GitHub Settings:

### Required Settings
- [ ] **Pages → Source**: Set to "GitHub Actions" (not "Deploy from a branch")
- [ ] **General → Visibility**: Repository must be Public
- [ ] **Actions → Workflow**: First deployment must complete successfully

### Recommended Settings
- [ ] **Pages → Enforce HTTPS**: Enable after first deployment (security)
- [ ] **General → Description**: Add repository description
- [ ] **General → Website**: Add your Pages URL

### Optional Settings
- [ ] **Pages → Custom Domain**: Only if using your own domain
- [ ] **Environments → github-pages**: Review deployment history
- [ ] **Branches → Protection Rules**: Protect main branch (advanced)

## Prerequisites

- Repository must be **public** (for free GitHub accounts) or you have GitHub Pro/Team/Enterprise
- You must have admin access to the repository

## Step-by-Step Setup

### 1. Navigate to Repository Settings

1. Go to your repository on GitHub: https://github.com/CGutt-hub/cagatay-gutt.github.io
2. Click on **Settings** (gear icon in the top menu)

### 2. Configure GitHub Pages

When you open the Pages settings, you'll see several configuration options. Here's what you need to set:

#### A. Build and Deployment Source ⭐ REQUIRED

1. In the left sidebar, scroll down and click on **Pages**
2. Under **Source**, select **GitHub Actions** from the dropdown
   - This tells GitHub to use the workflow in `.github/workflows/deploy.yml`
   - ⚠️ Do NOT select "Deploy from a branch" - that's the old method

#### B. Additional Settings (In the same Pages section)

After setting the source, scroll down to see additional options:

**Custom Domain** (Optional)
- Leave empty if you want to use the default: `cgutt-hub.github.io/cagatay-gutt.github.io`
- To add a custom domain: Enter your domain (e.g., `www.example.com`) and follow DNS setup instructions
- See "Custom Domain" section below for detailed setup

**Enforce HTTPS** ✅ RECOMMENDED
- This option appears after your first successful deployment
- ✅ **Check this box** to force HTTPS for security
- This is automatically enabled for `github.io` domains

#### C. Repository Settings to Verify

While in Settings, also check these:

**General Settings:**
1. **Repository Visibility**: Must be **Public** (for free GitHub accounts)
   - Go to **Settings** → **General** → scroll to "Danger Zone"
   - Verify it says "This repository is currently public"

**Environments:** (Auto-created by workflow)
1. Navigate to **Settings** → **Environments**
2. You should see a `github-pages` environment after first deployment
3. No action needed - this is created automatically by the workflow

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

## Complete Settings Reference

This section explains every setting you'll encounter in GitHub Settings related to Pages.

### Settings → Pages (Main Configuration)

#### Build and Deployment

**Source** ⭐ REQUIRED
- **What it does**: Tells GitHub how to build and deploy your site
- **What to select**: "GitHub Actions"
- **Why**: This uses the modern workflow method defined in `.github/workflows/deploy.yml`
- **Don't select**: "Deploy from a branch" (legacy method)

**Branch** (Only shown when "Deploy from a branch" is selected)
- **N/A for this project** - We use GitHub Actions, not branch deployment

#### Custom Domain (Optional)

**Custom domain** 
- **What it does**: Allows using your own domain instead of github.io
- **Default**: Leave empty to use `cgutt-hub.github.io/cagatay-gutt.github.io`
- **To use custom domain**:
  1. Enter your domain (e.g., `www.mysite.com`)
  2. Create `static/CNAME` file with your domain
  3. Update `base_url` in `config.toml`
  4. Configure DNS with your registrar (see Advanced Configuration)

**Enforce HTTPS** ✅ RECOMMENDED
- **What it does**: Forces all traffic to use secure HTTPS
- **Default**: Automatically enabled for `*.github.io` domains
- **When to enable**: After first successful deployment
- **Why**: Security best practice - protects visitors

#### Deployment Status

**Your site is live at [URL]**
- **When visible**: After first successful deployment
- **What it shows**: Your website URL
- **Deployment history**: Click "View deployments" to see past builds

### Settings → General

#### Repository Details

**Description** ✅ RECOMMENDED
- **What to add**: Brief description of your site
- **Example**: "Personal academic website built with Zola"
- **Why**: Helps visitors understand your project

**Website** ✅ RECOMMENDED  
- **What to add**: Your GitHub Pages URL
- **Value**: `https://cgutt-hub.github.io/cagatay-gutt.github.io`
- **Why**: Provides quick access link from repository

**Topics** (Optional)
- **What to add**: Tags like `personal-website`, `zola`, `github-pages`
- **Why**: Makes repository discoverable

#### Visibility & Access

**Repository visibility** ⭐ REQUIRED
- **Current**: Must be "Public"
- **Why**: Free GitHub accounts require public repos for Pages
- **Location**: Settings → General → Danger Zone

### Settings → Environments

**github-pages Environment** (Auto-created)
- **What it is**: Auto-created after first successful deployment
- **What it shows**: Deployment history and protection rules
- **No action needed**: Automatically managed by workflow
- **Can view**: Recent deployments and their status

#### Environment Settings (Advanced, Optional)

**Deployment branches**
- **Default**: Only `main` branch can deploy
- **To modify**: Add/remove branches that can trigger deployments

**Environment protection rules** (Optional)
- **Required reviewers**: Require approval before deployment
- **Wait timer**: Add delay before deployment
- **Custom deployment branches**: Limit which branches can deploy

### Settings → Actions → General

**Workflow permissions** (Usually correct by default)
- **Required**: "Read and write permissions" 
- **Or**: "Read repository contents and packages permissions" with Pages checked
- **Why**: Workflow needs permissions to deploy to Pages

**Actions permissions**
- **Should be**: "Allow all actions and reusable workflows"
- **Why**: Workflow uses external actions like `actions/checkout@v4`

### Settings → Branches (Optional but Recommended)

**Branch protection rules for `main`** (Optional)
- **Why**: Prevents accidental changes to main branch
- **Common rules**:
  - Require pull request reviews before merging
  - Require status checks to pass before merging
  - Require conversation resolution before merging

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

## Quick Reference Card

Use this checklist when setting up GitHub Pages:

```
GITHUB PAGES SETUP - QUICK REFERENCE
═══════════════════════════════════════════════════════════

📍 NAVIGATION
   Settings → Pages (main configuration)
   Settings → General (repository details)
   Settings → Environments (deployment history)
   Settings → Actions (permissions)

⭐ REQUIRED SETTINGS
   ✓ Pages → Source: "GitHub Actions" 
   ✓ General → Visibility: Public
   ✓ First workflow run must complete successfully

✅ RECOMMENDED SETTINGS  
   ✓ Pages → Enforce HTTPS: Checked (after first deploy)
   ✓ General → Description: Add site description
   ✓ General → Website: https://cgutt-hub.github.io/cagatay-gutt.github.io

📊 VERIFY AFTER FIRST DEPLOYMENT
   ✓ Pages → "Your site is live at..." message appears
   ✓ Environments → "github-pages" environment exists
   ✓ Actions → "Build and Deploy" workflow succeeded (green ✓)
   ✓ Visit your site URL to confirm it's working

🔧 OPTIONAL ADVANCED SETTINGS
   □ Pages → Custom domain (only if using your domain)
   □ Branches → Branch protection rules  
   □ Environments → Deployment protection rules

⚠️  COMMON MISTAKES TO AVOID
   ✗ DON'T select "Deploy from a branch" as source
   ✗ DON'T make repository private (unless you have Pro)
   ✗ DON'T forget to enable "Enforce HTTPS"
   ✗ DON'T skip the first workflow run

🆘 TROUBLESHOOTING CHECKLIST
   1. Is repository visibility set to Public?
   2. Is Pages source set to "GitHub Actions"?
   3. Did the workflow run successfully? (Check Actions tab)
   4. Did you wait 1-2 minutes after deployment?
   5. Did you clear browser cache (Ctrl+Shift+R)?

📱 WHERE TO FIND THINGS
   Deployment URL: Settings → Pages (top of page)
   Workflow logs: Actions → "Build and Deploy" → Latest run
   Deployment history: Settings → Environments → github-pages
   Site status: Settings → Pages → "Your site is live at..."
```

## Support

If you encounter issues:
1. Check the workflow logs in Actions tab
2. Review this guide and the README
3. Open an issue in the repository with the error details

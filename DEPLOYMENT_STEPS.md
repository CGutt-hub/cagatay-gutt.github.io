# 🚀 Deployment Steps for cagatay.gutt.github.io

This document provides step-by-step instructions to get your website online at https://cagatay.gutt.github.io

## ✅ What's Already Done (By GitHub Copilot)

- ✅ Added `static/CNAME` file containing `cagatay.gutt.github.io`
- ✅ Updated `config.toml` with base_url: `https://cagatay.gutt.github.io`
- ✅ Fixed Zola configuration syntax
- ✅ Removed duplicate `zola.toml` file
- ✅ Verified build works correctly
- ✅ All changes committed to `copilot/get-webpage-online` branch

## 📋 What You Need to Do (Step-by-Step)

### Step 1: Configure DNS ⚙️

**IMPORTANT:** You need to own and control the domain `gutt.github.io` for this to work.

#### If you own `gutt.github.io`:

1. Log into your DNS provider (where you registered `gutt.github.io`)
2. Navigate to DNS settings
3. Add a new CNAME record:
   - **Type:** CNAME
   - **Name:** `cagatay` (or `cagatay.gutt` depending on your DNS provider)
   - **Value:** `cgutt-hub.github.io.` (note the trailing dot)
   - **TTL:** 3600 (or leave default)
4. Save the record

#### If you own a different domain (e.g., `gutt.com`):

You would need to update the CNAME file to match. Let me know if this is your situation.

#### If you don't own any domain:

See "Alternative Option" at the bottom of this document.

---

### Step 2: Merge This PR to Main Branch 🔀

1. Go to: https://github.com/CGutt-hub/cagatay-gutt.github.io/pulls
2. Find the pull request titled "Configure GitHub Pages with custom domain cagatay.gutt.github.io"
3. Review the changes if you wish
4. Click the green **"Merge pull request"** button
5. Confirm by clicking **"Confirm merge"**

**What happens:** This triggers the GitHub Actions workflow which will:
- Fetch data from your scientific profiles (GitHub, OSF, ORCID)
- Build the site with Zola
- Deploy to the `gh-pages` branch
- Make the site available at your custom domain

---

### Step 3: Enable Custom Domain in GitHub Settings 🌐

1. Go to: https://github.com/CGutt-hub/cagatay-gutt.github.io/settings/pages
2. Under "Custom domain", enter: `cagatay.gutt.github.io`
3. Click **Save**
4. Wait for the DNS check to complete (you'll see a green checkmark when ready)
   - This can take from a few minutes to 48 hours depending on DNS propagation
   - If it fails, verify your DNS record from Step 1

---

### Step 4: Enable HTTPS 🔒

1. Once the DNS check passes (green checkmark appears)
2. Check the box for **"Enforce HTTPS"**
3. Your site will now be served securely via HTTPS

---

## 🎉 Your Website Will Be Live!

Once all steps are complete, your website will be accessible at:

**https://cagatay.gutt.github.io**

## ⚠️ Important Notes

### Repository Visibility

- **Free GitHub Account:** Your repository MUST be public
- **GitHub Pro/Team/Enterprise:** Repository can be private

Current status: Your repository appears to be public ✅

### DNS Propagation Time

DNS changes can take time to propagate globally:
- Minimum: A few minutes
- Maximum: Up to 48 hours
- Average: 1-2 hours

### Troubleshooting

**If DNS check fails:**
1. Verify your CNAME record is correct
2. Use a DNS lookup tool to check: `nslookup cagatay.gutt.github.io`
3. Wait longer (DNS can be slow)
4. Check for typos in the CNAME record

**If site doesn't load:**
1. Check GitHub Actions workflow completed successfully
2. Verify the `gh-pages` branch exists and has content
3. Clear your browser cache
4. Try accessing in incognito/private mode

---

## 🔄 Alternative Option: Use Standard GitHub Pages URL

If you prefer NOT to use a custom domain or don't own `gutt.github.io`:

1. Delete the `static/CNAME` file
2. Update `config.toml` base_url to: `https://cgutt-hub.github.io/cagatay-gutt.github.io`
3. Commit and merge
4. Your site will be at: https://cgutt-hub.github.io/cagatay-gutt.github.io

---

## 📞 Need Help?

If you encounter issues:
1. Check GitHub Actions logs for build errors
2. Verify DNS settings with your provider
3. Check GitHub Pages settings are correct
4. Open an issue in the repository

---

**Good luck! Your website is ready to go live! 🚀**

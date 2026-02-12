# GitHub Settings Walkthrough

This document provides a step-by-step walkthrough of every setting you need to configure in GitHub.

## Part 1: Repository Settings → Pages

### How to Get There
1. Go to https://github.com/CGutt-hub/cagatay-gutt.github.io
2. Click the **Settings** tab (⚙️ gear icon)
3. In the left sidebar, scroll down to **Pages**

### What You'll See

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Pages                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Build and deployment                                    │
│                                                         │
│ Source                                                  │
│ ┌─────────────────────────────────┐                    │
│ │ GitHub Actions                  ▼│  ← SELECT THIS    │
│ └─────────────────────────────────┘                    │
│                                                         │
│ ⚠️ Options:                                             │
│   • Deploy from a branch  ← DON'T USE (legacy)         │
│   • GitHub Actions        ← USE THIS ✓                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Custom domain                         [Optional]       │
│ ┌─────────────────────────────────────────────┐        │
│ │                                             │        │
│ └─────────────────────────────────────────────┘        │
│ Leave empty to use default URL                         │
│                                                         │
│ ☐ Enforce HTTPS                      ← CHECK THIS      │
│   (Appears after first deployment)                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Step-by-Step Configuration

**Step 1: Set Source to GitHub Actions**
- [ ] Click the "Source" dropdown
- [ ] Select "GitHub Actions" (NOT "Deploy from a branch")
- [ ] The page will show "GitHub Actions" is now selected

**Step 2: Custom Domain (Optional)**
- [ ] Leave empty if using default `cgutt-hub.github.io/cagatay-gutt.github.io`
- [ ] Only fill if you own a domain and want to use it

**Step 3: Enforce HTTPS (After First Deployment)**
- [ ] Wait for first deployment to complete
- [ ] Return to this page
- [ ] Check the "Enforce HTTPS" box
- [ ] This ensures secure connections

### After First Deployment

The page will change to show:

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Pages                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ✓ Your site is live at                                 │
│   https://cgutt-hub.github.io/cagatay-gutt.github.io   │
│                                                         │
│   Visit site → [button]                                │
│                                                         │
│   Last deployed by github-actions                      │
│   [timestamp]                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Part 2: Repository Settings → General

### How to Get There
1. Click **Settings** tab
2. Stay on **General** (it's the default view)

### Key Settings to Configure

```
┌─────────────────────────────────────────────────────────┐
│ General                                                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Repository name                                         │
│ cagatay-gutt.github.io                                  │
│                                                         │
│ Description (optional) ← ADD THIS                       │
│ ┌─────────────────────────────────────────────┐        │
│ │ Personal academic website built with Zola  │        │
│ └─────────────────────────────────────────────┘        │
│                                                         │
│ Website ← ADD THIS                                      │
│ ┌─────────────────────────────────────────────┐        │
│ │ https://cgutt-hub.github.io/...             │        │
│ └─────────────────────────────────────────────┘        │
│                                                         │
│ Topics ← OPTIONAL                                       │
│ [github-pages] [zola] [personal-website]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What to Add:**

**Description** ✅ Recommended
- [ ] Click in the Description field
- [ ] Add: "Personal academic website built with Zola"
- [ ] Or customize to your preference
- [ ] Click "Save" (if button appears)

**Website** ✅ Recommended
- [ ] Click in the Website field  
- [ ] Add: `https://cgutt-hub.github.io/cagatay-gutt.github.io`
- [ ] This creates a clickable link on your repo

**Topics** (Optional)
- [ ] Click "Add topics"
- [ ] Type: `github-pages`, `zola`, `personal-website`, `academic`
- [ ] Press Enter after each
- [ ] Click "Done"

### Verify Repository Visibility

Scroll down to **Danger Zone** section:

```
┌─────────────────────────────────────────────────────────┐
│ Danger Zone                                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Change repository visibility                           │
│                                                         │
│ This repository is currently public  ← VERIFY THIS     │
│                                                         │
│ [ Change visibility ]                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Verify:**
- [ ] It says "This repository is currently **public**"
- [ ] Do NOT change to private (Pages won't work on free tier)

## Part 3: Settings → Environments

### How to Get There
1. Click **Settings** tab
2. In left sidebar, click **Environments**

### What You'll See (After First Deployment)

```
┌─────────────────────────────────────────────────────────┐
│ Environments                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ github-pages                         [Configure]       │
│                                                         │
│ 🟢 Active  Last deployed: 2 minutes ago                │
│                                                         │
│ [View deployments] → Shows history                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What to Check:**
- [ ] `github-pages` environment exists (auto-created)
- [ ] Status shows "Active" 
- [ ] Click "View deployments" to see deployment history

**No Action Needed** - This is automatically managed by the workflow.

### Optional: Environment Protection Rules

Click **[Configure]** to access advanced options:

```
┌─────────────────────────────────────────────────────────┐
│ Environment: github-pages                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Deployment branches                                     │
│ • Selected branches                                     │
│   - main                                                │
│                                                         │
│ Environment protection rules (Optional)                 │
│ ☐ Required reviewers                                    │
│ ☐ Wait timer                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Advanced Users Only:**
- [ ] Required reviewers: Someone must approve before deployment
- [ ] Wait timer: Delay before deployment starts
- [ ] Most users don't need these

## Part 4: Settings → Actions → General

### How to Get There
1. Click **Settings** tab
2. In left sidebar, expand **Actions**
3. Click **General**

### What to Verify

```
┌─────────────────────────────────────────────────────────┐
│ Actions permissions                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ◉ Allow all actions and reusable workflows             │
│   ← Should be selected                                  │
│                                                         │
│ ○ Disable actions                                       │
│   ← DON'T select this                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Workflow permissions                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ◉ Read and write permissions                           │
│   ← Should be selected                                  │
│                                                         │
│ ○ Read repository contents and packages permissions    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Verify:**
- [ ] "Allow all actions and reusable workflows" is selected
- [ ] "Read and write permissions" is selected
- [ ] If not, select these options and click Save

**Why This Matters:**
- Workflow needs permission to deploy to Pages
- Needs permission to use external actions like `actions/checkout`

## Part 5: Triggering First Deployment

### How to Trigger Workflow

1. Click **Actions** tab (top of repository)
2. In left sidebar, click "Build and Deploy"
3. You'll see:

```
┌─────────────────────────────────────────────────────────┐
│ Build and Deploy                                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [Run workflow ▼]  ← Click this                         │
│                                                         │
│ Workflow runs                                           │
│ (May be empty if never run)                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

4. Click **[Run workflow ▼]**
5. A dropdown appears:

```
┌─────────────────────────────────────┐
│ Use workflow from                   │
│                                     │
│ Branch: main                ▼      │
│                                     │
│ [Run workflow]  ← Click this        │
└─────────────────────────────────────┘
```

6. Ensure "main" is selected
7. Click **[Run workflow]** button
8. Wait 1-2 minutes for completion

### Monitor Progress

```
┌─────────────────────────────────────────────────────────┐
│ Workflow runs                                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 🟡 Build and Deploy  #1                                │
│    Running...                                           │
│    Started 30 seconds ago                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Status Indicators:**
- 🟡 Yellow dot = Running
- ✅ Green checkmark = Success!
- ❌ Red X = Failed (click to see error logs)

### After Successful Deployment

1. Return to **Settings → Pages**
2. You'll see: "Your site is live at [URL]"
3. Click the URL to visit your site
4. Enable "Enforce HTTPS" checkbox

## Verification Checklist

Use this checklist to verify everything is configured correctly:

### Before First Deployment
- [ ] Settings → Pages → Source = "GitHub Actions"
- [ ] Settings → General → Visibility = "Public"
- [ ] Settings → General → Description added
- [ ] Settings → General → Website URL added
- [ ] Settings → Actions → Actions allowed
- [ ] Settings → Actions → Read/write permissions enabled

### Trigger Deployment
- [ ] Actions → "Build and Deploy" → Run workflow
- [ ] Workflow completes successfully (green ✓)

### After First Deployment
- [ ] Settings → Pages shows "Your site is live at..."
- [ ] Settings → Pages → "Enforce HTTPS" checked
- [ ] Settings → Environments → `github-pages` environment exists
- [ ] Visit site URL - site loads correctly

## Common Issues

### "Deploy from a branch" is selected
**Problem:** Old deployment method is selected  
**Solution:** Change to "GitHub Actions"

### Repository is private
**Problem:** Free accounts can't use Pages with private repos  
**Solution:** Make repository public (Settings → General → Danger Zone)

### Workflow failed
**Problem:** Build errors in workflow  
**Solution:** Click failed run → Check error logs → Fix issues

### "Enforce HTTPS" not visible
**Problem:** First deployment hasn't completed yet  
**Solution:** Wait for first deployment, then it will appear

### No deployment URL shown
**Problem:** Workflow hasn't run successfully  
**Solution:** Go to Actions → Run workflow manually

## Next Steps

Once all settings are configured:

1. ✅ **Your site is live!** Visit the URL
2. 📝 **Edit content** in the `content/` folder
3. 🔄 **Push changes** to main branch
4. ⏱️ **Wait 1-2 minutes** for automatic rebuild
5. 🎉 **Enjoy your website!**

---

For detailed explanations of each setting, see [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md)

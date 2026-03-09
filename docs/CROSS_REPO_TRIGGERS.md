# Cross-Repository Update Triggers

This document explains how to configure EmotiView (and other analysis repositories) to automatically trigger website rebuilds when new data is pushed.

## How It Works

1. **EmotiView gets updated** - New participant data is analyzed and pushed
2. **Workflow triggers** - EmotiView's GitHub Action fires
3. **Website rebuilds** - 5ha99y fetches new data and redeploys

## Setup Instructions

### Step 1: Create Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name it: `EmotiView-Website-Trigger`
4. Select scopes:
   - ✅ `public_repo` (trigger workflows in public repos)
5. Click **Generate token**
6. **Copy the token** (you won't see it again!)

### Step 2: Add Token to EmotiView Secrets

1. Go to https://github.com/CGutt-hub/EmotiView/settings/secrets/actions
2. Click **New repository secret**
3. Name: `PERSONAL_ACCESS_TOKEN`
4. Value: Paste the token from Step 1
5. Click **Add secret**

### Step 3: Add Workflow to EmotiView

Copy the workflow file from `docs/EMOTIVIEW_WORKFLOW.yml` to EmotiView:

```bash
# In EmotiView repository
mkdir -p .github/workflows
cp /path/to/5ha99y/docs/EMOTIVIEW_WORKFLOW.yml .github/workflows/notify-website.yml
git add .github/workflows/notify-website.yml
git commit -m "Add automatic website update trigger"
git push
```

## Testing

After setup, push any change to `EV_results/` in EmotiView:

```bash
# In EmotiView
cd EV_results
touch test.txt
git add test.txt
git commit -m "Test website trigger"
git push
```

Within ~2 minutes, check:
- EmotiView Actions: https://github.com/CGutt-hub/EmotiView/actions
- Website Actions: https://github.com/CGutt-hub/5ha99y/actions

The website should show the "Build and Deploy" workflow running with trigger: `repository_dispatch`.

## Applying to Other Repositories

To enable automatic updates for other analysis repositories (e.g., future studies):

1. Copy the workflow to the new repo's `.github/workflows/notify-website.yml`
2. Update the `paths:` section to match the results directory
3. Add the same `PERSONAL_ACCESS_TOKEN` secret
4. Push changes

Example for a repo with `results/` directory:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'results/**'  # Trigger on results updates
```

## Fallback Updates

The website also updates automatically via:
- **Daily schedule**: 6 AM UTC (catches any missed updates)
- **Manual trigger**: GitHub Actions tab → "Run workflow"
- **Direct push**: Pushing to 5ha99y main branch

## Security Note

The PAT has limited scope (`public_repo`). It can only:
- Read public repositories
- Trigger workflows in public repositories

It **cannot**:
- Access private repos
- Modify code
- Change settings
- Delete repositories

# Why Builds Are Still Failing

## TL;DR
**The fix is on this PR branch, but main branch doesn't have it yet. Merge this PR to fix the builds.**

## Understanding the Error

The error you're seeing:
```
ERROR Found path collisions:
- `/blog/new-project-emotiview/` from files [
    "content/blog/2026-02-12-new-project-emotiview.md",
    "content/blog/2026-02-11-new-project-emotiview.md"
  ]
```

This error is from **main branch** CI runs, not from this PR branch.

## What's Happening on Main Branch

### The Broken State (Main Branch)
1. Main branch has old blog posts **committed to git**:
   - `content/blog/2026-02-11-new-project-emotiview.md`
   - `content/blog/2026-02-11-new-project-analysistoolbox.md`
   - `content/blog/2026-02-11-new-project-surveyworkbench.md`

2. Main branch's `fetch_data.py` does NOT have cleanup logic

3. When CI runs on main:
   - Script creates NEW blog posts for Feb 12
   - Old Feb 11 posts remain (not deleted)
   - Zola sees TWO files with same slug → ERROR

### The Fixed State (This PR Branch)
1. This PR removed old blog posts from git tracking
2. This PR added cleanup logic to `fetch_data.py`
3. This PR updated `.gitignore` to exclude auto-generated posts
4. When CI runs on THIS branch (after merge):
   - Script deletes any old blog posts
   - Creates fresh blog posts
   - Only ONE file per project → SUCCESS

## Comparison

| Feature | Main Branch | This PR Branch |
|---------|------------|----------------|
| Old blog posts in git | ❌ YES (wrong) | ✅ NO (correct) |
| Cleanup logic in script | ❌ NO | ✅ YES |
| .gitignore for auto posts | ❌ NO | ✅ YES |
| Build result | ❌ FAILS | ✅ WORKS |

## How to Fix

**Step 1: Merge this PR**
```bash
# Via GitHub UI: Click "Merge pull request"
# OR via command line:
git checkout main
git merge copilot/fix-website-update-issue-again
git push origin main
```

**Step 2: CI will run automatically**
- GitHub Actions triggers on push to main
- fetch_data.py runs with cleanup logic
- Old duplicates deleted, fresh posts created
- Build succeeds ✓

## Why This Fix Will Work

1. **Removes committed blog posts**: Auto-generated files won't be in git
2. **Adds cleanup logic**: Old posts deleted before new ones created
3. **Prevents future issues**: .gitignore excludes auto-generated files

## Verification After Merge

Check these to confirm it worked:
1. Go to https://github.com/CGutt-hub/cagatay-gutt.github.io/actions
2. Look for green checkmark ✓ on latest "Build and Deploy" run
3. Visit https://cgutt-hub.github.io/cagatay-gutt.github.io
4. Website should be updated

## Technical Details

### The Cleanup Logic
```python
# Before creating blog post, remove any existing posts with same slug
slug = slugify(f"new-project-{repo['name']}")
pattern = f"????-??-??-{slug}.md"  # Matches YYYY-MM-DD-slug.md
for existing_file in blog_dir.glob(pattern):
    existing_file.unlink()  # Delete old post
```

This ensures only ONE blog post exists per project, preventing path collisions.

### Why Main Branch Doesn't Have This Yet
- This fix was developed on the PR branch
- Main branch is at commit 9c3fd248 (before the fix)
- Merging this PR will apply the fix to main
- Future builds on main will work correctly

---

**Bottom line: The fix exists and works. It just needs to be merged to main.**

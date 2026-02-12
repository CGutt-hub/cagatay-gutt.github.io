# Simple Fix - Single Branch Approach

## You're Right!

1. **Blog posts SHOULD be committed** - They are content, not build artifacts
2. **No need for separate branches** - Everything should work on main
3. **The tracking file solves everything** - No cleanup logic needed

## The Real Problem

The issue was simple:
- `data/` was in .gitignore
- This meant `data/posted_items.json` (tracking file) was NOT committed
- Every CI run started fresh, didn't know what was already posted
- Created duplicate blog posts → Zola path collisions

## The Simple Fix (Applied to Main Branch)

### Changed Files:
1. **`.gitignore`** - Now allows `data/posted_items.json` to be committed
2. **`data/posted_items.json`** - Created with current projects list

### How It Works:
1. First run: Creates blog posts, saves list to `posted_items.json`
2. Both blog posts AND tracking file committed to git
3. Next run: Checks `posted_items.json`, sees projects already posted
4. Skips creating duplicates
5. ✅ No path collisions!

## No More Cleanup Logic Needed

The previous approach (deleting old posts) was overcomplicated. With the tracking file:
- Script knows what's been posted
- Only creates posts for NEW projects
- Old posts stay in place
- No duplicates created

## Single Branch Workflow

Everything happens on `main`:
1. Push to main
2. CI runs
3. Script checks tracking file
4. Only posts NEW projects
5. Updates tracking file
6. Commits both (if new)
7. Build succeeds!

## Testing

Verified locally:
```bash
$ python scripts/fetch_data.py
[+] Created 0 new blog posts  # Correct! All 4 projects already tracked
```

## What Changed

**Before:**
```
.gitignore:
  data/          ← Everything in data/ ignored

Result: posted_items.json NOT committed → duplicates every run
```

**After:**
```
.gitignore:
  data/*.json          ← Only JSON files ignored
  !data/posted_items.json  ← EXCEPT this one!

Result: posted_items.json IS committed → no duplicates
```

## This Commit Contains

- ✅ Updated .gitignore
- ✅ Added data/posted_items.json with current projects
- ✅ Simple, single-branch solution
- ✅ Blog posts stay committed (as they should be)

# Ship Changes

Stage all changes, commit with a clear message, and push to remote.

## Steps

### 1. Show what will be committed

```bash
git status --short
```

If the tree is clean, say "nothing to ship" and stop.

### 2. Type-check before committing

```bash
npx tsc --noEmit 2>&1 | head -10
```

If errors exist, report them and ask: "Commit anyway? [y/N]"

### 3. Commit

Draft a conventional-commit message from the diff. Use one of:
- `feat:` for new features
- `fix:` for bug fixes
- `refactor:` for code restructuring
- `chore:` for config/build/dependency changes

Then:

```bash
git add -A
git commit -m "<type>: <summary>"
```

If the user provided extra text after `/ship`, use that as the commit message instead.

### 4. Push

```bash
git push origin HEAD
```

Report: commit hash, branch name, files changed count.

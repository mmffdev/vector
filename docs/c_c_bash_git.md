# Bash — git operations

> Parent: [c_bash.md](c_bash.md)
> Last verified: 2026-04-21

Verified git invocations from this repo.

## Current short SHA

```bash
git rev-parse --short HEAD
```

Returns a 7-char abbreviated SHA (e.g. `8b12ee73`). Used as the backup label when no tag is on the commit.

## Short SHA of a specific ref

```bash
git rev-parse --short main
```

Used by `<backupsql>` to always snapshot whatever `main` points at, even mid-rebase on another branch.

## Is this commit tagged?

```bash
git describe --tags --exact-match <sha>
```

Prints the tag name if one points at `<sha>`, else exits non-zero. Backup-on-push uses this for label resolution — *never* parse `git push` argv for tag names (fragile and wrong when `git push --tags` fires after commits).

## List branches (used by `<showbranches>`)

```bash
git branch --list
```

## What will a push actually send?

```bash
git log --oneline @{u}..HEAD
```

Commits on current branch not yet on its upstream. Empty output means push is a no-op.

## Files changed since a timestamp (librarian scope resolution)

```bash
git log --since="2026-04-20T12:00:00Z" --name-only --pretty=format: | sort -u
```

Plus uncommitted changes:

```bash
git status --porcelain | awk '{print $2}'
```

Union the two sets; that's the librarian's working list.

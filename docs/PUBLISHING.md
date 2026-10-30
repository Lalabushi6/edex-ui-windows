# Putting eDEX-UI on GitHub

This project is already a Git repository with its full history. Publishing it
means creating an empty repository on GitHub and pushing to it. After that,
GitHub Actions builds the Windows `.exe` files for you, and pushing a version
tag turns them into a downloadable Release.

## Before you start

- A GitHub account (github.com → Sign up).
- Git for Windows (you have it already: `git --version`).
- Optional: [GitHub Desktop](https://desktop.github.com) if you'd rather click
  than type, or the [GitHub CLI](https://cli.github.com) (`gh`).

What gets uploaded is controlled by [`.gitignore`](../.gitignore):
`node_modules/`, `dist/` (built executables), `.backup/` (your old v1 copy)
and `.claude/` stay on your PC. Nothing from `%APPDATA%\eDEX-UI` (your
settings, API key, notes) is inside the project folder, so none of it can be
uploaded.

**Your email address in commits.** Every commit records the name and email
from `git config user.name` / `user.email`, and they're public once pushed.
To keep your real address private, use GitHub's no-reply address for future
commits (GitHub → Settings → Emails → "Keep my email addresses private"
shows it; it looks like `12345678+username@users.noreply.github.com`):

```bash
git config user.email "12345678+username@users.noreply.github.com"
```

(Commits you've already made keep the old address.)

## Option A: GitHub Desktop (no command line)

1. Open GitHub Desktop and sign in (File → Options → Accounts).
2. **File → Add local repository…** → choose the project folder (the one
   containing `package.json`) → **Add repository**.
3. Click **Publish repository** (top bar).
   - Name: `edex-ui-windows` (or anything you like).
   - Untick **Keep this code private** if you want it public.
   - **Publish repository**.
4. Done: the page is at `https://github.com/<your-username>/edex-ui-windows`.

Later changes: commit them in eDEX's folder as usual, then click **Push
origin** in GitHub Desktop.

## Option B: Command line

1. On github.com click **+ → New repository**.
   - Repository name: `edex-ui-windows`. Public or private, your choice.
   - **Leave "Add a README", ".gitignore" and "license" unticked**: the
     project already has them, and an initialised repository would refuse
     your first push.
   - **Create repository**.
2. In a terminal in the project folder, connect it and push (replace
   `<your-username>`):

   ```bash
   git remote add origin https://github.com/<your-username>/edex-ui-windows.git
   ```

   ```bash
   git push -u origin main
   ```

   The first push opens a browser window to sign in to GitHub (Git
   Credential Manager remembers it afterwards).

With the GitHub CLI the two steps are one command, run in the project
folder:

```bash
gh repo create edex-ui-windows --public --source . --push
```

Later changes: `git push` after committing.

## The automatic build

Every push runs the **Build** workflow
([`.github/workflows/build.yml`](../.github/workflows/build.yml)) on a
Windows machine at GitHub: it installs dependencies, runs the checks and
builds the installer and the portable `.exe`.

Ordinary pushes only check that everything builds; they don't keep the
`.exe` files, because GitHub's artifact storage is small on private
repositories (500 MB on the free plan, and one build is about 200 MB). To
get a test build you can download: repository → **Actions** tab → **Build**
→ **Run workflow** → **Run workflow**. When it finishes, the run's
**Artifacts** list `eDEX-UI-Setup.exe` and `eDEX-UI-Portable.exe`, each
downloadable as the `.exe` itself, for 3 days. Release builds put their
files on the release page instead, which doesn't use artifact storage.

## Publishing a release (the download page)

A release is a permanent page with the `.exe` files attached, under the
repository's **Releases**.

1. Bump the version (this edits `package.json`, commits, and creates the tag
   `v2.0.1`; use `minor` or `major` for bigger steps):

   ```bash
   npm version patch
   ```

2. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

3. The Build workflow notices the `v…` tag, builds, and publishes
   **Release v2.0.1** with `eDEX-UI-Setup.exe` and `eDEX-UI-Portable.exe`
   attached, plus notes listing the commits since the last release. Edit
   the notes on the release page if you like. The file names stay the same
   from release to release, so the README's download buttons
   (`…/releases/latest/download/eDEX-UI-Setup.exe`) always fetch the newest
   version.

With GitHub Desktop: update `"version"` in `package.json`, commit, then in
**History** right-click the commit → **Create Tag…** → `v2.0.1` → **Push
origin** (it asks to push the tag too).

### How eDEX finds its own updates

Installed and portable copies check this repository's **latest release**
(once a day, or Settings → About → Check now) and offer to install it. For
that to work:

- The repository must be **public** (a private one answers "not found").
- The release needs files named exactly `eDEX-UI-Setup.exe` (installed
  copies) and `eDEX-UI-Portable.exe` (portable copies) — the workflow
  uploads both.
- The tag must be a higher version than the running copy (`v2.0.3` >
  `2.0.2`); drafts and pre-releases are ignored.
- eDEX checks each download against the SHA-256 digest GitHub computes for
  every release file, so don't replace a file in a published release; cut a
  new one instead.
- The repository it checks comes from `"repository"` in `package.json`. If
  you fork or rename the project, change that URL.

## If something goes wrong

- **Push rejected ("fetch first" / "non-fast-forward")**: the GitHub repo was
  created with a README or license. Either delete and recreate it empty, or
  run `git pull origin main --allow-unrelated-histories`, resolve, and push.
- **Release step fails with a permissions error**: repository → Settings →
  Actions → General → Workflow permissions → **Read and write permissions**
  → Save, then re-run the job (Actions → the run → Re-run jobs).
- **Build fails in `npm ci`**: `package-lock.json` is out of date; run
  `npm install` locally, commit the updated lock file and push.
- **"Artifact storage quota has been hit"**: old build artifacts fill the
  repository's storage (they used to be kept for 90 days after every push).
  Run **Actions → Clean up artifacts → Run workflow** (it deletes old
  artifacts; release files aren't touched); GitHub recalculates the usage
  6–12 hours later. Uploads no longer fail the build either way.
- **"Node.js 20 is deprecated" warnings**: an action in a workflow is on an
  old major version. Bump it (`actions/checkout@v7`, `actions/setup-node@v7`,
  `actions/upload-artifact@v7`, `softprops/action-gh-release@v3` are the
  Node 24 ones the workflows use).
- **SmartScreen warns about the downloaded .exe**: expected for unsigned
  apps. Users click **More info → Run anyway**. Signing needs a paid
  code-signing certificate; electron-builder picks one up from the
  `CSC_LINK` / `CSC_KEY_PASSWORD` secrets if you ever add one (and then
  `win.signAndEditExecutable` can go back to `true`).

## Licence

eDEX-UI is GPL-3.0 (see [LICENSE](../LICENSE)), because it includes code and
assets from the original eDEX-UI. Publishing the source on GitHub alongside
the executables meets the licence's main requirement; keep the LICENSE and
THIRD_PARTY_NOTICES files in the repository.

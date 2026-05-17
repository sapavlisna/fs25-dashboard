# Publishing to GitHub — step-by-step

This folder (`src/Dashboard/`) is structured to be its own standalone repo.
Below is how to push it to GitHub as a public project.

## One-time setup

### 1. Create the GitHub repo

Go to <https://github.com/new>. Suggested settings:

- Name: `fs25-dashboard`
- Description: *Real-time web dashboard for Farming Simulator 25*
- Public
- **Do NOT** initialize with README, license, or .gitignore — they're already here.

After creating, copy the repo URL (e.g. `https://github.com/<you>/fs25-dashboard.git`).

### 2. Replace placeholders

Edit `Server/package.json` — change `Sapavlisna` to your actual GitHub
username in the `repository`, `bugs`, and `homepage` fields if you're forking.

Edit `LICENSE` — change `Copyright (c) 2026 Sapavlisna` if you want a
different name.

### 3. Push the Dashboard subtree to the new repo

From the workspace root:

```powershell
# Copy the Dashboard subtree to a sibling folder.
# /XD excludes directories; /XF excludes individual files.
robocopy src\Dashboard ..\fs25-dashboard /E /XD node_modules data .vs docs _marketing

cd ..\fs25-dashboard

git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/<you>/fs25-dashboard.git
git push -u origin main
```

> **Note:** the workspace's `src/Dashboard/docs/` folder contains *internal*
> planning notes (BUGS.md, PLAN.md, REDESIGN.md, etc.) — not for public
> consumption. The robocopy above excludes it. In the new repo you'll
> create a fresh `docs/` folder just for screenshots (see step 4).

> Why a sibling folder? The parent workspace may contain private tooling
> (knowledge base, agents, other mods) that shouldn't be public. Publishing
> only the `src/Dashboard/` subtree keeps things clean.

### 4. Add screenshots / GIF

The README references `docs/screenshot-main.png`, `docs/screenshot-history.png`,
and `docs/demo.gif`. Create the `docs/` folder in the new repo:

```powershell
mkdir docs
# Drop your screenshots / a short OBS clip exported as GIF here
git add docs/
git commit -m "Add screenshots"
git push
```

A short 10–30 second GIF on the README hero is worth more than three
paragraphs of features.

## Cutting a release

The `.github/workflows/release.yml` does everything when you push a version
tag — checkout, install Node 20, install npm deps, build the single-file
Windows .exe of the server, zip up the mod, attach both to a GitHub Release.

GitHub Actions is **free** for public repos (unlimited minutes). The whole
build takes ~2 minutes.

### Before the first release

After running `npm install` to add `@yao-pkg/pkg` as a devDep, commit the
updated `Server/package-lock.json` — CI uses `npm ci` which requires the
lock to match `package.json`:

```powershell
cd Server
npm install
git add package.json package-lock.json
git commit -m "Add pkg build dependency"
```

Optionally, smoke-test the build locally first:

```powershell
cd Server
npm run build
.\dist\FS25_Dashboard_Server.exe
# open http://localhost:3000 in a browser, verify it works, then Ctrl+C
```

### Pushing a release

```powershell
# Bump version in modDesc.xml and Server/package.json first, then:
git tag v1.0.0
git push --tags
```

Watch the build under the **Actions** tab of the GitHub repo. When it
finishes, the release appears under **Releases** with both ZIPs attached:

- `FS25_Dashboard.zip` — the FS25 Lua mod (drag into mods folder)
- `FS25_Dashboard_Server.zip` — contains `FS25_Dashboard_Server.exe`,
  `config.example.json`, and a short `README.txt`

Subsequent releases: `v1.0.1`, `v1.1.0`, etc. Update `CHANGELOG.md` *before*
tagging — the release notes link to it.

## Promoting it

Once you have a release live (distribution stays GitHub-only — the project
has a server component that ModHub can't host):

1. **CZ/SK FS forums** — short thread, screenshot, GitHub link.
2. **r/farmingsimulator** — post with a GIF (rules forbid blogspam; lead
   with the GIF, link in a comment).
3. **YouTube** — a 1–2 minute screencast is the single highest-leverage
   thing you can do for an FS mod.
4. **Discord servers** (FS communities) — short pitch + GIF + GitHub link.

## Maintenance

- Pin the `npm` dependency versions in `Server/package.json` periodically
  (`npm outdated`, `npm update`).
- When FS25 patches change Lua APIs, the mod's `DashboardExport.lua` may
  need fixes — watch the GIANTS changelog.
- Issues you can't reproduce: ask for `dashboard_data.json` and a sanitized
  `careerSavegame.xml`.

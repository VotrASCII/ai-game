# GitHub Pages / repo visibility

Quick reference for `gh` commands to toggle the repo public (with Pages live) or back to private. Requires the `gh` CLI authenticated as VotrASCII.

## Make repo public + Pages live

```sh
gh repo edit VotrASCII/ai-game --visibility public --accept-visibility-change-consequences
gh api -X POST repos/VotrASCII/ai-game/pages -f "source[branch]=main" -f "source[path]=/"
```

Site: https://votrascii.github.io/ai-game/

Check build status:

```sh
gh api repos/VotrASCII/ai-game/pages --jq .status
```

## Make repo private again

```sh
gh repo edit VotrASCII/ai-game --visibility private --accept-visibility-change-consequences
```

Note: private repos on a free GitHub plan don't serve Pages, so the site goes offline automatically. You don't need to delete the Pages config — re-running the "make public" command above brings it straight back without re-creating anything.

#!/usr/bin/env python3
"""Validate story graph: scene links, reachability, items, requires-gates, manifest."""
import json, sys, os

DIR = os.path.dirname(os.path.abspath(__file__))

def load(name):
    with open(os.path.join(DIR, name)) as f:
        return json.load(f)

def main():
    manifest = load('manifest.json')
    ok = True
    granted_so_far = set()          # items grantable in any prior/current chapter
    persistent_so_far = set()       # persistent items from prior chapters

    for ch in manifest['chapters']:
        fname = os.path.basename(ch['file'])
        if not os.path.exists(os.path.join(DIR, fname)):
            print(f"[{ch['id']}] SKIP (not written yet: {fname})")
            continue
        data = load(fname)
        scenes = data['scenes']
        ids = set(scenes)
        errs = []

        if data.get('startScene') != ch['startScene']:
            errs.append(f"startScene mismatch: manifest={ch['startScene']} file={data.get('startScene')}")
        if ch['startScene'] not in ids:
            errs.append(f"startScene {ch['startScene']} missing")

        chapter_items = {}
        for sid, s in scenes.items():
            if s.get('id') != sid:
                errs.append(f"{sid}: id field mismatch ({s.get('id')})")
            if s.get('item'):
                chapter_items[s['item']['id']] = sid
            has_choices = bool(s.get('choices'))
            if not has_choices and not s.get('end'):
                errs.append(f"{sid}: no choices and not an end scene (dead end)")
            if s.get('end') and has_choices:
                errs.append(f"{sid}: end scene has choices (engine ignores them)")
            for c in s.get('choices', []):
                if c['next'] not in ids:
                    errs.append(f"{sid}: choice -> unknown scene '{c['next']}'")

        avail = persistent_so_far | set(chapter_items)
        for sid, s in scenes.items():
            for c in s.get('choices', []):
                req = c.get('requires')
                if req and req not in avail:
                    errs.append(f"{sid}: requires unknown item '{req}'")

        # reachability (ignoring gates = optimistic)
        seen, stack = set(), [ch['startScene']]
        while stack:
            cur = stack.pop()
            if cur in seen or cur not in scenes:
                continue
            seen.add(cur)
            for c in scenes[cur].get('choices', []):
                stack.append(c['next'])
        unreachable = ids - seen
        if unreachable:
            errs.append(f"unreachable scenes: {sorted(unreachable)}")

        ends = [sid for sid, s in scenes.items() if s.get('end')]
        if not ends:
            errs.append("no end scene")

        # manifest summary requires must reference known items
        for summ in ch.get('summaries', []):
            for req in summ.get('requires', []):
                if req not in avail:
                    errs.append(f"manifest summary requires unknown item '{req}'")

        for iid, sid in chapter_items.items():
            granted_so_far.add(iid)
            if scenes[sid]['item'].get('persistent'):
                persistent_so_far.add(iid)

        status = "OK" if not errs else "FAIL"
        print(f"[{ch['id']}] {status}: {len(scenes)} scenes, {len(chapter_items)} items, ends={ends}")
        for e in errs:
            ok = False
            print(f"    ! {e}")

    print(f"\npersistent items so far: {sorted(persistent_so_far)}")
    sys.exit(0 if ok else 1)

main()

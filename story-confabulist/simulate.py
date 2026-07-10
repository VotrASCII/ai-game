#!/usr/bin/env python3
"""Exhaustively simulate all playthroughs across chapters, mimicking engine.js:
- scene items granted on entry (dedup by id)
- choices locked unless `requires` item held
- persistent items carry across chapter boundaries
Fails if any reachable state has zero unlocked choices (soft-lock), or a
chapter end is reached that leaves the next chapter's start soft-locked.
Reports reachable endings of ch5.
"""
import json, os, sys
from functools import lru_cache

DIR = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(DIR, 'manifest.json')))
chapters = []
for ch in manifest['chapters']:
    d = json.load(open(os.path.join(DIR, os.path.basename(ch['file']))))
    chapters.append((ch['id'], ch['startScene'], d['scenes']))

soft_locks, endings, summaries_hit = [], set(), set()
seen = set()

def persistent(scenes, items):
    out = set()
    for iid in items:
        for s in scenes.values():
            it = s.get('item')
            if it and it['id'] == iid and it.get('persistent'):
                out.add(iid)
    return frozenset(out)

def walk(ci, sid, items):
    key = (ci, sid, items)
    if key in seen:
        return
    seen.add(key)
    chid, start, scenes = chapters[ci]
    s = scenes[sid]
    it = s.get('item')
    if it and it['id'] not in items:
        items = frozenset(items | {it['id']})
        key2 = (ci, sid, items)
        if key2 in seen:
            return
        seen.add(key2)
    if s.get('end'):
        # summary matching for this chapter
        for idx, summ in enumerate(manifest['chapters'][ci].get('summaries', [])):
            if all(r in items for r in summ.get('requires', [])):
                summaries_hit.add((chid, idx))
                break
        if ci + 1 < len(chapters):
            nxt_id, nxt_start, nxt_scenes = chapters[ci + 1]
            carried = persistent(scenes, items)
            walk(ci + 1, nxt_start, carried)
        else:
            endings.add(sid)
        return
    unlocked = [c for c in s.get('choices', []) if not c.get('requires') or c['requires'] in items]
    if not unlocked:
        soft_locks.append((chid, sid, sorted(items)))
        return
    for c in unlocked:
        walk(ci, c['next'], items)

# carry persistence across chapter hops properly: persistent() above only checks
# current chapter's scenes for the flag; also keep items already known persistent.
# Simpler fix: treat an item as persistent if ANY chapter defines it persistent.
PERSISTENT_IDS = set()
for _, _, scenes in chapters:
    for s in scenes.values():
        it = s.get('item')
        if it and it.get('persistent'):
            PERSISTENT_IDS.add(it['id'])

def persistent(scenes, items):  # noqa: F811 (override with global knowledge)
    return frozenset(i for i in items if i in PERSISTENT_IDS)

walk(0, chapters[0][1], frozenset())

print(f"explored states: {len(seen)}")
print(f"reachable ch5 endings: {sorted(endings)}")
all_ends = {sid for sid, s in chapters[-1][2].items() if s.get('end')}
missing = all_ends - endings
if missing:
    print(f"!! UNREACHABLE endings: {sorted(missing)}")
for chid_idx, ch in enumerate(manifest['chapters']):
    n = len(ch.get('summaries', []))
    hit = {i for c, i in summaries_hit if c == ch['id']}
    unhit = set(range(n)) - hit
    if unhit:
        print(f"!! {ch['id']}: summaries never matched at chapter end: {sorted(unhit)}")
if soft_locks:
    print(f"!! SOFT LOCKS ({len(soft_locks)}):")
    for chid, sid, items in soft_locks[:20]:
        print(f"   {chid}/{sid} items={items}")
sys.exit(1 if (soft_locks or missing) else 0)

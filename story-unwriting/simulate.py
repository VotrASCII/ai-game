#!/usr/bin/env python3
"""Exhaustively simulate all playthroughs of The Unwriting, mimicking engine.js:
- scene items granted on entry (dedup by id)
- choices locked by `requires` (item), `requiresCount` ({of, min}), `skillRequires`
- persistent items and skills carry across chapter boundaries

Skill state is abstracted to two policies to keep the state space finite:
  LOW  = never spend points (all ranks 0)  -> skill-gated choices always locked
  HIGH = ranks equal to points banked so far, any single skill (upper bound)
Soft-lock safety comes from validate.py's every-scene-has-an-open-choice rule;
here we verify ending reachability, summary coverage, and thread-flag paths
under both policies.

Reports reachable endings of the final chapter and whether ending 1's
requiresCount gate (>=6 of 8 thread flags) is satisfiable.
"""
import json, os, sys

DIR = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(DIR, 'manifest.json')))

WAYPOINT_PLAN = {'ch3': 3, 'ch6': 4, 'ch9': 3, 'ch12': 5, 'ch15': 4, 'ch17': 3}

chapters = []
for ch in manifest['chapters']:
    path = os.path.join(DIR, os.path.basename(ch['file']))
    if not os.path.exists(path):
        break  # simulate the contiguous written prefix only
    d = json.load(open(path))
    chapters.append((ch['id'], ch['startScene'], d['scenes']))

if not chapters:
    print("no chapters written yet")
    sys.exit(0)

PERSISTENT_IDS = set()
for _, _, scenes in chapters:
    for s in scenes.values():
        it = s.get('item')
        if it and it.get('persistent'):
            PERSISTENT_IDS.add(it['id'])

soft_locks, endings, summaries_hit = [], set(), set()

def unlocked(c, items, max_rank):
    if c.get('requires') and c['requires'] not in items:
        return False
    rc = c.get('requiresCount')
    if rc and len([i for i in rc['of'] if i in items]) < rc['min']:
        return False
    for _, rank in (c.get('skillRequires') or {}).items():
        if rank > max_rank:
            return False
    return True

def run(policy):
    """policy: 'LOW' (max_rank always 0) or 'HIGH' (max_rank = banked points)."""
    seen = set()

    def walk(ci, sid, items, points):
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
            pts = points + WAYPOINT_PLAN.get(chid, 0)
            for idx, summ in enumerate(manifest['chapters'][ci].get('summaries', [])):
                if all(r in items for r in summ.get('requires', [])):
                    summaries_hit.add((chid, idx))
                    break
            if ci + 1 < len(chapters):
                carried = frozenset(i for i in items if i in PERSISTENT_IDS)
                walk(ci + 1, chapters[ci + 1][1], carried, pts)
            else:
                endings.add(sid)
            return
        max_rank = 0 if policy == 'LOW' else min(5, points)
        opts = [c for c in s.get('choices', []) if unlocked(c, items, max_rank)]
        if not opts:
            soft_locks.append((policy, chid, sid, sorted(items)))
            return
        for c in opts:
            walk(ci, c['next'], items, points)

    walk(0, chapters[0][1], frozenset(), 0)
    return len(seen)

n_low = run('LOW')
n_high = run('HIGH')

last_id = chapters[-1][0]
all_ends = {sid for sid, s in chapters[-1][2].items() if s.get('end')}
missing = all_ends - endings

print(f"chapters simulated: {len(chapters)} (through {last_id})")
print(f"explored states: LOW={n_low} HIGH={n_high}")
print(f"reachable {last_id} endings: {sorted(endings)}")
if missing:
    print(f"!! UNREACHABLE endings: {sorted(missing)}")
for ci, ch in enumerate(manifest['chapters'][:len(chapters)]):
    n = len(ch.get('summaries', []))
    hit = {i for c, i in summaries_hit if c == ch['id']}
    unhit = set(range(n)) - hit
    if unhit:
        print(f"!! {ch['id']}: summaries never matched at chapter end: {sorted(unhit)}")
if soft_locks:
    print(f"!! SOFT LOCKS ({len(soft_locks)}):")
    for pol, chid, sid, items in soft_locks[:20]:
        print(f"   [{pol}] {chid}/{sid} items={items}")
sys.exit(1 if (soft_locks or missing) else 0)

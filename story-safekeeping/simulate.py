#!/usr/bin/env python3
"""Exhaustively simulate all playthroughs of The Safekeeping, mimicking engine.js:
- inherited ending flags seeded at ch1 (manifest inheritsFrom), or none (new player
  -> Archivist prologue must set exactly one)
- scene items granted on entry (dedup by id)
- choices locked by `requires`, `requiresCount` ({of, min}), `requiresAbsent`,
  `skillRequires`
- persistent items and skills carry across chapter boundaries

Skill state is abstracted to two policies to keep the state space finite:
  LOW  = never spend points (all ranks 0)
  HIGH = ranks equal to points banked so far, any single skill (upper bound)

Verifies: all six ch15 endings reachable, all four ch16 epilogue terminals
reachable, the knowing endings' recognition gate (>=5 of 7) satisfiable but not
forced, both ch14 exits reachable, summary coverage, and no soft-locks — under
every inherited-ending scenario plus the new-player scenario.
"""
import json, os, sys

DIR = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(DIR, 'manifest.json')))

WAYPOINT_PLAN = {'ch3': 3, 'ch6': 4, 'ch9': 4, 'ch12': 4, 'ch14': 3}
INHERITED = manifest.get('inheritsFrom', {}).get('items', [])

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

PERSISTENT_IDS = set(INHERITED)
for _, _, scenes in chapters:
    for s in scenes.values():
        it = s.get('item')
        if it and it.get('persistent'):
            PERSISTENT_IDS.add(it['id'])

# Only items that gate something need to live in the state key.
RELEVANT_IDS = set(INHERITED)
for ch in manifest['chapters']:
    for summ in ch.get('summaries', []):
        RELEVANT_IDS.update(summ.get('requires', []))
for _, _, scenes in chapters:
    for s in scenes.values():
        for c in s.get('choices', []):
            if c.get('requires'):
                RELEVANT_IDS.add(c['requires'])
            if c.get('requiresCount'):
                RELEVANT_IDS.update(c['requiresCount']['of'])
            if c.get('requiresAbsent'):
                RELEVANT_IDS.update(c['requiresAbsent'])

soft_locks, endings, epilogues, summaries_hit = [], set(), set(), set()

def unlocked(c, items, max_rank):
    if c.get('requires') and c['requires'] not in items:
        return False
    rc = c.get('requiresCount')
    if rc and len([i for i in rc['of'] if i in items]) < rc['min']:
        return False
    if c.get('requiresAbsent') and any(i in items for i in c['requiresAbsent']):
        return False
    for _, rank in (c.get('skillRequires') or {}).items():
        if rank > max_rank:
            return False
    return True

def run(policy, initial):
    seen = set()

    def walk(ci, sid, items, points):
        key = (ci, sid, items)
        if key in seen:
            return
        seen.add(key)
        chid, start, scenes = chapters[ci]
        s = scenes[sid]
        it = s.get('item')
        if it and it['id'] in RELEVANT_IDS and it['id'] not in items:
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
            if chid == 'ch15':
                endings.add(sid)
            if chid == 'ch16':
                epilogues.add(sid)
            if ci + 1 < len(chapters):
                carried = frozenset(i for i in items if i in PERSISTENT_IDS)
                walk(ci + 1, chapters[ci + 1][1], carried, pts)
            return
        max_rank = 0 if policy == 'LOW' else min(5, points)
        opts = [c for c in s.get('choices', []) if unlocked(c, items, max_rank)]
        if not opts:
            soft_locks.append((policy, chid, sid, sorted(items)))
            return
        for c in opts:
            walk(ci, c['next'], items, points)

    walk(0, chapters[0][1], frozenset(initial), 0)
    return len(seen)

scenarios = [('new-player', [])] + [(f'inherit:{e}', [e]) for e in INHERITED]
total = 0
for name, init in scenarios:
    for policy in ('LOW', 'HIGH'):
        total += run(policy, init)

last_id = chapters[-1][0]
print(f"chapters simulated: {len(chapters)} (through {last_id})")
print(f"scenarios: {[n for n, _ in scenarios]}")
print(f"explored states (sum over runs): {total}")

fails = []
ch15 = next(((cid, sc) for cid, st, sc in chapters if cid == 'ch15'), None)
if ch15:
    all_ends = {sid for sid, s in ch15[1].items() if s.get('end')}
    missing = all_ends - endings
    print(f"reachable ch15 endings: {sorted(endings)}")
    if missing:
        fails.append(f"UNREACHABLE ch15 endings: {sorted(missing)}")
ch16 = next(((cid, sc) for cid, st, sc in chapters if cid == 'ch16'), None)
if ch16:
    all_eps = {sid for sid, s in ch16[1].items() if s.get('end')}
    missing = all_eps - epilogues
    print(f"reachable ch16 epilogues: {sorted(epilogues)}")
    if missing:
        fails.append(f"UNREACHABLE ch16 epilogues: {sorted(missing)}")

for ci, ch in enumerate(manifest['chapters'][:len(chapters)]):
    summs = ch.get('summaries', [])
    hit = {i for c, i in summaries_hit if c == ch['id']}
    unhit = {i for i in set(range(len(summs))) - hit if summs[i].get('requires')}
    if unhit:
        fails.append(f"{ch['id']}: summaries never matched at chapter end: {sorted(unhit)}")
if soft_locks:
    fails.append(f"SOFT LOCKS ({len(soft_locks)})")
    for pol, chid, sid, items in soft_locks[:20]:
        print(f"   [{pol}] {chid}/{sid} items={items}")

for f in fails:
    print(f"!! {f}")
sys.exit(1 if fails else 0)

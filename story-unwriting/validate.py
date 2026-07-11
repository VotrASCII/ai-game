#!/usr/bin/env python3
"""Validate The Unwriting story graph: scene links, reachability, items,
requires/skillRequires/requiresCount gates, waypoint math, manifest."""
import json, sys, os

DIR = os.path.dirname(os.path.abspath(__file__))

# Waypoint plan from BIBLE.md: chapter id -> points awarded at its waypoint.
WAYPOINT_PLAN = {'ch3': 3, 'ch6': 4, 'ch9': 3, 'ch12': 5, 'ch15': 4, 'ch17': 3}
THREAD_FLAGS = {
    'thread_queen', 'thread_market', 'thread_honest_memory', 'thread_told',
    'thread_unsoftened', 'thread_her_opening', 'thread_worst_moment', 'thread_letter',
}

def load(name):
    with open(os.path.join(DIR, name)) as f:
        return json.load(f)

def main():
    manifest = load('manifest.json')
    skill_ids = {s['id'] for s in manifest.get('skills', [])}
    skill_max = manifest.get('skillMax', 5)
    ok = True
    persistent_so_far = set()   # persistent items from prior chapters
    points_before = 0           # skill points available entering this chapter
    thread_granted = set()      # thread flags grantable so far

    for ch in manifest['chapters']:
        fname = os.path.basename(ch['file'])
        if not os.path.exists(os.path.join(DIR, fname)):
            print(f"[{ch['id']}] SKIP (not written yet: {fname})")
            points_before += WAYPOINT_PLAN.get(ch['id'], 0)
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
        waypoints = []
        for sid, s in scenes.items():
            if s.get('id') != sid:
                errs.append(f"{sid}: id field mismatch ({s.get('id')})")
            if s.get('item'):
                chapter_items[s['item']['id']] = sid
            if s.get('waypoint'):
                waypoints.append((sid, s['waypoint']))
            has_choices = bool(s.get('choices'))
            if not has_choices and not s.get('end'):
                errs.append(f"{sid}: no choices and not an end scene (dead end)")
            if s.get('end') and has_choices:
                errs.append(f"{sid}: end scene has choices (engine ignores them)")
            for c in s.get('choices', []):
                if c['next'] not in ids:
                    errs.append(f"{sid}: choice -> unknown scene '{c['next']}'")

        # waypoint plan conformance
        planned = WAYPOINT_PLAN.get(ch['id'])
        actual = sum(w.get('points', 0) for _, w in waypoints)
        if planned and actual != planned:
            errs.append(f"waypoint points {actual} != planned {planned}")
        if not planned and waypoints:
            errs.append(f"unplanned waypoint(s) in {ch['id']}: {[sid for sid, _ in waypoints]}")
        if planned and not waypoints:
            errs.append(f"planned waypoint ({planned} pts) missing")

        avail = persistent_so_far | set(chapter_items)
        # max rank reachable when this chapter's choices render:
        # points banked before this chapter (this chapter's waypoint is at its end).
        max_rank = min(skill_max, points_before)
        for sid, s in scenes.items():
            for c in s.get('choices', []):
                req = c.get('requires')
                if req and req not in avail:
                    errs.append(f"{sid}: requires unknown item '{req}'")
                rc = c.get('requiresCount')
                if rc:
                    unknown = [i for i in rc['of'] if i not in avail]
                    if unknown:
                        errs.append(f"{sid}: requiresCount unknown items {unknown}")
                    if rc['min'] > len(rc['of']):
                        errs.append(f"{sid}: requiresCount min {rc['min']} > pool {len(rc['of'])}")
                for skid, rank in (c.get('skillRequires') or {}).items():
                    if skid not in skill_ids:
                        errs.append(f"{sid}: skillRequires unknown skill '{skid}'")
                    elif rank > skill_max:
                        errs.append(f"{sid}: skillRequires {skid} {rank} > skillMax {skill_max}")
                    elif rank > max_rank:
                        errs.append(f"{sid}: skillRequires {skid} {rank} unreachable here (max {max_rank})")

            # every non-end scene needs >=1 fully ungated choice (no soft-locks)
            if not s.get('end'):
                open_choices = [c for c in s.get('choices', [])
                                if not c.get('requires') and not c.get('skillRequires')
                                and not c.get('requiresCount')]
                if s.get('choices') and not open_choices:
                    errs.append(f"{sid}: all choices gated (possible soft-lock)")

        # thread flags must be silent + persistent
        for iid, sid in chapter_items.items():
            it = scenes[sid]['item']
            if iid in THREAD_FLAGS:
                if not it.get('silent'):
                    errs.append(f"{sid}: thread flag '{iid}' not silent")
                if not it.get('persistent'):
                    errs.append(f"{sid}: thread flag '{iid}' not persistent")
                thread_granted.add(iid)

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

        for summ in ch.get('summaries', []):
            for req in summ.get('requires', []):
                if req not in avail:
                    errs.append(f"manifest summary requires unknown item '{req}'")
        if ch.get('summaries') and ch['summaries'][-1].get('requires'):
            errs.append("last manifest summary is conditional (needs an unconditional fallback)")

        for iid, sid in chapter_items.items():
            if scenes[sid]['item'].get('persistent'):
                persistent_so_far.add(iid)

        points_before += WAYPOINT_PLAN.get(ch['id'], 0)

        status = "OK" if not errs else "FAIL"
        print(f"[{ch['id']}] {status}: {len(scenes)} scenes, {len(chapter_items)} items, "
              f"waypoints={[(sid, w.get('points')) for sid, w in waypoints]}, ends={ends}")
        for e in errs:
            ok = False
            print(f"    ! {e}")

    print(f"\npersistent items so far: {sorted(persistent_so_far)}")
    print(f"thread flags granted so far ({len(thread_granted)}/8): {sorted(thread_granted)}")
    print(f"total skill points scheduled: {points_before}")
    sys.exit(0 if ok else 1)

main()

#!/usr/bin/env python3
"""Contour v0.5 model checker.

A Contour model is one model at one level. It can be completed top-down —
from the Actors the System serves and the Functions they need — or bottom-up,
from the Components and Interfaces found in source code. This checker reports
two kinds of finding:

  CONTRADICTION  something that can't be true however the model was started:
                 an unknown reference, a Data Object with two owners, a
                 response map that misses an outcome. The model is wrong.
  GAP            something not filled in yet. Each gap says what the next step
                 would be from each direction. The model is incomplete.

    python3 contour-check.py contour-engine.yaml

Exit status 1 when there are contradictions, 0 otherwise.
"""
import sys
import yaml

PRINCIPLES = {"principle 4: data has a home"}


def check(model):
    contradictions, gaps = [], []

    def bad(rule, msg):
        contradictions.append(f"[{rule}] {msg}")

    def gap(rule, msg, top_down, bottom_up):
        gaps.append(f"[{rule}] {msg}\n      top-down:  {top_down}\n      bottom-up: {bottom_up}")

    S = model["System"]
    funcs = {f["name"]: f for f in S.get("functions", [])}
    data = {d["name"] for d in S.get("dataObjects", [])}
    events = {e["name"] for e in S.get("events", [])}
    comps = {c["name"]: c for c in S.get("components", [])}
    ifaces = {i["name"]: i for i in S.get("interfaces", [])}
    actors = {a["name"]: a for a in model.get("Actor", [])}
    reqs = {r["name"] for r in model.get("Requirement", [])}
    grds = {g["name"] for g in model.get("Guardrail", [])}

    def outcomes(f):
        return {f["result"]} | set((f.get("alternatives") or {}).keys())

    def exposed(i):
        ex = i.get("exposes") or []
        return set(ex if isinstance(ex, list) else ex.keys())

    def event_triggered(name):
        return "consumes" in ((funcs.get(name, {}).get("steps") or [{}])[0])

    # ── References: always contradictions when they don't resolve ─────────
    for a in actors.values():
        for n in a.get("needs", []):
            if n not in funcs:
                bad("R1", f"Actor {a['name']} needs unknown Function {n}")
            elif event_triggered(n):
                bad("R1", f"Actor {a['name']} needs Event-triggered Function {n}")
    for f in funcs.values():
        alts = set((f.get("alternatives") or {}).keys())
        for i, st in enumerate(f.get("steps") or []):
            if "consumes" in st and i:
                bad("R2", f"{f['name']}: consumes is not the first step")
            for verb, pool in (("calls", funcs), ("reads", data), ("modifies", data), ("produces", events)):
                if verb in st and st[verb] not in pool:
                    bad("R2", f"{f['name']}: {verb} unknown {st[verb]}")
            if "calls" in st and st["calls"] in funcs:
                for k, v in (st.get("becomes") or {}).items():
                    if k not in outcomes(funcs[st["calls"]]):
                        bad("R2", f"{f['name']}: {k} is not an outcome of {st['calls']}")
                    if v not in alts:
                        bad("R2", f"{f['name']}: {v} is not one of its alternatives")
        for st in f.get("steps") or []:
            if "uses" not in st:
                continue
            iname, _, target = st["uses"].partition(" / ")
            mapped = st.get("becomes") or {}
            if iname not in ifaces:
                bad("R2", f"{f['name']}: uses unknown Interface {iname}")
            elif target not in exposed(ifaces[iname]):
                bad("R2", f"{f['name']}: {iname} doesn't expose {target}")
            if "Unreachable" not in mapped:
                bad("R2", f"{f['name']}: uses {st['uses']} without mapping Unreachable")
            for k, v in mapped.items():
                if target in funcs and k != "Unreachable" and k not in outcomes(funcs[target]):
                    bad("R2", f"{f['name']}: {k} is not an outcome of {target}")
                if v not in alts:
                    bad("R2", f"{f['name']}: {v} is not one of its alternatives")
    for i in ifaces.values():
        if i.get("serves") != "Components" and i.get("serves") not in actors:
            bad("R3", f"Interface {i['name']} serves unknown caller {i.get('serves')}")
        ex = i.get("exposes") or []
        for n in exposed(i):
            if n not in funcs:
                bad("R3", f"Interface {i['name']} exposes unknown Function {n}")
            elif event_triggered(n):
                bad("R3", f"Interface {i['name']} exposes Event-triggered Function {n}")
            elif isinstance(ex, dict) and set(ex[n].get("responses", {})) != outcomes(funcs[n]):
                bad("R3", f"{i['name']} / {n}: responses don't cover exactly its outcomes")
        if i.get("implementedBy") and i["implementedBy"] not in comps:
            bad("R3", f"Interface {i['name']} implemented by unknown Component {i['implementedBy']}")
    for c in comps.values():
        for field, pool, kind in (("performs", funcs, "Function"), ("owns", data, "Data Object"),
                                  ("produces", events, "Event"), ("implements", ifaces, "Interface")):
            for n in c.get(field) or []:
                if n not in pool:
                    bad("R4", f"{c['name']} {field} unknown {kind} {n}")
        for n in c.get("implements") or []:
            if n in ifaces and ifaces[n].get("implementedBy") not in (None, c["name"]):
                bad("R4", f"{c['name']} implements {n}, which names {ifaces[n]['implementedBy']} as implementer")
    holders = ([S] + list(funcs.values()) + list(actors.values()) + S.get("dataObjects", [])
               + list(comps.values()) + list(ifaces.values()))
    for h in holders:
        for r in h.get("requirements") or []:
            if r not in reqs:
                bad("R5", f"{h['name']}: undefined Requirement {r}")
        for g in h.get("guardrails") or []:
            if g not in grds:
                bad("R5", f"{h['name']}: undefined Guardrail {g}")
    for x in list(comps.values()) + list(ifaces.values()):
        for b in x.get("rationale") or []:
            ok = (b in reqs or b in grds or b in PRINCIPLES or b.startswith("allocation:")
                  or (b.endswith(" needs") and b[:-6] in actors))
            if not ok:
                bad("R6", f"{x['name']}: rationale '{b}' names nothing in the model")

    # ── Allocation: contradictions when doubled or split; gaps when missing ──
    if comps:
        performer, owner, producer = {}, {}, {}
        for field, index, kind, pool in (("performs", performer, "Function", funcs),
                                         ("owns", owner, "Data Object", data),
                                         ("produces", producer, "Event", events)):
            for c in comps.values():
                for n in c.get(field) or []:
                    if n in index:
                        bad("A1", f"{kind} {n} is allocated to both {index[n]} and {c['name']}")
                    index[n] = c["name"]
            for n in pool:
                if n not in index:
                    gap("A2", f"{kind} {n} isn't allocated to a Component",
                        f"decide which Component {field} it, from the Requirements and Guardrails",
                        f"find where the code implements it and record that Component's `{field}`")
        for f in funcs.values():
            pc = performer.get(f["name"])
            for st in f.get("steps") or []:
                for verb in ("reads", "modifies"):
                    if verb in st and pc and owner.get(st[verb]) not in (None, pc):
                        bad("A3", f"{f['name']} on {pc} {verb} {st[verb]}, owned by {owner[st[verb]]} (principle 4)")
                if "produces" in st and pc and producer.get(st["produces"]) not in (None, pc):
                    bad("A3", f"{f['name']} on {pc} produces {st['produces']}, allocated to {producer[st['produces']]}")
                if "calls" in st and pc and performer.get(st["calls"]) not in (None, pc):
                    there = performer[st["calls"]]
                    gap("A7", f"{f['name']} on {pc} calls {st['calls']} on {there}: the call crosses Components",
                        f"expose {st['calls']} on an Interface of {there} serving Components and turn the step into "
                        f"`uses: <Interface> / {st['calls']}` with Unreachable mapped",
                        f"find the client {pc} uses to reach {there} and record that Interface")
        for i in ifaces.values():
            if not i.get("implementedBy"):
                gap("A4", f"Interface {i['name']} isn't allocated to a Component",
                    "decide which Component implements it", "find the deployable that serves it")
                continue
            here = i["implementedBy"]
            for n in sorted(exposed(i)):
                if performer.get(n) not in (None, here):
                    bad("A5", f"Interface {i['name']} on {here} exposes {n}, performed by {performer[n]}: "
                              f"an Interface exposes only Functions its Component performs")
        for f in funcs.values():
            pc = performer.get(f["name"])
            for st in f.get("steps") or []:
                iname = st.get("uses", "").partition(" / ")[0]
                i = ifaces.get(iname)
                if not (i and pc and i.get("implementedBy")) or i["implementedBy"] == pc:
                    continue
                if i.get("serves") not in ("Components",):
                    bad("A6", f"{f['name']} on {pc} uses {iname}, which serves {i.get('serves')}, not Components")
    elif funcs:
        gaps.append("[A0] No Components yet: the model says what the System does, not how it is split.\n"
                    "      top-down:  allocate Functions and Data Objects once Requirements say what must change or scale apart\n"
                    "      bottom-up: record the deployables found in the code as Components")

    # ── Actor needs and Interfaces: the two directions meet here ──────────
    for a in actors.values():
        serving = [i for i in ifaces.values() if i.get("serves") == a["name"]]
        got = set().union(*[exposed(i) for i in serving]) if serving else set()
        need = set(a.get("needs", []))
        if not need and got:
            gap("N1", f"Actor {a['name']} has Interfaces but no stated needs",
                "state the Functions this Actor needs",
                f"take them from what its Interfaces expose: {sorted(got)[:3]}…")
        if not serving and need:
            gap("N2", f"Actor {a['name']} needs {len(need)} Functions but no Interface serves it",
                "add an Interface for this Actor, its binding chosen by the Actor's channel Requirement",
                "find the entry point this Actor uses in the code")
        for n in sorted(need - got) if serving else []:
            gap("N3", f"Actor {a['name']} needs {n}, but no Interface serving it exposes it",
                f"expose {n} on an Interface serving {a['name']}",
                f"check whether {a['name']} really needs it; if not, drop it from `needs`")
        for n in sorted(got - need) if need else []:
            gap("N4", f"An Interface exposes {n} to {a['name']}, who isn't recorded as needing it",
                f"remove it from the Interface if {a['name']} doesn't need it",
                f"add it to {a['name']}'s `needs`")

    # ── Rationale: why a Component or Interface exists ─────────────────────
    for x in list(comps.values()) + list(ifaces.values()):
        if not x.get("rationale"):
            kind = "Component" if x["name"] in comps else "Interface"
            gap("W1", f"{kind} {x['name']} has no rationale",
                "it should not exist yet — derive it from a need, Requirement or Guardrail",
                "state the Requirement or Guardrail that explains why the code has it")

    return contradictions, gaps


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    with open(argv[1]) as f:
        contradictions, gaps = check(yaml.safe_load(f))
    for c in contradictions:
        print("CONTRADICTION", c)
    for g in gaps:
        print("GAP", g)
    print(f"{len(contradictions)} contradiction(s), {len(gaps)} gap(s)")
    return 1 if contradictions else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

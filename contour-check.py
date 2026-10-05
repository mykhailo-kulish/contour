#!/usr/bin/env python3
"""Contour v0.5 cross-layer checker.

Checks a specification (top-down) and an implementation (bottom-up) against
the v0.5 rules: the specification is internally consistent, and the
implementation is a complete, traceable derivation of it.

    python3 contour-check.py contour-engine.spec.yaml contour-engine.impl.yaml

Exit status 0 when every rule passes, 1 otherwise.
"""
import sys
import yaml

PRINCIPLES = {"principle 4: data has a home"}


def load(path):
    with open(path) as f:
        return yaml.safe_load(f)


def check(spec, impl):
    errors = []

    def err(rule, msg):
        errors.append(f"[{rule}] {msg}")

    S = spec["System"]
    funcs = {f["name"]: f for f in S.get("functions", [])}
    data = {d["name"] for d in S.get("dataObjects", [])}
    events = {e["name"] for e in S.get("events", [])}
    actors = {a["name"]: a for a in spec.get("Actor", [])}
    reqs = {r["name"] for r in spec.get("Requirement", [])} | {
        r["name"] for r in impl.get("Requirement", [])}
    grds = {g["name"] for g in spec.get("Guardrail", [])} | {
        g["name"] for g in impl.get("Guardrail", [])}

    def outcomes(f):
        return {f["result"]} | set((f.get("alternatives") or {}).keys())

    # ── Specification ────────────────────────────────────────────────────
    # S1: every Function an Actor needs exists.
    for a in actors.values():
        for n in a.get("needs", []):
            if n not in funcs:
                err("S1", f"Actor {a['name']} needs unknown Function {n}")

    # S2: steps reference existing Functions, Data Objects and Events;
    #     consumes only first; becomes maps real outcomes onto own alternatives.
    for f in funcs.values():
        alts = set((f.get("alternatives") or {}).keys())
        for i, st in enumerate(f.get("steps") or []):
            if "consumes" in st and i:
                err("S2", f"{f['name']}: consumes is not the first step")
            for verb, pool in (("calls", funcs), ("reads", data), ("modifies", data), ("produces", events)):
                if verb in st and st[verb] not in pool:
                    err("S2", f"{f['name']}: {verb} unknown {st[verb]}")
            if "calls" in st and st["calls"] in funcs:
                callee = funcs[st["calls"]]
                for k, v in (st.get("becomes") or {}).items():
                    if k not in outcomes(callee):
                        err("S2", f"{f['name']}: {k} is not an outcome of {callee['name']}")
                    if v not in alts:
                        err("S2", f"{f['name']}: {v} is not one of its alternatives")

    # S3: a Function started by an Event is needed by no Actor.
    for a in actors.values():
        for n in a.get("needs", []):
            steps = (funcs.get(n) or {}).get("steps") or [{}]
            if "consumes" in steps[0]:
                err("S3", f"Actor {a['name']} needs Event-triggered Function {n}")

    # S4: every Requirement and Guardrail referenced is defined.
    holders = [S] + list(funcs.values()) + list(actors.values()) + S.get("dataObjects", [])
    for h in holders:
        for r in h.get("requirements") or []:
            if r not in reqs:
                err("S4", f"{h['name']}: undefined Requirement {r}")
        for g in h.get("guardrails") or []:
            if g not in grds:
                err("S4", f"{h['name']}: undefined Guardrail {g}")

    # ── Implementation ───────────────────────────────────────────────────
    I = impl["Implementation"]
    if I.get("system") != S["name"]:
        err("I0", f"implementation is of {I.get('system')}, specification is of {S['name']}")
    comps = {c["name"]: c for c in I.get("components", [])}
    ifaces = {i["name"]: i for i in I.get("interfaces", [])}

    # I1: every Function performed, every Data Object owned, every Event produced
    #     by exactly one Component; nothing allocated that the spec doesn't define.
    for kind, pool, field in (("Function", funcs, "performs"), ("Data Object", data, "owns"), ("Event", events, "produces")):
        holders_of = {}
        for c in comps.values():
            for n in c.get(field) or []:
                if n not in pool:
                    err("I1", f"{c['name']} {field} unknown {kind} {n}")
                holders_of.setdefault(n, []).append(c["name"])
        for n in pool:
            h = holders_of.get(n, [])
            if len(h) != 1:
                err("I1", f"{kind} {n} is allocated to {len(h)} Components {h or ''}".rstrip())

    performer = {n: c["name"] for c in comps.values() for n in c.get("performs") or []}
    owner = {n: c["name"] for c in comps.values() for n in c.get("owns") or []}
    producer = {n: c["name"] for c in comps.values() for n in c.get("produces") or []}

    # I2: reads/modifies stay inside the performing Component (principle 4);
    #     an Event is produced by the Component performing the Function that produces it.
    for f in funcs.values():
        pc = performer.get(f["name"])
        for st in f.get("steps") or []:
            for verb in ("reads", "modifies"):
                if verb in st and owner.get(st[verb]) not in (None, pc):
                    err("I2", f"{f['name']} on {pc} {verb} {st[verb]} owned by {owner.get(st[verb])}")
            if "produces" in st and producer.get(st["produces"]) not in (None, pc):
                err("I2", f"{f['name']} on {pc} produces {st['produces']} allocated to {producer.get(st['produces'])}")
            if "calls" in st and performer.get(st["calls"]) not in (None, pc):
                err("I2", f"{f['name']} calls {st['calls']} across Components ({pc} → {performer.get(st['calls'])}); "
                          f"split by allocation, it needs a uses through an Interface")

    # I3: every Interface is implemented by exactly one Component, which lists it.
    for i in ifaces.values():
        c = i.get("implementedBy")
        if c not in comps:
            err("I3", f"Interface {i['name']} implemented by unknown Component {c}")
        elif i["name"] not in (comps[c].get("implements") or []):
            err("I3", f"{c} does not list Interface {i['name']} in implements")
    for c in comps.values():
        for n in c.get("implements") or []:
            if n not in ifaces or ifaces[n].get("implementedBy") != c["name"]:
                err("I3", f"{c['name']} implements {n}, which names another implementer")

    def exposed(i):
        ex = i.get("exposes") or []
        return set(ex if isinstance(ex, list) else ex.keys())

    # I4: each Actor's needs are covered exactly by the Interfaces serving it.
    for a in actors.values():
        got = set().union(*[exposed(i) for i in ifaces.values() if i.get("serves") == a["name"]] or [set()])
        need = set(a.get("needs", []))
        for n in sorted(need - got):
            err("I4", f"Actor {a['name']} needs {n}, but no Interface serving it exposes it")
        for n in sorted(got - need):
            err("I4", f"an Interface exposes {n} to {a['name']}, who doesn't need it")

    # I5: Interfaces serve an Actor or Components; exposed Functions exist and
    #     are not Event-triggered; responses cover exactly the Function's outcomes.
    for i in ifaces.values():
        if i.get("serves") != "Components" and i.get("serves") not in actors:
            err("I5", f"Interface {i['name']} serves unknown caller {i.get('serves')}")
        ex = i.get("exposes") or []
        for n in exposed(i):
            if n not in funcs:
                err("I5", f"Interface {i['name']} exposes unknown Function {n}")
                continue
            if "consumes" in ((funcs[n].get("steps") or [{}])[0]):
                err("I5", f"Interface {i['name']} exposes Event-triggered Function {n}")
            if isinstance(ex, dict) and set(ex[n].get("responses", {})) != outcomes(funcs[n]):
                err("I5", f"{i['name']} / {n}: responses don't cover exactly its outcomes")

    # I6: an Interface whose Functions are performed elsewhere goes `through` an
    #     internal Interface (serves Components) that the performing Component
    #     implements and that exposes those Functions.
    for i in ifaces.values():
        here = i.get("implementedBy")
        remote = {n for n in exposed(i) if performer.get(n) not in (None, here)}
        if not remote:
            if i.get("through"):
                err("I6", f"Interface {i['name']} goes through {i['through']} but its Functions are performed locally")
            continue
        t = ifaces.get(i.get("through"))
        if not t:
            err("I6", f"Interface {i['name']} presents Functions performed elsewhere {sorted(remote)} but names no internal Interface")
            continue
        if t.get("serves") != "Components":
            err("I6", f"{i['name']} goes through {t['name']}, which doesn't serve Components")
        for n in remote:
            if n not in exposed(t) or performer.get(n) != t.get("implementedBy"):
                err("I6", f"{i['name']} reaches {n} through {t['name']}, which doesn't expose it from its performer")

    # I7: every Component and Interface names a basis that resolves to an
    #     Actor's needs, a Requirement, a Guardrail, a principle, or an allocation.
    for x in list(comps.values()) + list(ifaces.values()):
        basis = x.get("basis") or []
        if not basis:
            err("I7", f"{x['name']} has no basis")
        for b in basis:
            ok = (b in reqs or b in grds or b in PRINCIPLES or b.startswith("allocation:")
                  or (b.endswith(" needs") and b[:-6] in actors))
            if not ok:
                err("I7", f"{x['name']}: basis '{b}' resolves to nothing in the specification")

    # I8: requirements and guardrails referenced in the implementation are defined.
    for x in list(comps.values()) + list(ifaces.values()):
        for r in x.get("requirements") or []:
            if r not in reqs:
                err("I8", f"{x['name']}: undefined Requirement {r}")
        for g in x.get("guardrails") or []:
            if g not in grds:
                err("I8", f"{x['name']}: undefined Guardrail {g}")

    return errors


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    errors = check(load(argv[1]), load(argv[2]))
    for e in errors:
        print(e)
    print(f"{len(errors)} problem(s)" if errors else "all checks passed")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

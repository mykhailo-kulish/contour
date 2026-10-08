#!/usr/bin/env python3
"""Claude Code UserPromptSubmit hook: when a prompt asks to model, reverse-engineer
or verify with Contour, print contour.md so Claude Code adds it to the context
before the contour-reverse or contour-verify skill runs. Silent otherwise; loads
the spec once per session. Ported from skills/.kiro/hooks/contour-autoload-spec.json.
"""
import sys, os, json, re

# Resolve the project root (Claude Code exports CLAUDE_PROJECT_DIR to hooks)
root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

# Read the prompt payload from stdin (UserPromptSubmit provides JSON on stdin)
raw = sys.stdin.read() if not sys.stdin.isatty() else ""
prompt = ""
if raw.strip():
    try:
        data = json.loads(raw)
        # Try common field names for the user's prompt text
        for k in ("prompt", "userPrompt", "message", "text", "input"):
            v = data.get(k) if isinstance(data, dict) else None
            if isinstance(v, str) and v:
                prompt = v
                break
        if not prompt and isinstance(data, dict):
            prompt = json.dumps(data)
    except Exception:
        prompt = raw

text = prompt.lower()

# Only fire for Contour analyze/verify intent.
if "contour" not in text:
    sys.exit(0)

intent = ("analyze", "analyse", "verify", "audit", "check", "reconcile",
          "model", "extract", "reverse", "document", "record", "spec",
          "requirement", "guardrail", "cyclomatic", "branch")
if not any(w in text for w in intent):
    sys.exit(0)

# Load the spec once per session (guard file in temp, keyed by session_id).
session = ""
try:
    session = json.loads(raw).get("session_id", "") if raw.strip() else ""
except Exception:
    pass
guard = os.path.join(os.environ.get("TMPDIR", "/tmp"),
                     "claude_contour_spec_loaded_" + re.sub(r"[^A-Za-z0-9_-]", "", session or "default"))
if os.path.exists(guard):
    sys.exit(0)

spec_path = os.path.join(root, "contour.md")
if not os.path.isfile(spec_path):
    sys.exit(0)

try:
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = f.read()
except Exception:
    sys.exit(0)

try:
    open(guard, "w").close()
except Exception:
    pass

print("The request relates to the Contour framework. Before applying the "
      "contour-reverse or contour-verify skill, use the framework spec below "
      "(contour.md, Contour v0.5) as the normative reference: the seven "
      "elements, nine relationship verbs (the Component-to-Component one spelled "
      "depends-on), the two zoom levels (Context view and Functionality view), "
      "Interfaces that declare no owning Component and serve one caller (an Actor "
      "or the reserved word System), Section 3.6 Requirements and Guardrails "
      "(enforced, not declarative), and Section 3.7 One Model, Two Directions "
      "(contradiction vs gap, rationale on Components and Interfaces, Actor uses "
      "equals what serving Interfaces expose, and the half-open Neighbour block). "
      "The record shape is defined in contour.schema.json (local YAML) and the "
      "contour-engine MCP tools; when no MCP engine is available, contour-check.py "
      "in the repo runs the Section 3.3 contradictions and Section 3.7 gaps over a "
      "local YAML model and exits non-zero only on contradictions.\n")
print("===== BEGIN contour.md =====")
print(spec)
print("===== END contour.md =====")

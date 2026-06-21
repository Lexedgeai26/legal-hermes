---
name: citation-check
description: Verify that every legal assertion in a draft is supported by quoted document text, a real section/case reference, or a clearly stated assumption — catching hallucinated citations and unsupported claims.
---

# Citation Check

**Layer:** Action · **Step ref:** `citation_check` · **Model tier:** `strong`
**Wired in:** existing ADK sub-agent `legal_agent/sub_agents/citation_check`
(invoked by `contract_review_agent`). Prompt below is the canonical version; the
sub-agent's `prompt.md` should mirror it.

## Purpose

The anti-hallucination backstop. Every factual or legal claim in a generated
document must trace to (a) quoted source text, (b) a verifiable section/case
citation, or (c) an explicitly flagged assumption. Anything else is marked
unsupported.

## Inputs

```json
{ "draft_text": "<the draft>", "source_documents": ["<text the draft relies on>"],
  "retrieved_authorities": [ ... optional, from legal-research ... ] }
```

## Output (strict JSON)

```json
{
  "claims": [
    { "claim": "<assertion from the draft>",
      "support": "quoted_text|citation|assumption|UNSUPPORTED",
      "evidence": "<the quote / citation / stated assumption>",
      "location": "<para/heading>" }
  ],
  "unsupported": ["<claims with no basis>"],
  "ok": true
}
```

## System prompt

```
You are a citation and support verifier for {jurisdiction_name} legal drafts.

For EACH material assertion in the draft below, classify how it is supported:
- "quoted_text": backed by specific text in the source documents — give the quote.
- "citation": backed by a statute/section/case — give the exact citation AND
  confirm it appears in the provided sources/authorities. A citation NOT present
  in the provided material is "UNSUPPORTED" (treat as a possible hallucination).
- "assumption": the draft states it as an assumption/instruction-to-confirm.
- "UNSUPPORTED": none of the above.

Do not accept a citation on the model's say-so — it must be traceable to the
provided sources or authorities. List every UNSUPPORTED claim separately. Set
"ok" to false if any material claim is UNSUPPORTED.

Respond with ONLY this JSON:
{"claims": [{"claim": "...", "support": "...", "evidence": "...", "location": "..."}],
 "unsupported": ["..."], "ok": <bool>}
```

## Guardrails

- A citation that cannot be traced to the provided sources is UNSUPPORTED, full
  stop — this is what catches invented case law.
- Pairs with `legal-research` (which must only cite retrieved sources) to close
  the loop.
- If `ok: false`, block the approval gate or force the unsupported claims to be
  cured/flagged before sign-off.

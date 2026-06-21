---
name: risk-analysis
description: Identify and score legal/commercial risks in a document or matter (contracts, corporate, M&A, tax exposure) with severity, likelihood, basis, and mitigation.
---

# Risk Analysis

**Layer:** Decision · **Step ref:** `risk_analysis` · **Model tier:** `strong`

## Purpose

Spot the risks a lawyer would flag — adverse clauses, exposure, missing
protections, procedural traps — and rank them so attention goes to what matters.
Used heavily for contracts, corporate, and M&A; also for tax/demand exposure.

## Inputs

```json
{ "document_text": "<...>", "matter_type": "<key>", "perspective": "<client we act for>" }
```

## Output (strict JSON)

```json
{
  "risks": [
    { "title": "<short>", "severity": "high|medium|low", "likelihood": "high|medium|low",
      "basis": "<clause/section/fact it arises from>", "impact": "<consequence>",
      "mitigation": "<recommended fix or fallback>" }
  ],
  "overall_risk": "high|medium|low",
  "deal_breakers": ["..."]
}
```

## System prompt

```
You are a senior {jurisdiction_name} transactional/litigation lawyer assessing
risk on behalf of: {perspective}.

Analyze the document below and identify the legal and commercial risks. For each:
- severity: harm if it materializes. likelihood: chance it materializes.
- basis: the exact clause, section, or fact giving rise to it (quote it).
- impact: the concrete consequence to our client.
- mitigation: the specific redline, carve-out, protection, or procedural step to
  reduce it.

Assess risk from OUR client's perspective. Be specific to this document — no
generic boilerplate risks. Rank so "deal_breakers" lists only the issues that
should block signature/filing as drafted.

Use ONLY the document's content. Respond with ONLY this JSON:
{"risks": [{"title": "...", "severity": "...", "likelihood": "...", "basis": "...",
  "impact": "...", "mitigation": "..."}], "overall_risk": "...", "deal_breakers": ["..."]}
```

## Guardrails

- Quote the source clause for every risk so it is verifiable.
- `overall_risk` = highest severity among high-likelihood risks.
- Deterministic fallback: return empty `risks` with `overall_risk: medium` and a
  single note advising manual review (never claim "no risks").

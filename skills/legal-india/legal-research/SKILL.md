---
name: legal-research
description: Synthesise Indian legal research using only retrieved or advocate-provided authorities, with exact citations, source traceability, and explicit gaps where sources are insufficient.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, research, citations, authorities]
    category: legal-india
---

# Legal Research

## When to Use

Use this when the user needs Indian legal research for a draft, opinion, notice, litigation strategy, compliance review, GST reply, or advisory memo.

This skill is only for synthesis over retrieved, uploaded, or advocate-provided authorities. It is not a license to cite from model memory.

## Procedure

1. Identify the issue, domain, matter type, forum, jurisdiction, and party perspective.
2. Confirm the source set: retrieved judgments, statutes, rules, circulars, notifications, pleadings, uploaded documents, or connected trusted legal/GST source results.
3. If no source set is available, say retrieval is required and list the specific sources or searches needed. Do not invent authorities.
4. For each proposition, cite the exact authority as it appears in the source set and identify the source id/title.
5. Summarise the holding, rule, or statutory point and explain its relevance as high, medium, or low.
6. List gaps for sub-issues the source set does not answer.
7. Mark whether the research is sufficient for drafting, opinion work, or only preliminary review.
8. Run or request `citation-check` before any researched proposition is used in a draft or opinion.

## Pitfalls

- Never cite a case, circular, notification, statute, or section from memory.
- Do not treat search snippets, summaries, or uncited propositions as authorities.
- Do not overstate thin or distinguishable authority.
- Do not hide missing law; put it in gaps.

## Verification

- Every cited authority traces to a provided or retrieved source.
- Every finding includes relevance and source basis.
- Gaps are explicit.
- Research is passed to citation-check before drafting or opinion finalisation.

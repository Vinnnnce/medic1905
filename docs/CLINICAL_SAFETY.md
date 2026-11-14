# Medic1905 — Clinical Safety & Simulation Governance

## Core declaration

Medic1905 is an **educational simulation environment**. It contains no real patients and connects to no real clinical system. It must never be used for real patient care, prescribing, dispensing, surgical planning or any clinical decision.

## Safety controls implemented

1. **Permanent simulation labelling** — a hazard-striped banner appears on every authenticated page: "SIMULATED ENVIRONMENT — ALL PATIENTS ARE SYNTHETIC."
2. **Synthetic data only** — patients, names, hospitals and the nation itself are fictional. Seeded data is generated, never sourced from real records.
3. **No clinical-system connectivity** — no integration points exist to EHRs, prescribing services, dispensing systems or medical devices. The prescribing module is deliberately self-contained.
4. **Deterministic clinical truth** — vital signs, laboratory values, imaging findings, disease progression and outcomes are produced exclusively by the validated rule engine (`engines/physiology.js`). Language layers may present, never invent, clinical state.
5. **Safe medication simulation** — the formulary encodes allergy cross-reactivity, interactions, contraindications, renal dosing and high-alert flags; critical allergy matches block administration outright.
6. **Instructor overrides** — pause/resume, complication injection and phase control, all audit-logged.
7. **Reproducibility** — scenarios are versioned JSON documents; runs record every event with timestamps for exact replay review.
8. **Audit trail** — logins, run lifecycle, publishing, instructor actions and role changes are all recorded.
9. **Honest assessment framing** — scores are educational feedback. The platform states explicitly that simulation performance is not a licence, qualification or certification.
10. **Educational AI ≠ clinical decision support** — the AI patient is a role-play agent, not an advisor. No module produces guidance intended for real clinical use.

## Governance requirements for scenario authors

- Every published case must be reviewed by a qualified clinical educator before release.
- Cases must cite evidence-based references in their debrief.
- Clinical protocols referenced in cases should be version-controlled (e.g. NICE/BTS/ESC guideline versions noted).
- Complication triggers and physiology values must be defensible clinically; when simplification is used, the debrief must state it.

## Incident handling

Any clinically misleading content found in a case should be corrected and the case re-reviewed before republication. The audit log supports incident investigation.

# Medic1905 — Technical Architecture

## 1. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 18+ (Express) | Single dependency set, fast, universally deployable |
| Database | SQLite (better-sqlite3, WAL) | Zero-configuration relational store; ideal for training deployments; swap-able for Postgres via the data-access layer |
| Auth | Bearer tokens (bcryptjs hashes, 7-day sessions in `sessions`) | Simple, stateless-ish, auditable |
| Frontend | Vanilla JS SPA, hash routing, custom CSS design system | Zero build step — `npm start` serves everything |
| AI | Hybrid: deterministic engine + rule-based NLU | Clinical validity by construction (see §3) |

## 2. Data model

Core tables: `users`, `sessions`, `regions` → `cities` → `hospitals` → `hospital_departments` ↔ `departments`, `drugs`, `lab_catalog`, `imaging_catalog`, `cases`, `case_runs` (embedded engine `state` JSON), `run_participants`, `run_events`, `chat_messages`, `orders`, `prescriptions`, `clinical_notes`, `nursing_observations`, `audit_log`.

Full SQL: `server/db/schema.sql`.

## 3. The hybrid AI patient architecture (critical design rule)

**Deterministic, clinically validated engine owns all clinical truth.** Generative/rule-based language layers may only *present* engine state, never create it.

- `engines/physiology.js` — vitals per phase (with intervention offsets), NEWS2, phase machine (timeout → deterioration; critical management completion → stabilization), complications with triggers (`afterMin`, `ifNotDone`, `chance`), arrest → defibrillation handling, death and recovery states.
- `engines/conversation.js` — intent classification over the case's interview script (keyword matching, longest-match wins). Patients answer only what they are asked; hidden diagnoses are never revealed ("that is what I am hoping you will tell me, doctor"). Emotional state (pain/anxiety/confusion) colours tone deterministically.
- `engines/safety.js` — allergy cross-reactivity via class tags, drug–drug interactions from the formulary, renal flags by eGFR, contraindication surfacing, high-alert flags. Critical allergy matches **block** administration.
- `engines/scoring.js` — nine-dimension rubric scoring from recorded events, with debrief assembly.

## 4. Case scenario schema

```jsonc
{
  "patient": { "name": "...", "age": 58, "sex": "M", "occupation": "...", "city": "..." },
  "presentation": { "setting": "Emergency & Trauma Department", "triage": "category 2", "initial": "..." },
  "history": { "complaint": "...", "pmh": [], "meds": [], "allergies": [{ "drug": "Penicillin", "reaction": "rash" }], "family": [], "social": {} },
  "emotions": { "pain": 9, "anxiety": 8, "confusion": 0 },
  "interview": [ { "tags": ["site"], "match": ["where", "site"], "a": "patient answer" } ],
  "exam": { "general": "...", "systems": { "cardiovascular": "...", "respiratory": "..." } },
  "baselineVitals": { "hr": 96, "sbp": 148, "dbp": 92, "rr": 22, "temp": 36.8, "spo2": 91, "gcs": 15, "pain": 9 },
  "labs": { "baseline": { "troponin": 52 }, "phases": { "1": { "troponin": 1120 } } },
  "imaging": { "ecg_12": { "finding": "...", "phases": [0, 1] } },
  "hidden": { "diagnosis": "...", "aliases": ["stem"], "differentials": [{ "dx": "...", "why": "..." }] },
  "management": [ { "id": "ecg", "type": "imaging", "item": "ecg_12", "label": "12-lead ECG within 10 min", "withinMin": 10, "critical": true, "points": 10 } ],
  "phases": [ { "id": 0, "name": "...", "maxMin": 20, "timeoutNext": 1, "stabilizeNext": "stable", "vitals": {} } ],
  "interventions": { "aspirin": { "sbp": -4 }, "morphine": { "pain": -4 } },
  "complications": [ { "id": "vf_arrest", "trigger": { "phase": 1, "afterMin": 8, "ifNotDone": ["ecg"] }, "vitals": {}, "requires": "defib", "deathAfterMin": 4 } ],
  "rubric": { "history": { "points": 10, "criteria": [] }, "management": { "points": 20, "criteria": [] } },
  "debrief": { "summary": "...", "learningPoints": [], "references": [] },
  "theatre": { "procedure": "...", "anaesthesia": "...", "asa": "ASA II", "risks": ["Bleeding", "Infection", "..."], "steps": ["WHO sign-in: ...", "Time-out: ...", "..."] }
}
```

Management step types: `drug` (matched by formulary name), `imaging`/`lab` (matched by catalog key), `procedure` (matched by keyword overlap with learner free text), `oxygen`, `admit`.

The optional `theatre` block activates the surgical theatre module for a case (see §5a). Paediatric cases add `"paediatric_parent": true` to `emotions` so parent-voice interview answers are attributed to the accompanying adult.

## 5. API surface

- `POST /api/auth/login|register|logout`, `GET /api/auth/me`
- `GET /api/country`, `GET /api/departments`, `GET /api/hospitals/:id`
- `GET /api/cases`, `GET /api/cases/:id`, `POST/PUT /api/cases…` (instructor), `/publish`, `/duplicate`
- `GET /api/catalog/labs|imaging|drugs`
- `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/state` (polling)
- `POST /api/runs/:id/chat`, `/exam`, `/orders`, `/prescribe`, `/actions` (oxygen, procedure, defib, diagnosis, admit, note, observation), `GET /api/runs/:id/orders`, `POST /api/runs/:id/end`
- `POST /api/runs/:id/theatre` (actions: `preop`, `consent`, `team`, `signin`, `timeout`, `signout`, `step`, `report`) — surgical theatre workflow, gated to cases with a `theatre` block
- `GET /api/runs/:id/studies` — simulated PACS study list (DICOM-style metadata for every resulted imaging order)
- `GET /api/instructor/runs`, `POST /api/instructor/runs/:id/control` (pause|resume|inject|set_phase)
- `GET /api/admin/stats|users|audit`, `PUT /api/admin/users/:id/role`, `GET /api/admin/learners/:id/report`

## 5a. Surgical theatre module

Cases may carry a `theatre` block: `{ procedure, anaesthesia, asa, risks[], steps[] }`. When present, the encounter shows a Theatre tab with an eight-stage deterministic workflow: preoperative assessment (ASA, airway, fasting, comorbidities, allergy confirmation) → consent simulation (must-discuss procedure-specific risks, alternatives, signatures) → team assignment → WHO Surgical Safety Checklist sign-in / time-out / sign-out → procedure steps with strict correct-order validation (out-of-sequence steps are rejected) → operative report (findings, swab counts, complications). Scoring is fully deterministic (`server/engines/theatre.js`); completing the module credits matching surgical management steps in the physiology engine. Nothing in the theatre flow is AI-generated — all clinical content comes from the case's theatre block. Ten cases carry a theatre block: nine adult surgical cases (appendicitis, preeclampsia/LSCS, upper GI bleeding, SBO, neck of femur, tension pneumothorax, ectopic pregnancy, testicular torsion, cholecystitis) plus the paediatric intussusception case (laparotomy for failed/complicated reduction); the remaining paediatric cases are managed medically and intentionally have none.

## 5b. DICOM viewer & simulated PACS

Every resulted imaging order carries simulated PACS metadata (accession number, Study/Series Instance UIDs under a Medic1905 simulation root, modality, body part, deterministic seed). The client DICOM viewer (`client/assets/js/pages/dicom.js`) renders procedural synthetic images per modality (CR radiographs, CT axial slices, US sectors, ECG traces, MR, NM) from a seeded PRNG — the same seed always renders the same study. CR CHEST rendering is pathology-aware: the radiologist report drives the anatomy. Reported findings map to layered anatomy — a pneumothorax renders an avascular hyperlucent hemithorax with a collapsed-lung stump and mediastinal shift (with a negation guard so "no pneumothorax" never triggers it); hyperinflation (bronchiolitis, COPD) renders taller darker lung fields, flattened diaphragm domes and boosted perihilar markings; consolidation (community-acquired pneumonia) renders a dense lower-lobe opacity on the affected side with branching air-bronchogram streaks (noise level-set curves) plus a small basal effusion meniscus when the report mentions one. Layers compose — the CAP case renders consolidation and effusion over a hyperinflated COPD chest. The viewer supports window/level, zoom, pan, invert, series list and a DICOM metadata panel. All studies are labelled as simulated at every layer; no real patient data exists in the platform.

## 6. Roles & permissions

12 roles: student, intern, resident, specialist, surgeon, anaesthetist, nurse, pharmacist, lab_scientist, radiologist, instructor, admin. Route-level guards (`authMiddleware([roles])`) plus instructor/admin gates on authoring, monitoring and administration. Every sensitive action is written to `audit_log`.

## 7. Interoperability roadmap

HL7 FHIR alignment (Patient, Encounter, Observation, MedicationRequest, DiagnosticReport resources map 1:1 onto existing tables) and DICOM-style study metadata for the radiology catalog are planned in Phase 4 (see IMPLEMENTATION_PLAN.md). The schema was designed so runs can be exported as FHIR bundles without restructuring.

## 8. Extensibility hooks

- Multiplayer: `run_participants` + `run_events` already provide shared state and an event bus; WebSocket fan-out is a transport upgrade.
- Voice: the conversation engine returns text; TTS/STT layers can wrap it without touching clinical logic.
- 3D anatomy: the SVG explorer is structured per-system for replacement by Three.js/WebGL scenes.
- Haptic/external simulators: procedure actions flow through a single `/actions` endpoint — a device bridge can translate hardware events into the same payloads.

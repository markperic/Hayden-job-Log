# The Hayden Shared-Service Tracker — PRD

## Overview
A single-screen Expo mobile dashboard for two business owners (Hayden Andrews and Hayden Bone) who share equipment. Logs jobs across three services, applies ownership-based 20% wholesale discounts automatically, and shows a monthly "who owes who" tally.

## Users & Ownership
- **Hayden Andrews** — owns *Picture Framing* and *Large Format Printing*.
- **Hayden Bone** — owns *Large Format Scanning*.
- No login: an "Acting As" toggle switches the active operator.

## Business Rules
- Owner uses own service → 0% discount.
- Owner uses other Hayden's service → 20% wholesale discount.
- `final_cost = base_price * (1 - discount/100)`, rounded to 2 decimals.

## Storage (Cloud Firestore — direct from device)
- **No backend.** The Expo app talks directly to Google Firestore using the modular Firebase JS SDK from `/app/frontend/src/firebase.ts`.
- Firebase project: `hayden-job-tracker`; named Firestore database: `haydens-job-tracker`.
- `experimentalAutoDetectLongPolling: true` is enabled to survive proxied environments and React Native transport quirks.
- Security rules (open for prototype; tighten before broad release):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if true;
      }
    }
  }
  ```
- The FastAPI/MongoDB backend in `/app/backend` is no longer required by the app and can be deleted once GitHub Pages is the target.

## Data Model (Firestore `jobs` collection)
| Field | Type | Notes |
|---|---|---|
| id | str (uuid) | Primary key |
| user | str | "Hayden Andrews" or "Hayden Bone" |
| service | str | One of the three services |
| base_price | float | Input by user |
| discount_percent | float | Auto-computed (0 or 20) |
| final_cost | float | Auto-computed |
| notes | str | Optional |
| date | str (ISO 8601 UTC) | Set at creation |
| month | str (YYYY-MM) | Indexable bucket |
| archived | bool | Hidden from active ledger when true |

## API (FastAPI, all under `/api`)
- `GET /meta` — users, services, ownership rules.
- `POST /jobs` — create job (server computes discount + final).
- `GET /jobs?month=YYYY-MM&include_archived=bool` — list jobs.
- `DELETE /jobs/{id}` — delete a job.
- `GET /summary?month=YYYY-MM` — totals + net balance + debtor/creditor.
- `GET /months` — distinct months with jobs, plus current.
- `POST /jobs/archive?month=YYYY-MM` — archive (soft-delete) all jobs in the month.

## Screens / Components
- **Header** — title + ACTING-AS segmented control with avatars.
- **Log Job card** — service picker, base price input, notes, live discount/final preview, LOG JOB button.
- **Monthly Tally card** (dark) — Net Balance amount, "X owes Y" subtext, per-user totals, month picker.
- **Jobs Ledger** — list of jobs with colored accent per user, service, final cost, badge, date, discount/base, delete button.
- **Archive Month** button — visible only on current month with jobs.

## Design
Swiss / high-contrast light theme. Andrews = red (#E52B12), Bone = blue (#002FA7). Stark white surfaces on off-white background, dense bold typography, mono-style monetary numbers.

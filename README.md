# SiteProof

**Smart Delivery & Supplier Management Platform** for general contractors and material suppliers in Taiwan.

SiteProof focuses on one workflow, the **Material Delivery Closed-Loop**: a contractor schedules a delivery, the supplier updates its status and uploads quality documents, a site inspector accepts (fully, partially) or rejects it, and the system calculates retention and records a 1–5 supplier rating. Everything lives in **one single delivery record**.

Course project for *Software Engineering in Construction Information Systems* (CT5805701, NTUST).

## Team

| Member | Student ID | Role |
|---|---|---|
| 鄭博浩 | M11505503 | Software Engineer / System Architect |
| A. Samuel Arzamendia | M11405807 | Business Analyst & Quality Control |

## Website organization chart

The chart shows the planned pages of the web application, who is responsible for each one, and the implementation priority (fill color).

```mermaid
graph TD
    HOME["Home / Sign in<br/>UC1<br/>Owner: Po-Hao"]:::p1

    HOME --> CON["Contractor area"]:::p1
    HOME --> SUP["Supplier area"]:::p1
    HOME --> INS["Inspector area"]:::p1

    CON --> C1["My Deliveries<br/>list and status, UC3<br/>Owner: Samuel"]:::p1
    CON --> C2["Create Delivery Record<br/>UC2<br/>Owner: Samuel"]:::p1
    CON --> C3["Delivery Detail<br/>status, documents, acceptance, retention, UC3<br/>Owner: Samuel"]:::p1
    CON --> C4["Complete and Rate Supplier<br/>UC4<br/>Owner: Samuel"]:::p1
    CON --> C5["Supplier Ratings<br/>UC3<br/>Owner: Samuel"]:::p1

    SUP --> S1["Assigned Deliveries and Status Update<br/>UC5<br/>Owner: Po-Hao"]:::p1
    SUP --> S2["Upload Quality Documents<br/>UC6<br/>Owner: Po-Hao"]:::p1
    SUP --> S3["My Rating and History<br/>UC7<br/>Owner: Po-Hao"]:::p1

    INS --> I1["Inspection Queue<br/>deliveries to inspect<br/>Owner: Samuel"]:::p1
    INS --> I2["Inspect and Decide<br/>quantity, documents, accept / partial / reject, retention<br/>UC8, UC9, UC10<br/>Owner: Po-Hao"]:::p1

    HOME -.-> F2["Phase 2 pages<br/>RFQ and quotes, LINE notifications, payment requests,<br/>analytics and Pro tier, featured suppliers, mobile<br/>Owner: to be assigned"]:::p2
    HOME -.-> F3["Phase 3 pages<br/>OCR, budget alerts, ERP and GPS integration,<br/>delivery-risk analytics<br/>Owner: to be assigned"]:::p3

    classDef p1 fill:#1f7a4d,stroke:#145a38,color:#ffffff
    classDef p2 fill:#f2c14e,stroke:#b8860b,color:#1a1a1a
    classDef p3 fill:#c9d1d9,stroke:#8b949e,color:#1a1a1a
```

### Priority legend

| Color | Priority | Scope |
|---|---|---|
| 🟩 Green | 1 — build first | Phase 1 MVP (the five must-have functions) |
| 🟨 Yellow | 2 — build next | Phase 2 expansion |
| ⬜ Grey | 3 — build later | Phase 3 intelligence |

### Responsibilities

| Page | Use case | Priority | Owner |
|---|---|---|---|
| Home / Sign in | UC1 | 1 | Po-Hao |
| My Deliveries | UC3 | 1 | Samuel |
| Create Delivery Record | UC2 | 1 | Samuel |
| Delivery Detail | UC3 | 1 | Samuel |
| Complete and Rate Supplier | UC4 | 1 | Samuel |
| Supplier Ratings | UC3 | 1 | Samuel |
| Assigned Deliveries and Status Update | UC5 | 1 | Po-Hao |
| Upload Quality Documents | UC6 | 1 | Po-Hao |
| My Rating and History | UC7 | 1 | Po-Hao |
| Inspection Queue | UC8 | 1 | Samuel |
| Inspect and Decide | UC8, UC9, UC10 | 1 | Po-Hao |
| Phase 2 and Phase 3 pages | — | 2 / 3 | To be assigned |

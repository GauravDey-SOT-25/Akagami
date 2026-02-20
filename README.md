📌 Project Overview

Money muling is a critical component of financial crime where illicit funds are transferred through layered networks of accounts to obscure origin and ownership. Traditional relational database queries fail to detect these sophisticated multi-hop and time-sensitive fraud structures.

The Money Muling Detection Engine is a web-based financial forensics system that:

Parses structured transaction CSV files

Builds a directed transaction graph

Detects fraud rings using graph algorithms

Identifies suspicious accounts using structural and temporal analysis

Provides interactive visualization

Generates strict-format JSON output for evaluation

This solution was developed for the RIFT 2026 Hackathon – Graph Theory Track.

🚀 Tech Stack
Frontend

HTML5

CSS3 (Custom Theming + Dark UI Design System) 

style_06

Vanilla JavaScript (ES6+) 

script_06

Libraries Used

Cytoscape.js – Graph visualization engine 

index_06

PapaParse.js – CSV parsing engine 

index_06

Google Fonts (Space Mono, Bebas Neue, DM Sans)

Deployment

GitHub Pages

Static Frontend Deployment

🏗 System Architecture
CSV Upload
     ↓
CSV Parsing (PapaParse)
     ↓
Transaction Validation
     ↓
Graph Construction
     ↓
Fraud Detection Engine
     ↓
Suspicion Scoring
     ↓
Interactive Graph Rendering (Cytoscape)
     ↓
Results Dashboard + JSON Export
Core Modules

Parser

Parses CSV

Validates structure

Skips invalid rows

GraphBuilder

Constructs adjacency map

Stores:

In-edges

Out-edges

Transaction counts

Total sent/received

Transaction timestamps

DetectionEngine

Cycle detection

Smurfing detection

Layered shell detection

Ring grouping

Suspicion scoring

Visualization Engine

Node classification:

Normal

Suspicious

Ring member

Interactive overlays

Account detail side panel

Filter controls

🧠 Algorithm Approach

The detection engine identifies three primary money muling patterns:

1️⃣ Circular Fund Routing (Cycle Detection)

Detects cycles of length 3–5.

Example:

A → B → C → A
Method:

Depth-limited DFS

Path tracking

Deduplication of cycle sets

Time Complexity:

Worst-case:

O(V * (V + E))

Depth limited to 5 reduces practical complexity significantly.

2️⃣ Smurfing Detection (Fan-in / Fan-out)

Identifies accounts where:

≥10 incoming transactions within 72 hours (Fan-in)

≥10 outgoing transactions within 72 hours (Fan-out)

Method:

Group transactions by account

Sort timestamps

Sliding window (72-hour range)

Count transaction density

Time Complexity:
O(T log T)

(T = number of transactions)

3️⃣ Layered Shell Networks

Detects 3+ hop chains where intermediate accounts have low degree (2–3 transactions).

Example:

A → S1 → S2 → B
Method:

BFS/DFS traversal

Degree-based filtering

Chain validation

Time Complexity:
O(V + E)
🎯 Suspicion Score Methodology

Each suspicious account is assigned a score from 0–100.

Weighted Pattern Model:
Pattern Detected	Weight
Cycle Participation	+40
Smurfing (Fan-in/out)	+30
Shell Chain	+20
High Transaction Velocity	+10
Final Score Formula:
Score = min(100, Σ pattern weights)

Accounts are sorted in descending order of suspicion_score.

Fraud rings are assigned a risk_score based on:

Member count

Pattern severity

Aggregate transaction volume

📊 JSON Output Format

The system generates a downloadable JSON file in the required evaluation format:

{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["cycle_length_3", "high_velocity"],
      "ring_id": "RING_001"
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "member_accounts": ["ACC_00123", "..."],
      "pattern_type": "cycle",
      "risk_score": 95.3
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3
  }
}

All mandatory fields are strictly maintained for line-by-line evaluation.

⚙️ Installation & Setup
Clone Repository
git clone https://github.com/gauravdey-sot-25/Akagami.git
cd Akagami
Run Locally

Since this is a static frontend project:

Option 1:
Open index.html directly in browser.

Option 2 (recommended):

npx serve .

Or use VS Code Live Server extension.

🖥 Usage Instructions

Open the Live Demo URL.

Upload a CSV file with required columns:

transaction_id

sender_id

receiver_id

amount

timestamp

Wait for analysis completion.

Explore:

Interactive transaction graph

Fraud ring summary table

Suspicious accounts list

Account detail side panel

Download JSON report for evaluation.

📱 Performance

Handles up to 10,000 transactions

Average processing time: < 3 seconds (browser-based)

Optimized graph rendering using Cytoscape layout algorithms

Filtering without full graph re-render

⚠ Known Limitations

Browser-based computation limits extremely large datasets (>25k transactions).

Cycle detection may detect overlapping cycles in dense graphs.

Smurfing detection assumes well-formatted timestamps.

No backend persistence (static deployment).

Risk scoring uses heuristic weighting (not ML-based).

Future Improvements:

Backend integration (Node/Python)

Web Worker parallel processing

Real-time streaming detection

ML-enhanced anomaly scoring

👥 Team Members

Arnav Anand — Team Leader

Himesh Upadhyay

Gaurav Dey

Karan Kamal

🏆 Hackathon Compliance Checklist

✅ Live Deployed Application
✅ CSV Upload Functionality
✅ Graph Visualization
✅ Cycle Detection
✅ Smurfing Detection
✅ Shell Network Detection
✅ Suspicion Score Calculation
✅ JSON Export (Exact Format)
✅ Fraud Ring Summary Table
✅ README Documentation

💡 Final Note

This project demonstrates practical application of:

Graph Theory

Network Analysis

Fraud Detection Modeling

Client-Side Data Processing

Interactive Data Visualization

Built with precision for the RIFT 2026 Hackathon — Follow the Money.

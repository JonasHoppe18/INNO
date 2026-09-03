┌─────────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER / SUPPORT CASE                             │
│                                                                             │
│  • Email / Chat / Form                                                      │
│  • Conversation History                                                     │
│  • Customer Context                                                         │
│  • Tenant / Store Context                                                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    🛡️ DETERMINISTIC SAFETY BOUNDARY                        │
│                                                                             │
│  • Tenant Isolation                 • Authorization                         │
│  • Prompt Injection Protection      • Tool Input Validation                 │
│  • PII / Sensitive Data Handling    • Read vs Write Enforcement             │
│  • Trusted Context Injection        • Explicit Tool Failure States           │
│                                                                             │
│            Security is enforced in code — not by the LLM prompt             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
                   ┌────────────────────────────────────────┐
                   │         🤖 SONA SUPPORT AGENT          │
                   │        OpenAI Agents SDK               │
                   │                                        │
                   │      ONE PRIMARY SUPPORT AGENT         │
                   │                                        │
                   │  • Understand customer problem         │
                   │  • Determine what information is needed│
                   │  • Select knowledge/tool               │
                   │  • Observe tool results                │
                   │  • Decide next step                    │
                   │  • Draft human-quality response        │
                   │  • Propose action or escalate          │
                   └───────────────────┬────────────────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │                           │
                         ▼                           ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────┐
│      📚 NEW KNOWLEDGE SYSTEM         │   │       🔧 OPERATIONAL TOOLS        │
│                                       │   │          Tenant-Safe              │
│  AUTHORITATIVE KNOWLEDGE              │   │                                   │
│                                       │   │  READ-ONLY TOOLS                  │
│  • Policies                           │   │                                   │
│  • Return / Refund Rules              │   │  • get_order                      │
│  • Shipping / Warranty Rules          │   │  • get_order_history              │
│  • Procedures / SOPs                  │   │  • get_customer                   │
│  • Product Knowledge                  │   │  • get_product                    │
│  • Brand / Tone Guidance              │   │  • get_fulfillment                │
│                                       │   │  • get_tracking                   │
│  HISTORICAL KNOWLEDGE                 │   │  • get_shipment                   │
│                                       │   │                                   │
│  • Previous Tickets                   │   │  Data comes from:                 │
│  • Human Replies                      │   │                                   │
│  • Solved Examples                    │   │  • Shopify                        │
│                                       │   │  • Webshipper                     │
│  Historical cases = examples          │   │  • Future integrations            │
│  NOT authoritative policy             │   │                                   │
│                                       │   │                                   │
│  Each result includes:                │   └─────────────────┬─────────────────┘
│                                       │                     │
│  • Tenant                             │                     │
│  • Source                             │                     │
│  • Authority                          │                     │
│  • Freshness                          │                     │
│  • Provenance                         │                     │
└───────────────────┬───────────────────┘                     │
                    │                                         │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                   ┌────────────────────────────────────────┐
                   │              TOOL LOOP                 │
                   │                                        │
                   │  Agent needs information               │
                   │              │                         │
                   │              ▼                         │
                   │        Call knowledge/tool             │
                   │              │                         │
                   │              ▼                         │
                   │        Validate request                │
                   │              │                         │
                   │              ▼                         │
                   │        Execute safe lookup             │
                   │              │                         │
                   │              ▼                         │
                   │       Return verified result           │
                   │              │                         │
                   │              ▼                         │
                   │        Agent continues                 │
                   │              │                         │
                   │        ┌─────┴─────┐                   │
                   │        │           │                   │
                   │        ▼           ▼                   │
                   │   Need more?     Ready                 │
                   │        │           │                   │
                   │        └── loop ───┘                   │
                   └───────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │             ACTION DECISION             │
                  │                                         │
                  │  Does resolving the case require        │
                  │  changing something?                    │
                  └───────────────────┬─────────────────────┘
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                         ▼                         ▼
               ┌──────────────────┐     ┌─────────────────────────┐
               │    NO ACTION     │     │   MUTATING ACTION       │
               │                  │     │      PROPOSAL ONLY       │
               │ Generate reply   │     │                         │
               └────────┬─────────┘     │ • cancel_order          │
                        │               │ • update_address        │
                        │               │ • create_return         │
                        │               │ • refund_order          │
                        │               │ • send_replacement      │
                        │               │                         │
                        │               │ Never execute directly  │
                        │               │ in greenfield experiment│
                        │               └───────────┬─────────────┘
                        │                           │
                        │                           ▼
                        │               ┌─────────────────────────┐
                        │               │  👤 HUMAN APPROVAL      │
                        │               │                         │
                        │               │ • approve               │
                        │               │ • edit                  │
                        │               │ • reject                │
                        │               │ • escalate              │
                        │               └───────────┬─────────────┘
                        │                           │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ✉️ FINAL SONA OUTCOME                               │
│                                                                             │
│  • Customer-facing reply                                                    │
│  • Proposed action(s)                                                       │
│  • Resolution status                                                        │
│                                                                             │
│       RESOLVED  /  NEEDS INFORMATION  /  NEEDS HUMAN                       │
│                                                                             │
│  • Evidence / source references where useful                               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    📊 TRACING & OFFLINE EVALUATION                          │
│                                                                             │
│  • Tool Calls                       • Retrieved Knowledge                    │
│  • Tool Results                     • Source / Provenance                    │
│  • Token Usage                      • Latency                                │
│  • Errors / Failures                • Proposed Actions                       │
│                                                                             │
│  Evaluation:                                                               │
│                                                                             │
│  • Golden / Historical Cases        • LLM-as-a-Judge                        │
│  • Deterministic Safety Checks      • Regression Tests                      │
│  • Human-quality Support Scoring                                            │
│                                                                             │
│           Evaluation stays OUTSIDE the main response path initially         │
└─────────────────────────────────────────────────────────────────────────────┘
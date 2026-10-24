# CodeitLab — το ενιαίο προϊόν

_Όραμα, αρχιτεκτονική, ασφάλεια, οικονομικά και πλάνο. Γραμμένο μετά την
ανάγνωση και των 40 sessions (βλ. [SESSION-HISTORY.md](SESSION-HISTORY.md)) και
τον έλεγχο του κώδικα του marketplace (Οκτ 2026)._

## 1. Αποστολή

Το CodeitLab υπάρχει για να δουλεύει η AI **για ανθρώπους με άποψη** — αυτούς
που ξέρουν τι θέλουν αλλά δεν έχουν τον χρόνο/την ομάδα — και για **εταιρείες
που δεν προλαβαίνουν να ακολουθήσουν**, ώστε να αγοράζουν _αποτέλεσμα_ από
έμπειρους ανθρώπους που δουλεύουν μόνοι, με την AI ως συνεργάτη και όχι ως
αντικαταστάτη.

Δεύτερος, εξίσου σοβαρός στόχος: **να μειώσουμε τον φόβο ανάμεσα στον άνθρωπο
και την AI**. Ο φόβος τρέφεται από το αδιαφανές. Γι' αυτό κάθε απάντηση λέει
ποιο μοντέλο την έδωσε, κάθε ισχυρισμός μπορεί να ζητήσει evidence, κάθε
αυτόματη απόφαση έχει ανθρώπινη έγκριση και κάθε χρήση δεδομένων είναι ορατή.

Τρεις δεσμεύσεις:

1. **Η εφαρμογή μένει δωρεάν.** Πληρώνεται μόνο η αγορά εργασίας (15–20%).
2. **Τα δεδομένα είναι του χρήστη.** Τοπική μνήμη, export, διαγραφή, χωρίς
   lock-in· το credentials proxy κρατάει κλειδιά και PII μακριά από τα μοντέλα.
3. **Ο άνθρωπος αποφασίζει.** Η AI προτείνει, ο άνθρωπος εγκρίνει — πάντα.

## 2. Θέση στην αγορά

| Σήμερα                                                          | Με CodeitLab                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ο freelancer πληρώνει 5 συνδρομές AI και δουλεύει χωρίς σύστημα | Ένα app, όλα τα harnesses, ένα memory, μία απόδειξη ποιότητας         |
| Η εταιρεία αγοράζει seats και ελπίζει                           | Αγοράζει παραδοτέο με escrow, evidence και εγγύηση                    |
| «Ποιος το έφτιαξε;» χάνεται στο chat                            | Κάθε παραδοτέο έχει ιστορικό, evidence και υπεύθυνο άνθρωπο           |
| Η AI είναι απειλή                                               | Η AI είναι ο λόγος που ο solo expert μπορεί να αναλάβει εταιρικό έργο |

**Ο antidisintermediation κανόνας:** η αξία δεν είναι η προμήθεια, είναι ότι
χωρίς την πλατφόρμα η συναλλαγή δεν γίνεται με ασφάλεια (escrow, διαφωνίες,
reputation, evidence). Γι' αυτό το 15–20% δεν είναι «φόρος» — είναι το κόστος
του να μπορεί ένας άνθρωπος να υπογράψει εταιρικό συμβόλαιο.

## 3. Ένα app, όχι εννέα — ο χάρτης ενοποίησης

Η ιδέα «πάρτε το καλύτερο από όλα» γίνεται προϊόν μόνο αν μοιράζονται **έναν
πυρήνα**: ένα λογαριασμό, ένα project, ένα memory, ένα ledger, ένα UI.

```
                    ┌──────────────────────────────┐
                    │  CodeitLab core              │
                    │  identity · projects · threads│
                    │  memory · evidence · ledger   │
                    └──────────────┬───────────────┘
     ┌───────────────┬─────────────┼──────────────┬────────────────┐
     │               │             │              │                │
  Router          Evidence      Studio/Video    Marketplace      Remote/PWA
 (OmniRoute)       (REA)        (OpenShorts,     (jobs, escrow,   (tunnel,
 quota·speed·     claims→       Latent,          profiles,        pairing,
 cost·fallback    proof         video-from-code) disputes)        install)
```

| Πηγή                  | Τι κρατάμε                                                             | Πού ζει στο CodeitLab                                           |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| **OmniRoute**         | quota-aware επιλογή μοντέλου ανά task, health probes, fallback, κόστος | `RoutingService`, `enforcedRoute`, routing page, per-reply chip |
| **REA**               | κάθε ισχυρισμός με evidence, MCP + skill, always-on policy             | `codeitlab-rea` MCP, evidence panel, `REA-EVIDENCE.md`          |
| **OpenShorts**        | clip jobs από κώδικα/σενάριο, render pipeline, dashboard               | Studio tab, clip jobs, render queue                             |
| **Latent**            | latent-space παραγωγή εικόνας/βίντεο (text/image → video)              | Studio → Visual, ίδιο job queue με τα clips                     |
| **video-from-code**   | ντετερμινιστικό render από HTML/code (HyperFrames-style), versioned    | Studio → Code render, κάθε παραδοτέο αναπαράγεται από το repo   |
| **Nexus/ACP**         | skills, sessions, MCP από κάθε harness                                 | ήδη υπάρχει: 43 agents, unified ACP                             |
| **credentials proxy** | masking κλειδιών/PII πριν φύγουν σε μοντέλο                            | ήδη υπάρχει: `/settings/codeitlab/credentials`                  |
| **marketplace**       | freelancer ↔ εταιρεία, escrow, fee                                     | `apps/marketplace` (νέο, σκληρυμένο αυτόν τον κύκλο)            |

**Ο κανόνας ενοποίησης:** κάθε module είναι _service_ με contracts, όχι
χωριστό app. Ένα παραδοτέο βίντεο, ένα code review ή ένα job στο marketplace
περνούν από τα ίδια τρία πράγματα: **routing** (ποιο μοντέλο), **evidence**
(γιατί είναι σωστό) και **ledger** (τι κόστισε/πληρώθηκε).

### 3.1 Video από κώδικα — γιατί είναι στρατηγικό

Το βίντεο σήμερα παράγεται είτε από generative μοντέλα (μη ντετερμινιστικό,
δύσκολο να διορθωθεί) είτε από editors (αργό, ανθρώπινο). Το CodeitLab μπορεί
να κάνει το τρίτο: **ο agent γράφει κώδικα που παράγει βίντεο**, το render είναι
ντετερμινιστικό, κάθε αλλαγή είναι diff, και το αποτέλεσμα μπορεί να ξαναβγεί
αύριο με το ίδιο input. Αυτό δίνει σε έναν solo expert παραγωγή κλίμακας
εταιρείας — και είναι ο λόγος που το Studio δεν είναι «άλλο ένα video tool».

## 4. Ασφάλεια — το marketplace πρώτα

Το χρήμα αλλάζει το threat model: ένα XSS είναι κλοπή λογαριασμού, ένα race
είναι διπλή πληρωμή, ένα λάθος refund είναι πραγματική ζημιά.

### 4.1 Τι ισχύει τώρα (υλοποιήθηκε και δοκιμάστηκε αυτόν τον κύκλο)

| Έλεγχος                      | Πριν                                    | Τώρα                                                                                                               |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CSP / clickjacking           | κανένα header                           | `default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`, `X-Frame-Options: DENY` |
| HSTS                         | —                                       | μόνο όταν σερβίρεται HTTPS (`MARKETPLACE_COOKIE_SECURE=1`)                                                         |
| CSRF                         | μόνο SameSite=Lax                       | + έλεγχος `Origin`/`Referer` σε κάθε state-changing request (403 `cross_origin`)                                   |
| Διπλή πληρωμή (approve race) | δύο ταυτόχρονα approve → δύο payouts    | compare-and-set `delivered → approved` πριν το payout· ο δεύτερος χάνει με 409                                     |
| Διπλή χρέωση (create race)   | read-then-write race                    | unique partial index `engagements(job_id) WHERE status <> 'cancelled'` + δέσμευση πριν τη χρέωση                   |
| Αποτυχία provider            | χρέωση εκτός transaction, orphan charge | δέσμευση → χρέωση → finalize· σε αποτυχία ελευθερώνεται η δέσμευση, κανένα ledger entry                            |
| Refund χωρίς χρέωση          | refund ledger πάντα                     | refund μόνο όταν υπάρχει `payment_ref`                                                                             |

Tests: **40/40** στο `apps/marketplace` (11 νέα: 8 security + 3 escrow races),
`tsc-rs --noEmit` καθαρό. Τα headers εφαρμόζονται σε _κάθε_ response (και στα
errors) από ένα σημείο, ώστε κανένας handler να μην μπορεί να τα ξεχάσει.

### 4.2 Επόμενα (με σειρά)

1. **Stripe Connect** με idempotency keys + webhook signature verification· το
   `PaymentProvider` interface είναι έτοιμο, το state machine δεν αλλάζει.
2. **Append-only ledger με invariants**: `sum(charge) = sum(fee+payout+refund)`
   ανά engagement, nightly reconciliation job, alert σε απόκλιση.
3. **Dispute workflow**: στοιχεία, προθεσμίες, απόφαση, μερικό refund — σήμερα το
   `disputed` είναι αδιέξοδο.
4. **Admin audit log**: ποιος ενέκρινε ποιον coder, πότε, από ποια IP.
5. **Rate-limit πίσω από proxy**: σήμερα το `X-Forwarded-For` γίνεται πιστευτό·
   να διαβάζεται μόνο όταν `MARKETPLACE_TRUST_PROXY=1` και να γίνεται validate.
6. **PII minimization + GDPR**: διαγραφή λογαριασμού, export, retention στο
   ledger (νομική υποχρέωση vs διαγραφή).
7. **Pentest + bug bounty** πριν ανοίξει σε πραγματικά χρήματα.

### 4.3 Rust στο web — ασφαλέστερο;

Ειλικρινής απάντηση: **το Rust δεν κάνει το web app ασφαλέστερο από μόνο του.**
Η ασφάλεια ενός marketplace δεν κρίνεται από τη γλώσσα αλλά από: σωστό auth,
CSRF/XSS, race conditions στα χρήματα, idempotency, έλεγχο εισόδου και
διαχωρισμό προνομίων. Το 90% των πραγματικών περιστατικών εκεί έξω είναι
λογικά λάθη, όχι memory-safety bugs.

Πού _ναι_ χρήσιμο το Rust:

- **WASM sandbox** για untrusted κώδικα (plugins, agents, user-supplied render
  scripts): memory safety + deterministic execution + fuel metering.
- **Media/crypto pipeline** όπου το throughput μετράει (video encode, hashing).
- **Ένα static binary** για self-hosted deployments χωρίς Node runtime.

Πού _δεν_ αξίζει τώρα: rewrite του marketplace. Το Node + SQLite + τα headers
και τα CAS που μόλις μπήκαν καλύπτουν το threat model ενός early-stage
marketplace· ένα rewrite θα κόστιζε μήνες και θα πρόσθετε νέα bugs. Αν χρειαστεί
Rust, θα μπει **δίπλα** (sandbox service), όχι στη θέση του money path.

**Απόφαση:** TypeScript για το marketplace, Rust μόνο ως sandbox/accelerator
αργότερα. Η επένδυση ασφάλειας πάει σε process isolation (containers, seccomp,
egress control) και σε tests στα χρήματα — όχι σε αλλαγή γλώσσας.

**Υλοποιημένο (round 16):** το Studio render τρέχει ήδη σε απομονωμένο browser —
JavaScript off, κάθε network request σε κλειστή local port (και loopback, γιατί
αλλιώς το Chromium bypass-άρει τον proxy), OS-level Chromium sandbox. Το test
αποδεικνύει μηδέν requests προς τοπικό server και μη εκτέλεση inline script. Αυτό
είναι το pattern που θα επεκταθεί σε Rust/WASM sandbox για plugins, όχι rewrite.

## 5. Gamification & εκπαίδευση που δεν είναι βαρετή

Ο κανόνας: **κάθε βήμα παράγει πραγματικό artifact, όχι tutorial.** Καμία
πρόοδος δεν μετριέται με κλικ.

### 5.1 Quests (ανά module, 1–3 λεπτά το καθένα)

| Quest          | Τι κάνει ο χρήστης                    | Τι κερδίζει                            |
| -------------- | ------------------------------------- | -------------------------------------- |
| First Light    | στέλνει το πρώτο μήνυμα σε ένα thread | ξεκλειδώνει το μοντέλο chip + memory   |
| Connect        | συνδέει ένα ACP (Hermes, Qoder, …)    | βλέπει τα skills/MCP του agent         |
| Prove It       | ζητά evidence σε μια απάντηση         | ξεκλειδώνει το REA panel               |
| Make It Move   | φτιάχνει ένα 5s clip από κώδικα       | ξεκλειδώνει το Studio render queue     |
| Get Paid       | δημοσιεύει προφίλ + αίτηση σε job     | εμφανίζεται στο matching               |
| First Delivery | παραδίδει ένα paid job                | badge «verified» + χαμηλότερο fee tier |

**Υλοποιημένο (app-level, round 7):** `@codeitlab/core/quests` +
`codeitlab.quests.list`. Το board **παράγεται** από πραγματικά facts που ήδη
ξέρει ο server (agents, models, memory, REA, Studio, integrations, remote,
credentials) — δεν αποθηκεύεται τίποτα, άρα δεν υπάρχει δεύτερη αλήθεια ούτε
migration. 9 quests, levels Explorer → Builder → Operator → Architect, και κάθε
quest κουβαλά ένα **lesson 1–2 προτάσεων** («γιατί αξίζει»), όχι οδηγίες
κλικ. Εμφανίζεται πρώτο στο Overview, με progress bar και `<details>` για όλα.

### 5.2 Anti-boring rules

- Μέγιστο **1 nudge/ημέρα**, πάντα dismissible.
- Καθόλου streak-guilt, καθόλου confetti spam, καθόλου points χωρίς νόημα.
- Τα rewards είναι **capabilities** (μοντέλα, templates, priority routing,
  χαμηλότερη προμήθεια), όχι εικονίδια.
- Contextual micro-lessons 60–90 δευτερολέπτων, τη στιγμή που χρειάζονται
  (π.χ. πριν το πρώτο escrow: «τι κάνει το escrow σε 4 γραμμές»).
- Πλήρες skip: ο έμπειρος χρήστης δεν βλέπει ποτέ onboarding δεύτερη φορά.

### 5.3 Skill map

Ο χρήστης δηλώνει **interests** (τομείς που τον ενδιαφέρουν) και **skillset**
(δεξιότητες + επίπεδο + απόδειξη). Η εφαρμογή δείχνει «το πλεονέκτημά σου» και
«το επόμενο skill που ξεκλειδώνει δουλειά», με βάση πραγματικά jobs και
πραγματικά deliveries — όχι αυτοαξιολόγηση μόνο.

## 6. Προφίλ: interests + skillset

Σήμερα το `coder_profiles` έχει skills/availability/rate/links. Προστίθενται:

```ts
interests: string[];                    // τομείς: web, video, data, ops, design, ai
skillLevels: Record<string, 1|2|3|4|5>; // επίπεδο ανά skill
evidence: string[];                     // links σε παραδοτέα/repos (proof)
languages: string[];                    // γλώσσες επικοινωνίας
```

Matching (πρόταση, αντικαθιστά το σημερινό 55/15/15/15):

```
score = 0.40 * skill_overlap      // τα skills που ζητά η δουλειά
      + 0.15 * interest_alignment // το job category ∈ interests
      + 0.15 * evidence_strength  // evidence links στο προφίλ
      + 0.10 * availability
      + 0.10 * rate_fit
      + 0.05 * completeness
      + 0.05 * reputation         // derived από paid deliveries (New 0, Proven .4, Trusted .8, Expert 1)
```

Κάθε πρόταση κρατά **λόγους** (explainable), όπως σήμερα — ο άνθρωπος μπορεί να
διαφωνήσει. Τα interests δεν είναι διαφημιστικός στόχος· είναι φίλτρο που
μειώνει τον θόρυβο και στις δύο πλευρές.

## 7. Οικονομικά

- **15%** βασική προμήθεια σε κάθε paid engagement (υπάρχει ήδη:
  `PLATFORM_FEE_BPS = 1500`).
- **20%** για το «Assisted» tier: AI matching + project management + εγγύηση
  παράδοσης + dispute handling. Ο χρήστης επιλέγει, δεν του επιβάλλεται.
- **0%** για την εφαρμογή. Το hosted container είναι ξεχωριστό add-on.
- Escrow: η εταιρεία πληρώνει όταν επιλέγει coder· τα χρήματα μένουν στην
  πλατφόρμα μέχρι την έγκριση· πληρωμή μείον προμήθεια· refund σε cancel πριν
  την παράδοση· dispute κρατά τα χρήματα σε escrow.

Παράδειγμα: έργο €2.000 → fee €300 (15%), payout €1.700. Στο Assisted:
fee €400, payout €1.600. Καμία κρυφή χρέωση, κανένα subscription για τον coder.

## 8. Trust: μειώνοντας τον φόβο

- **Διαφάνεια μοντέλου**: κάθε απάντηση δείχνει ποιο μοντέλο την έδωσε.
- **Evidence on demand**: κάθε ισχυρισμός μπορεί να ζητήσει απόδειξη (REA).
- **Human-in-the-loop**: οι αυτόματες ενέργειες (routing, matching, payouts)
  έχουν ορατό λόγο και ανθρώπινη έγκριση όπου υπάρχει χρήμα.
- **Τοπική μνήμη**: τα δεδομένα μένουν στον υπολογιστή του χρήστη· export
  οποτεδήποτε.
- **Credentials proxy**: κλειδιά και PII δεν φεύγουν σε μοντέλα.
- **Καμία σκοτεινή πρακτική**: όχι fake urgency, όχι κρυφά fees, όχι
  engagement traps.

## 9. Roadmap

| Φάση            | Τι                                                                                                                    | Κριτήριο επιτυχίας                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **P0 (τρέχει)** | marketplace hardening (έγινε), app-level quest board (έγινε), CI publish 0.1.1 με trusted publisher, ACP sign-in pass | 40/40 tests, 0 critical findings, 17→<5 agents χωρίς sign-in |
| **P1**          | profiles interests/skillset + gamified onboarding, Stripe Connect sandbox, PWA+tunnel e2e                             | πρώτο πραγματικό paid job σε staging, Lighthouse PWA ≥ 90    |
| **P2**          | Studio video-from-code GA, OmniRoute cost ledger, REA evidence σε κάθε deliverable                                    | ένα βίντεο παράγεται 2 φορές identically από το ίδιο repo    |
| **P3**          | Rust/WASM sandbox για untrusted render/agent code, dispute workflow, reputation                                       | sandbox escape test suite, dispute SLA < 72h                 |

## 10. Metrics (north star)

- **Paid outcomes delivered / μήνα** (όχι installs, όχι DAU).
- Time-to-first-paid-job (στόχος < 14 ημέρες).
- % παραδοτέων με evidence (στόχος > 80%).
- Dispute rate (στόχος < 3%), refund rate, take rate.
- Human override rate στο routing/matching (αν είναι 0%, δεν ρωτάμε σωστά).

## 11. Ανοιχτές αποφάσεις

1. **«Latent»**: κρατάω slot για latent-space visual generation (text/image →
   video) δίπλα στο video-from-code. Χρειάζεται επιβεβαίωση τι εννοείται.
2. Νομική μορφή για escrow (platform ως agent vs PSP) και φορολογία ανά χώρα.
3. Πότε ανοίγει το marketplace εκτός ΕΕ (Stripe Connect διαθεσιμότητα).
4. Πόσο «uncensored» επιτρέπεται στο marketplace (policy ανά τομέα).
5. Αν το Studio πουλάει renders ως υπηρεσία ή μόνο ως capability του coder.

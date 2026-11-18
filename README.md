# Voice Agent Analytics (MVP)

Define what you want to learn from AI voice agent calls ("topics"), let the AI extract it after each call, and explore the results in charts you design yourself. No charts are created by default.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

There is no backend. Calls and AI extraction are simulated in the browser and saved to `localStorage`. Use **Simulate calls** (top right) to generate finished calls, and **Settings → Demo data** to reload the sample data or start from an empty workspace.

## Structure

| Path | What it holds |
| --- | --- |
| `src/types.ts` | Data model: topics, topic versions, sessions, extraction results, charts (kept as separate collections) |
| `src/lib/extraction.ts` | Eligibility rule + simulated extractor. **Swap `runExtraction` for a real API call here.** |
| `src/lib/store.tsx` | App state, actions, extraction queue (dedupe, retries), persistence |
| `src/lib/analytics.ts` | Filters, per-topic statistics, chart rules and aggregation |
| `src/lib/mock.ts`, `src/lib/seed.ts` | Mock call/transcript generator and sample data |
| `src/components/` | Shared UI, Highcharts wrapper, topics section, charts section + chart designer, session and drill-down drawers |
| `src/lib/alerts.ts` | Alert catalogue (per-type metrics, filters, windows, minimum occurrences, defaults), validation, mock signals and the minute-by-minute evaluator. **Swap `rawSeries` for real metrics here.** |
| `src/lib/customAlerts.ts` | Custom alerts: output fields, condition groups, JSON schema, validation, matching and the mock evaluator output |
| `src/lib/alertSamples.ts` | Sample alerts and ongoing faults used as mock data |
| `src/lib/alertsStore.tsx` | Alerts, versioned settings, triggered activity (ongoing / resolved automatically), simulated faults |
| `src/pages/` | Analytics (overview + charts + topics on one page), Alerts (analytics + your alerts), Create/Edit alert. Sessions and Settings pages still exist but are no longer in the sidebar. |
| `Assets/` | Design reference screenshots |

## Extraction rules

- Runs once per call, only after the call has ended.
- A topic applies only to calls that end while it is switched on. It is never applied to earlier calls.
- Editing a topic appends a new immutable version; each result stores the version it was extracted with.
- Pausing or deleting a topic keeps every result it already produced.
- One result per call and topic (`sessionId|topicId`); duplicate jobs are skipped.
- `null` with status `success` means "unknown", stored separately from `false` and `0`.

## Alert rules

- The demo starts with 13 **sample alerts** (marked “Sample”) and a week of simulated activity, including a few faults that are still happening, so the analytics is populated. **Remove sample alerts** (banner on the Alerts page) deletes them for good. With no alerts, the Alerts page *is* the Create alert form. After that it shows alert analytics (overview, daily trends by severity, distribution by category / severity / top alerts, and a searchable event history) plus a **Your alerts** tab. New alerts are replayed over the last 7 days of simulated calls so the analytics has history.
- Create one under **Alerts → Create alert**: pick a condition, start with one Warning threshold and add Critical or Info if you want them, a time window, minimum occurrences and notifications. Alerts are grouped by the type’s default (agent, provider or none), use a 15-minute cooldown, resolve automatically and send a recovery notice.
- **Test this alert** shows how often it would have triggered on the last 24 h or 7 days of (simulated) calls.
- An alert checks every minute from the moment it is created or enabled. Editing it applies from then on; past activity keeps the settings it ran with.
- Each group (agent, provider, campaign or error type) triggers and resolves on its own. After an alert resolves, the same group can't trigger again until the cooldown passes.
- **Custom** alerts: click Custom and list the structured output fields (name, type, values or range, description; the JSON schema is generated), then set trigger conditions per severity. Conditions in a group are ANDed, groups are ORed, and a call counts toward the highest severity it matches. The severity triggers when at least the minimum number of matching calls happen in the time window.
- **Simulate issue** injects a fault (provider outage, slow replies, broken webhook…) into the mock data so you can watch an alert fire.

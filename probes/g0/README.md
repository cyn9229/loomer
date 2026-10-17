# Loomer G0 probe

Throwaway, read-only feasibility probe. It answers one question before the main build: can a Manifest V3 service worker read Canvas and an owned Google Doc using the signed-in browser session, without school API keys?

It sends GET requests only. It never submits, edits, or posts. The copied report contains status codes, counts, hashes, and timings. It never contains assignment text, names, or grades. The Docs probe shows a short local preview in the panel so you can compare accuracy; that preview is excluded from the report.

Canvas may record API reads as page views in its access reports. Google may record the export as a download.

## Run

1. `chrome://extensions` → Developer mode → Load unpacked → this folder.
2. Pin the probe. Click its icon to open the side panel.
3. Canvas: enter the school origin, Grant this origin, Run Canvas probe.
4. Docs: paste the demo doc URL, Grant Docs access, Run Docs probe. Compare the local preview and word count with the doc. Start edit watch, type a sentence in the doc, click "I edited now" at the same moment, and wait for `docs.edit.detected`. Repeat 3 times. Also try one tiny edit (one character).
5. Panel closed: Schedule run in 1 min, close the panel, wait 90 s, reopen, Load background result.
6. Capture: on a normal article tab, open the panel from the toolbar icon, then run the three capture buttons in order.
7. Copy report JSON and paste it back.

Kept as validation evidence for the support matrix in the root README. It is not product code and is never shipped.

# Clean-install check: macOS and Windows

Use this checklist on a machine that has not run Agent Almanac. Keep your real usage output private; report pass/fail and error messages with personal paths removed.

## Get a clean copy

Once the repository is published, clone it. Before then, use a source archive from the maintainer containing the README, LICENSE, package files, `bun.lock`, source, scripts, docs, and tests. Do not copy `node_modules`, `.data`, `.git`, `dist`, or the private planning repository from another machine.

Record the source version/archive date, operating system, CPU architecture, browser, and `bun --version`. Install [Bun](https://bun.sh/docs/installation) if necessary; the reference version is 1.4.2. Do not preinstall ccusage globally.

## Install and run

Use macOS Terminal or Windows PowerShell. Run from the folder containing `package.json`:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run ccusage --version
bun test
bun start
```

Expected: ccusage reports **20.0.29**, tests pass, and the server prints http://127.0.0.1:4318/.

- [ ] Installation succeeds without a pre-existing ccusage cache or global install.
- [ ] On a machine without agent logs, the dashboard shows an empty state, with no crash.
- [ ] On a machine with logs, the dashboard shows the report and Refresh reads it again.
- [ ] Overview, Tokens & cache, and Cost lab work; filters and day/week grouping update the chart.
- [ ] Keyboard arrows inspect the focused chart; dropdowns and navigation work at a narrow browser width.
- [ ] An SVG downloads and opens with the expected chart, labels, and source note.
- [ ] Stop the server with Ctrl+C, start it again, and confirm the previous snapshot is available.

A machine with agent logs does not need to have those logs deleted to test the empty state. Use the sandbox's empty example; report that the local no-history case remains untested on that machine.

## Sandbox and privacy

Stop the local dashboard, then run:

```sh
bun run preview:sandbox
```

Open http://127.0.0.1:4319/agent-almanac/.

- [ ] All five synthetic examples work, including empty data and unknown pricing.
- [ ] Open “Paste your ccusage output,” fill it with example JSON, and build the preview.
- [ ] Paste invalid JSON; an error appears and the previous chart remains visible.
- [ ] If available, paste a complete wide daily table; models, agent totals, and dates remain correct.
- [ ] Open browser developer tools → Network, clear the log after the page loads, then paste and preview. No report or API request should occur.
- [ ] Clear my data resets to an example and empties the text field. Reload also removes the pasted preview.
- [ ] Pasted content is absent from the address bar and browser local/session storage.

## Result to send back

```text
Source version/archive date:
OS and version:
CPU:
Bun version:
Browser:
Install: pass/fail
Tests: pass/fail
Local dashboard: pass/fail (with logs / without logs)
Sandbox and privacy: pass/fail
Anything still untested:
Sanitized error or short reproduction:
```

A local pass verifies that machine only. Hosted CI and public Pages deployment are separate checks; do not mark them complete from this checklist.

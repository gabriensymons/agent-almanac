# Agent Almanac

Turn [ccusage](https://ccusage.com/) reports into a local dashboard: see usage over time, compare coding agents, explore token and cache patterns, and inspect experimental cost estimates.

**Early alpha.** No account, database, or frontend dependencies. The dashboard stays on your machine; the sandbox processes pasted reports in your browser.

![Agent Almanac sandbox with synthetic usage](docs/sandbox.jpg)

## Try the sandbox

[Open the Agent Almanac sandbox →](https://gabriensymons.github.io/agent-almanac/)

**Deployment status:** the hosted URL is planned for the first GitHub Pages deployment; it is not live yet. You can run the complete sandbox locally now:

```sh
bun run preview:sandbox
```

Open http://127.0.0.1:4319/agent-almanac/. Choose **Explore an example** or **Use your own data**. The paste form selects a command for your terminal: macOS uses `bunx ccusage daily --json --by-agent | pbcopy`, and Windows PowerShell uses `bunx ccusage daily --json --by-agent | Set-Clipboard`. Both copy successful JSON output directly to your clipboard; return to the sandbox and paste it. You can also select plain JSON output for other terminals. No local agent installation is needed for the sandbox; only Bun is needed for this local preview.

Supported paste formats:

- Daily JSON from `ccusage daily --json --by-agent` (recommended).
- Standard daily JSON without agent breakdowns, shown as combined usage.
- A complete wide unified daily terminal table, including the header, per-agent rows, and Total row. Terminal costs are rounded; pricing-availability metadata is absent.

Compact, monthly, and session tables are not supported. Invalid or truncated reports show an error and leave the previous chart visible. The paste limit is 2 MB.

**Pasted data is not uploaded or stored by Almanac.** Parsing and charting happen in the tab, with no analytics or API calls. Clear or reload discards the preview. An SVG is saved only when you select Export. The hosting provider still receives normal requests for the public page and its static assets; pasted report contents are not part of those requests.

## Run your local dashboard

Requires [Bun](https://bun.sh/docs/installation) **1.4.2 or newer**, plus usage logs from a supported coding agent. The repo pins **ccusage 20.0.29**, including its platform binary, in `package.json` and `bun.lock`. A global or previously cached ccusage install is not required.

From your checkout, in macOS Terminal or Windows PowerShell:

```sh
cd agent-almanac
bun install --frozen-lockfile --ignore-scripts
bun start
```

Open http://127.0.0.1:4318/. The first visit reads local usage. **Refresh data** reads new usage; ordinary page reloads reuse the last successful snapshot. An empty report is valid when the machine has no agent history.

Bun 1.4.2 on macOS Apple Silicon is verified locally. Clean-machine macOS and Windows checks are pending. CI is configured for macOS, Windows, and Linux; configured does not mean those hosted runs have passed yet. Follow [the clean-install checklist](docs/clean-install.md) to help verify another machine.

### Configuration and troubleshooting

Use `PORT` to change the local port and `TZ` to select the report timezone. Defaults are port 4318 and the machine's timezone.

```sh
# macOS / Linux
PORT=4320 TZ=America/New_York bun start
```

```powershell
# Windows PowerShell (current terminal session)
$env:PORT = '4320'
$env:TZ = 'America/New_York'
bun start
```

The dashboard invokes its installed ccusage executable directly with `daily --json --by-agent --offline`. Refresh times out after 90 seconds. Offline pricing may differ from online estimates. To diagnose missing data or an incompatible report, run:

```sh
bun run ccusage --version
bun run ccusage daily --json --by-agent --offline
```

An installation needs network access to download locked packages. Starting the dashboard never installs or updates packages. Do not omit optional dependencies: ccusage uses an optional package for the platform binary. If port 4318 is busy, stop the other instance or choose another port.

## Reading the charts

- Overview uses ccusage's reported total tokens. Windows end on the latest recorded date, not today's date.
- Weekly groups start on Monday; buckets at the window edges can be partial. Histories over two years use weekly marks.
- Blank dates mean no available records, not proven inactivity. The latest day may be incomplete.
- Tokens & cache sums four reported categories, which can differ from the headline total. Cache share is `cache read / (input + cache write + cache read)`; output is excluded.
- Cost lab is experimental. Cached prices, unpriced models, subscriptions, and provider accounting can make estimates differ from bills. Token volume does not measure productivity or quality.

The dashboard supports date/agent filters, keyboard and touch inspection, a daily data table, and SVG exports. Local dashboard filters are saved in the URL. Sandbox state and pasted data stay out of the URL.

## Local data and privacy

The dashboard binds to **127.0.0.1 only**, checks request hosts/origins, and has no accounts. Do not expose it through a public tunnel.

ccusage reads the sources it detects. Almanac keeps daily aggregate metrics, agent/model names, pricing availability, and snapshot metadata in `.data/usage.json`, ignored by Git. It does not serve conversation logs, prompts, project paths, or session identifiers. Failed refreshes preserve the last successful snapshot.

Personal snapshots and screenshots belong in `.data/`. Review exports before sharing them. The static sandbox build copies only a fixed list of public files and synthetic examples; it never packages `.data`, the local server, ccusage, or planning documents.

## Development and deployment

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
bun run build:sandbox
bun run preview:sandbox
```

Tests cover normalization, calendar gaps, weekly totals, imports, missing costs, installed ccusage version, static build contents, and isolated server startup/recovery. `.github/workflows/ci.yml` runs them on three operating systems.

The sandbox is an ordinary static site in `dist/sandbox`. To host it like hbsguard, enable **Settings → Pages → GitHub Actions** on the public repository, then manually run **Deploy Sandbox**. The workflow tests and builds before uploading only `dist/sandbox`. After a successful deployment, verify the public URL and remove the pending-deployment note above. Pushes alone do not publish the sandbox.

Maintainer planning is separate from this source repository. Please report problems using a small synthetic report rather than private usage logs.

## License

[MIT](LICENSE). Built on ccusage; this project is an independent visualization companion.

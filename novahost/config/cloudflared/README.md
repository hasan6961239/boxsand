# Cloudflare Tunnel configuration

`config.example.yml` is a working ingress configuration for NOVA HOST. It is an
example because it contains three values only you can supply: your tunnel name,
its UUID, and your domain.

## What lives here and what must not

| File | In git? | Why |
|---|---|---|
| `config.example.yml` | yes | No secrets — placeholders only |
| `~/.cloudflared/config.yml` | **no** | Your real hostnames |
| `~/.cloudflared/<UUID>.json` | **never** | The tunnel credential. Anyone holding it can serve traffic on your hostnames. |
| `~/.cloudflared/cert.pem` | **never** | Your account certificate |

The project's `.gitignore` excludes `.cloudflared/` and `tunnel-credentials.json`
so an accidental `git add -A` cannot commit them.

## Setup

Run the guided helper, which does the whole sequence and checks each step:

```bash
scripts/setup-tunnel.sh
```

Or do it by hand — the same commands, in order:

```bash
pkg install cloudflared
cloudflared tunnel login                       # opens a browser, pick your zone
cloudflared tunnel create novahost             # prints the UUID
cp config/cloudflared/config.example.yml ~/.cloudflared/config.yml
nano ~/.cloudflared/config.yml                 # fill in name, UUID, domain
cloudflared tunnel route dns novahost panel.example.com
cloudflared tunnel route dns novahost '*.example.com'
scripts/tunnel.sh run novahost
```

Then set the matching values in `.env` and restart:

```ini
PANEL_HOST=panel.example.com
SITES_DOMAIN=example.com
PUBLIC_URL=https://panel.example.com
TRUST_PROXY=true
SECURE_COOKIES=auto
```

## Why the ingress order matters

Rules match top to bottom. `panel.example.com` also matches `*.example.com`, so
if the wildcard came first your dashboard would be routed to port 8081 — the
hosted-sites listener, which has no API. The symptom is a dashboard that loads
its HTML and then fails every request.

## Testing without a domain

No domain yet? `scripts/tunnel.sh quick` gives a working public HTTPS URL in
seconds with no account and no configuration. The URL is random and changes on
every restart, so it is for trying things out, not for living on.

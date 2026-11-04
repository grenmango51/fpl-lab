# Personal Cloudflare deployment

Website: **https://open-fpl.hoaianh517.workers.dev**. The UI, Google sign-in and session database use the existing Cloudflare account's free Workers/Static Assets/D1 services. Python forecasts, SciPy/HiGHS optimisation, provider collection and the shared workspace run on the existing Ubuntu server. No Azure subscription, paid Cloudflare product, new domain or rented VM is used. The server and its internet connection must be available for planning.

## Account setup

The Google OAuth client already used by Flight Finder is reused. Its registered **Authorized redirect URIs** include this address, alongside the existing Flight Finder URI:

```text
https://open-fpl.hoaianh517.workers.dev/auth/google/callback
```

Manage it under [Google OAuth clients](https://console.cloud.google.com/auth/clients?project=671753832868). Registration and real Google sign-in/sign-out were verified on 24 October 2026. If recreating the site on a different hostname, register the new hostname's callback before using sign-in.

`OWNER_EMAILS` in `wrangler.jsonc` restricts access to the owner's primary Google account and the existing dedicated Ilmari account. Successful Google token exchange must return a verified, allowed email. Sessions are opaque Secure/HttpOnly/SameSite cookies; D1 stores their hashes. API access always requires a session, including player forecasts and exports. Browser mutation requests must have the same Origin. The original Flight Finder deployment is independent.

## Server connection and storage

`open-fpl-tunnel.service` runs a Cloudflare Quick Tunnel to loopback port 18082. Its changing origin address is registered in D1 using a private machine credential; the browser's address remains constant after restarts. The machine route accepts only HTTPS `trycloudflare.com` addresses. The Python API independently requires that credential on every route, including its health endpoint. It never reaches the browser. Quick Tunnels are a best-effort free service, with [documented limits](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/); they have no production availability guarantee. A named tunnel with a custom domain is a later option, not a requirement for this personal setup.

The bridge replaces tunnels when Cloudflare reports `Unauthorized: Tunnel not found`, even if the connector process stays alive. It also polls the connector's loopback-only readiness endpoint at `127.0.0.1:18084/ready` every 15 seconds and replaces a tunnel after about two minutes without connectivity. Startup and origin registration have bounded retries. A replacement is published only after its connector is ready. These checks leave the forecasting API asleep when idle; they do not make planning requests. systemd restarts the bridge after 10 seconds, and the old connector is terminated and reaped before replacement.

`open-fpl-web.socket` listens only on 127.0.0.1:18082. It activates a proxy and the API on 18083; the proxy waits for API readiness. After five hours without origin connections it stops the API, releasing the forecast cache. The tunnel itself uses about 28 MB here. The API has one worker, a 1 GB memory high-water mark and a 2 GB hard limit. The solver's existing lock bounds simultaneous MILP work. These are resource safeguards, not a promise that every full-season solve will fit.

The service's private mode-0600 environment is `~/.config/open-fpl/production.env`. It supplies `OPEN_FPL_ORIGIN_TOKEN` and `OPEN_FPL_WORKSPACE_PATH`. Without the latter, local Windows/development installations keep their original browser-only persistence.

Plans, active branch, watchlist, forecast assumptions and solver settings save into the server's ignored `data/workspace.sqlite3`. Every saved branch is validated and its resources rescored on the server. Atomic revision checks reject stale device writes. The browser retains its local copy on failures/conflicts; Settings → Plans & backups offers retry or backup-and-load recovery. Foregrounding a clean browser adopts newer shared plans. Import/export remains available. Existing laptop browser plans need a one-time export/import because browser storage is tied to its original device and address; they have not been fetched from Windows.

`open-fpl-backup.timer` retains consistent daily SQLite backups for 14 days under ignored `data/cloud/backups/`. These backups are on the same server; they protect against accidental plan edits, not loss of the disk. The original live-input/Solio collector continues independently, with the same source timestamps, coverage checks and fallbacks. A failed optional research campaign is recorded in `validation_results` and does not discard healthy live inputs; its frozen protocol is never rewritten to make a score pass.

## Deploy and maintain

Use the existing local Cloudflare deployment token from `~/.config/flight-finder/cloudflare.env`; the Python helper loads it without putting its value in arguments. Google credentials remain in `~/.config/flight-finder/google.env`; a separate origin credential is generated locally. Both are installed as Worker secrets using stdin, never source or public variables.

```sh
npm ci
python tools/install_cloudflared.py
python tools/cloudflare.py provision
python tools/install_web.py
npm run deploy
python tools/cloudflare.py secrets
systemctl --user enable --now open-fpl-tunnel.service
```

Routine frontend/gateway updates use `npm run deploy`. Backend updates additionally need `systemctl --user restart open-fpl-web.service`. Restart the bridge with `systemctl --user restart open-fpl-tunnel.service`; it registers its new address automatically. No router port forwarding or Tailscale client is required on user devices. The earlier Tailscale Funnel experiment was removed; Jellyfin's original private Tailscale address was retained.

After changing the tunnel supervisor or its unit, run `python tools/install_web.py` and restart `open-fpl-tunnel.service`. Inspect its recovery messages with `journalctl --user -u open-fpl-tunnel.service --no-pager -n 50`; an active process alone does not establish tunnel connectivity.

Check with `python -m pytest backend/tests -q`, `npm test`, `npm run build`, and `npm run typecheck:hosting`. Then open the real site, verify sign-in, import/edit/optimise/save/reload, cross-browser restoration, mobile width and complete official player/GW coverage. Use the dedicated Ilmari Chrome for browser checks. Never include a login cookie, origin credential, OAuth token or provider payload in a screenshot/report intended for source control.

The free tiers have shared account quotas. Personal traffic fits comfortably in the [Workers](https://developers.cloudflare.com/workers/platform/pricing/) and [D1](https://developers.cloudflare.com/d1/platform/pricing/) free allowances expected here; this is not a measured monthly usage forecast or an unlimited-service claim. No paid feature was activated for Open FPL.

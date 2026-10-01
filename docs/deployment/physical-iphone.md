# First physical iPhone development test (M2-C3)

This is an operator procedure, not a production authentication or distribution
design. The iPhone is a native Device Session v2 node; Realtime and Brain stay
server-side. Do not expose the loopback development bypass on a public listener.

## 1. Build and sign outside this repository

The GitHub `ios` job first builds/tests the simulator target, then archives an
unsigned **iphoneos** app and validates an unsigned device IPA. Download the
GitHub artifact `LuoyaoIOS-unsigned-re-signable-iphoneos`; inside the Actions
artifact ZIP is `LuoyaoIOS-unsigned-re-signable.ipa`, containing
`Payload/LuoyaoIOS.app/`. The app's repository bundle ID is
`space.luoyao.ios` and its minimum iOS version is 17.0. CI checks its
`iPhoneOS` metadata, arm64 Mach-O platform, archive integrity, and absence of a
code signature. This IPA is **not installable as downloaded**.

Use the existing external phone-side signing workflow to supply a valid Apple
signing identity, provisioning profile, compatible entitlements, and device
eligibility. The workflow may need to change the bundle ID to one covered by
its profile before signing; verify the resulting app's identity and install it
on the test iPhone. No certificates, Apple IDs, profiles, or signing secrets
belong in this repository or CI.

## 2. Secure network and trusted development identity

The approved topology is:

```text
physical iPhone --TLS/WSS--> trusted reverse proxy --loopback WS--> Realtime
                                                      (127.0.0.1:8787)
```

Use a DNS hostname whose publicly trusted TLS certificate covers that exact
hostname and whose chain is valid on the iPhone. Do not disable ATS, override
URLSession certificate validation, or use a trust-all handler. Expose only the
proxy's TLS port; firewall the Realtime listener. Configure the proxy to pass
WebSocket Upgrade and the `Authorization` request header, and exclude that
header from access logs. For example, the essential Nginx proxy directives
inside an operator-owned HTTPS server block are:

```nginx
location /realtime {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
}
```

The HTTPS server block, certificate lifecycle, hostname, firewall, and proxy
access policy are deployment-owned, not committed here. Do not place the token
in the URL or proxy logs. Proxy access control/rate limiting is recommended in
addition to the application credential.

Before starting Realtime, generate a new random 32-byte token with
`openssl rand -hex 32` in the operator environment. Provide it as
`REALTIME_PHYSICAL_DEV_TOKEN` through the deployment's secret manager, along
with `REALTIME_PHYSICAL_DEV_MODE=1`, `REALTIME_PHYSICAL_DEV_USER_ID`, and
`REALTIME_PHYSICAL_DEV_DEVICE_ID`. The device ID is the stable declared ID
shown by the installed app; it is an authorization lookup key, **not** the
credential. Keep `REALTIME_DEV_MODE` and `REALTIME_DEV_V1_COMPAT` unset. Keep
`REALTIME_HOST=127.0.0.1` (or `::1`) and do not set `NODE_ENV=production` for
this explicitly development-only mode. Startup fails if these rules conflict.

The WSS handshake must carry `Authorization: Bearer <64 lowercase hex
characters>`. Realtime compares the fixed-length token with `timingSafeEqual`
before it supplies the configured trusted principal to Device Session
admission. M1-B then independently checks that the hello's declared device ID
matches the configured authorized device. Missing/incorrect tokens and
unauthorized devices fail closed. Rotate/revoke the token by replacing its
secret-manager value and restarting Realtime; old connections should also be
disconnected. Never reuse the loopback bypass as physical-device auth.

## 3. Select the real voice providers explicitly

The default pipeline is deterministic demo output, not a real conversation.
For real ASR → Brain → TTS, migrate PostgreSQL (`pnpm db:migrate`) and set the
opt-in configuration documented in [Realtime Service](../../services/realtime/README.md):

- `REALTIME_ASR_PROVIDER=openai`, `REALTIME_LLM_PROVIDER=brain`,
  `REALTIME_TTS_PROVIDER=openai`
- `REALTIME_BRAIN_MODEL_PROVIDER=openai`, `REALTIME_RELATIONSHIP_MODE=initial`
- `OPENAI_API_KEY`, `OPENAI_ASR_MODEL`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`,
  `OPENAI_TTS_VOICE`, `REALTIME_COMPANION_ID`, `DATABASE_URL`

No provider credential is bundled or available to this task. The separate
paid-provider `pnpm realtime:smoke:live` command requires `M2B_LIVE_SMOKE=1`
and the **loopback** development identity; run it only as a separate,
explicitly opted-in validation process, not simultaneously with physical mode
and never from normal CI. A green CI run does not prove real provider output.

## 4. Run the phone test and collect results

1. Obtain the unsigned IPA from a green GitHub run, sign externally, and install.
2. Open the app and note its stable Device ID. Configure the server's authorized
   device ID to that value; start the loopback Realtime service and trusted TLS
   proxy with the separate token-based development mode.
3. Enter the `wss://` endpoint and token in the app. The token stays in runtime
   memory for the handshake and is cleared from the UI after Connect; it is not
   stored in UserDefaults, source, or Info.plist.
4. Grant microphone permission, then connect or reconnect to refresh available
   capabilities. Check accepted session and negotiated voice diagnostics.
5. Tap Start, speak, tap Stop, and observe transcript, TTS start, playback
   active/completed, and disconnect diagnostics. Pressing Start during playback
   uses safe `abort:user_cancel` → old turn termination → new `listen:start`,
   **not** server-side barge-in.
6. Record the CI run, app version/commit, device iOS version, endpoint hostname
   (not token), admission reason or network/TLS category, microphone status,
   and whether audible non-silent speech played. Redact transcript and any
   other private content before sharing logs.

Successful CI packaging and simulator tests do not verify physical audio,
external provider responses, proxy reachability, signing, or installation.
Reliable server-side `abort:barge_in` queue reuse is a separate task.

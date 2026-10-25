# NFC Portfolio Launcher

A focused Expo app that reads an NFC tag serial number and runs the actions configured for that serial.

The app fetches `GET /api/nfc-config` when its home screen opens. The production standalone service is in `backend/` and stores per-user mappings in MySQL. See [`backend/README.md`](backend/README.md) for setup, security, tests, probes, and container instructions.

The JSON object's keys are NFC tag serial numbers. Each value is an object containing a display `name` and an ordered `actions` array. Actions use `actionType` (`open_url`, `open_application`, or `trigger`) and string `val`. The UI initially shows tag names; tap a tag to expand its serial number and action list, then tap an action route to run that single action and see its result. Valid unsaved drafts appear in Tag cards and can be tested this way, while NFC scans still use the last accepted mapping. `backend/nfc-config.json` remains sample data and is also used by the separate port-3000 starter API; the production port-3002 service reads MySQL.

Tag Studio's **Edit tags** tab uses editable tag cards. Open a card to change its name or serial, choose **Client Action** or **Server Action**, then **Open App** or **Open URL**, and enter the app name or link. **Add tag**, **Add action**, and the remove controls change only the draft. **Import JSON** selects a mapping file, validates it, and asks before replacing the full local draft. **Export JSON** downloads or shares the current valid draft, including unsaved edits. Neither import nor export saves to the backend; **Save changes** sends the full mapping, while **Discard edits and reload** restores the backend version. Install a new Android build to use the native file picker and share sheet. The production backend currently rejects in-app Save with `401`; the app needs user sign-in and scoped write authorization to persist edits there. See `backend/README.md`.

Serials are normalized for casing and common separators before lookup. When scanning inside the dashboard, unknown tags remain there. `open_url` opens the given URL on the selected device. Client `open_application` resolves the installed Android app by its name (case-insensitive) or package ID. Existing application deep links remain supported. If two installed apps share a name, use the package ID shown in the error. A new APK is required for app-name launching; iOS and older builds retain existing deep-link/YouTube behavior.

## Client and server actions

The action picker has two sections, each with **Open App** and **Open URL**:

| Selection | Input | Runs on |
| --- | --- | --- |
| Client Action → Open App | Installed app name, e.g. `WhatsApp` | Android phone |
| Client Action → Open URL | Website or app link | Phone |
| Server Action → Open App | macOS app name, e.g. `Spotify` | Connected Mac |
| Server Action → Open URL | Website, YouTube video or music playlist URL | Connected Mac |

For server actions, enter the **Server base URL** once, for example `http://nfc-lappy.local:3001`. The field remembers the last valid value used on this device and fills it into subsequent server actions, including after restarting the app. The initial default is `http://nfc-lappy.local:3001`. Each saved action keeps its own server address; changing the default does not silently retarget existing actions. This address is separate from **Backend Connection**, which stores tag mappings.

Paste the original YouTube or YouTube Music link under **Server Action → Open URL**. The app encodes the link and builds `/open-url?url=...` automatically. The companion `testServer` routes YouTube media into the installed Chrome web apps and opens other HTTP(S) links on the Mac. Server **Open App** builds `/open/<encoded app name>`. No endpoint construction or URL encoding is needed in the picker. The Mac server must be running and reachable from the phone.

Mappings preserve the familiar action types and add `target` and `serverBaseUrl` for server actions:

```json
{
  "actionType": "open_url",
  "target": "server",
  "serverBaseUrl": "http://nfc-lappy.local:3001",
  "val": "https://music.youtube.com/watch?list=PLpeqfVai5Mvei2M2eTAwd8WZKDc5poTLr",
  "displayName": "Play music on my Mac"
}
```

An omitted `target` means client. Server actions use HTTP requests in the foreground and are compiled into HTTP-only triggers in the on-device NFC cache, so closed-app scans never open the server link on the phone. Existing trigger mappings remain supported. Known companion-server endpoints appear as the corresponding server app/URL action in the editor; unrecognized triggers remain editable as existing HTTP triggers. Saving mappings to the shared backend still follows its existing write-authorization rules.

`trigger` sends an HTTP GET to `val` without opening a browser, WebView, or target application on the phone. For example:

```json
{
  "val": "http://192.168.0.105:3001/open/Whatsapp",
  "actionType": "trigger",
  "displayName": "Whatsapp"
}
```

The endpoint receives the request and performs its own action. HTTP redirects stay within the HTTP client; response content is never displayed. Non-2xx responses, unreachable endpoints, and timeouts report a failure without a browser fallback or application-level retry. The in-app request has a 10-second timeout; native closed-app requests have 10-second connection and read timeouts. Use a URL reachable from the phone; a LAN address normally requires the phone to be on the same network. Android builds permit cleartext HTTP for these configurable LAN endpoints. Rebuild/install the APK and reload the mapping to enable this behavior on the phone.

## Android scans with the app closed

Android system NFC scans are routed to a small native dispatcher, without opening the launcher dashboard or waiting for React. The dispatcher uses a private on-device copy of the last successfully loaded or saved mapping. Opening the app icon still opens the dashboard, and scanning while the dashboard is visible still uses the existing scanner.

After installing a **new native Android build**, open the app once, connect to the backend, and wait for **“Actions saved on this phone”**. You can then swipe the app out of Recents and scan a linked tag with the phone unlocked and NFC enabled. Browser/application actions open their destination directly. A `trigger` action runs through a private, short-lived foreground service so Battery Saver does not block its network access when the dispatcher closes. The service posts a quiet notification while the queued HTTP requests run, then stops and removes it when they finish. On Android 13+, notification permission controls whether this appears in the notification drawer; the foreground service can still run when notifications are denied. The dashboard stays closed. Android still starts the app process briefly to handle the NFC event; there is no persistent background service.

- A scan uses the saved mapping, even when the backend is unavailable. Backend changes take effect after the next successful refresh in the app. Unsaved tag edits are never used for closed-app scans. Changing backend hosts clears the previous host's saved actions.
- Unknown tags, missing configuration, and failed actions produce a short message without opening the dashboard. Opening a URL or application necessarily shows that destination. Multiple actions are dispatched in order; native trigger requests run on a worker queue, so a following browser/application action can open before HTTP completes. Android/OEM behavior should be tested on the target phone. The short-lived service does not restart or replay requests if Android kills the process.
- Swiping away is different from **Force stop** in Android settings. Force-stop, locked-screen scanning, disabled NFC, revoked “Launch via NFC” access, and manufacturer restrictions are not supported guarantees.
- Android controls tag dispatch and may ask you to choose a handler. Tags containing HTTP(S) URLs can go directly to a browser instead, particularly on Android 16+. Use an app-directed MIME/NDEF tag or a supported technology tag for serial-based routing; this change does not rewrite existing tags.
- This custom dispatcher is Android-only. iOS background NFC uses the system notification/app-opening flow.

Implementation: [`plugins/withNfcIntentFilters.js`](plugins/withNfcIntentFilters.js) routes NFC intents away from `MainActivity`; [`modules/nfc-background/`](modules/nfc-background/) supplies the native handler and persistent cache; [`lib/nfc/background-routing.ts`](lib/nfc/background-routing.ts) syncs accepted mappings. Expo Go and old APKs cannot load this native module; a JavaScript refresh alone is insufficient.

Device verification after rebuilding:

1. Open the app, load mappings, and confirm the saved-actions message.
2. Swipe it away, scan each configured tag, and confirm the destination opens without the dashboard or its splash screen. Press Back and confirm there is no dispatcher screen in the back stack.
3. Repeat with the backend unreachable, an unknown tag, an unavailable target app, and a tag with multiple actions.
4. Change a mapping through the trusted administrative API, let the app refresh, then close it and confirm the next scan uses the update. Leave an in-app draft unsaved and confirm scans still use the accepted mapping.
5. Change backend hosts, including to an unreachable host, and verify the previous host's actions no longer run.
6. Configure Server Action → Open App and Open URL (including a YouTube playlist), then scan with the app open and closed. Confirm the endpoint receives GET and no browser opens. Repeat with the endpoint unreachable and returning an HTTP error; confirm a failure message and no browser fallback.
7. Verify Client Action → Open App with an installed app name and a package ID, and Client Action → Open URL with a website. Confirm these affect the phone. Restart the app and add another server action; confirm the last server base is prefilled.
8. Repeat the closed-app trigger test with the charging cable unplugged and Battery Saver enabled. Confirm the action completes promptly and, when notifications are allowed, the temporary notification disappears. Also test after Android has terminated the background app process. A successful test while charging alone does not establish behavior on battery power.

See [Android NFC dispatch](https://developer.android.com/develop/connectivity/nfc/nfc), [background activity launch restrictions](https://developer.android.com/guide/components/activities/secure-bal), and [Apple background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading) for platform limits.

## Preview and NFC builds

The standalone backend can be run independently with `pnpm dev:backend` from the project root; it listens on port `3002` by default. A compiled production start uses `npm run build && npm start` from `backend/`. The managed Expo preview uses Metro on port `8081` and the original starter API on port `3000`. The app's **Backend Connection → Host URL** setting lets you enter and save a backend base URL; it is persisted on the device and the app immediately tests it by reloading `/api/nfc-config`. Leave the field blank to use the default API URL resolution. For a native build, enter a backend URL reachable from the phone (for example, `http://<your-computer-LAN-IP>:3002` during local development). Expo Go can preview the interface, but it cannot load `react-native-nfc-manager`; scanning requires an NFC-enabled development or release build. Rebuild the native app after changing Expo public configuration or its config plugin.

To open the web preview from another device on the same network, run `pnpm dev:lan` from the project root. It uses the Mac's current LAN IP for Expo web on port `8081` and the starter API on port `3000`, or reports when those servers are already running. For example, if the Mac's IP is `192.168.0.105`, open `http://192.168.0.105:8081` on the other device. The starter API's mapping endpoint reads `backend/nfc-config.json` and cannot save edits. To use the MySQL backend instead, set **Backend Connection → Host URL** to `http://<Mac-LAN-IP>:3002` and add the exact web origin `http://<Mac-LAN-IP>:8081` to `CORS_ORIGINS` in `backend/.env`. Backend writes still require `X-API-Key`; do not put the admin key in the app.

The app uses `react-native-nfc-manager` 4.0.0 and its Expo config plugin. On iOS, NFC reading also depends on a compatible physical iPhone and an App ID/provisioning profile with the NFC Tag Reading capability. Android scans require an NFC-capable physical phone.

## References

- [NFC Manager Expo setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/expo.md) — config plugin, permission options, Expo Go limitation, and development-build requirement.
- [NFC Manager read lifecycle](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/reading-ndef.md) — start, request a tag technology, read a tag, and await session cleanup.
- [NFC Manager Android setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/android.md) — Android NFC permission and physical-device requirements.
- [NFC Manager iOS setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/ios.md) — NFC usage description, Tag Reading capability, and provisioning requirements.
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) — custom native modules require a development build rather than Expo Go.

Build an APK and run the native NFC regression tests before packaging:

```sh
pnpm exec eas build --platform android --profile preview-verified --non-interactive --wait
```

The existing `preview` profile remains available for packaging without native unit tests.

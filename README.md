# NFC Portfolio Launcher

A focused Expo app that reads an NFC tag serial number and runs the actions configured for that serial.

The app fetches `GET /api/nfc-config` when its home screen opens. The standalone backend service and its single JSON config are in `backend/`; configuration is a plain JSON file and does not use SQL.

The JSON object's keys are NFC tag serial numbers. Each value is an object containing a display `name` and an ordered `actions` array. Actions use `actionType` (`open_url` or `open_application`) and string `val`. The UI initially shows tag names; tap a tag to expand its serial number and action list. Edit `backend/nfc-config.json` to change mappings. Set `NFC_CONFIG_PATH` if the file is stored elsewhere at runtime.

Serials are normalized for casing and common separators before lookup. Unknown tags remain in the app. `open_url` opens the given URL, while `open_application` opens an application URI; the value `Youtube` is mapped to `youtube://`.

## Preview and NFC builds

The standalone backend can be run independently with `pnpm dev:backend` from the project root, or `npm start` from `backend/`; it listens on port `3002` by default. The managed Expo preview uses Metro on port `8081` and the original starter API on port `3000`. The app's **Backend Connection → Host URL** setting lets you enter and save a backend base URL; it is persisted on the device and the app immediately tests it by reloading `/api/nfc-config`. Leave the field blank to use the default API URL resolution. For a native build, enter a backend URL reachable from the phone (for example, `http://<your-computer-LAN-IP>:3002` during local development). Expo Go can preview the interface, but it cannot load `react-native-nfc-manager`; scanning requires an NFC-enabled native development or release build. Rebuild the native app after changing Expo public configuration or its config plugin.

The app uses `react-native-nfc-manager` 4.0.0 and its Expo config plugin. On iOS, NFC reading also depends on a compatible physical iPhone and an App ID/provisioning profile with the NFC Tag Reading capability. Android scans require an NFC-capable physical phone.

## References

- [NFC Manager Expo setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/expo.md) — config plugin, permission options, Expo Go limitation, and development-build requirement.
- [NFC Manager read lifecycle](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/reading-ndef.md) — start, request a tag technology, read a tag, and await session cleanup.
- [NFC Manager Android setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/android.md) — Android NFC permission and physical-device requirements.
- [NFC Manager iOS setup](https://github.com/revtel/react-native-nfc-manager/blob/main/docs/guide/ios.md) — NFC usage description, Tag Reading capability, and provisioning requirements.
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) — custom native modules require a development build rather than Expo Go.


pnpm exec eas build --platform android --profile preview --non-interactive --wait
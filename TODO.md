# TODO

## NFC scanning and portfolio routing
- [ ] Scan NFC tags on an NFC-capable physical device and read/normalize the detected serial number.
- [x] When the serial is `1D:CF:1B:BA:1A:10:80`, automatically open `https://my-portfolio-liard-gamma-98.vercel.app/`.
- [x] When the serial is `1D:80:36:BA:1A:10:80`, automatically open `https://roco007.github.io/my-portfolio/`.
- [x] Show a clear unrecognized-tag state when a tag serial does not match either mapping.

## Scanner feedback and platform readiness
- [x] Show clear scanning, successful match, unsupported-device, permission/error, and unrecognized-tag states.
- [x] Provide a usable Expo/web preview on the fixed 8081 port with the existing API listener available on port 3000; preserve any healthy listener and load the current private environment before starting or restarting Expo.
- [x] Configure NFC permissions and platform metadata so NFC scanning is ready for a native development/release build; clearly explain in the UI that Expo Go cannot load the native NFC module.

## Native device verification
- [ ] Scan both supplied tags on an NFC-capable physical device and verify the external browser opens each mapped portfolio; Expo Go/Web Preview cannot exercise the native NFC reader.

# NFC Portfolio Launcher — Plan

## Product scope and implementation

Build a single-screen Expo/React Native app that fetches action configuration from `GET /api/nfc-config` on app open, then asks the user to start an NFC read, normalizes the discovered serial, and runs its configured actions. Configuration lives in the single editable `server/nfc-config.json` file; no database is needed. Unknown tags remain in the app and receive an explicit not-linked state.

Reuse the initialized Expo Router / React Native / TypeScript starter. Load the NFC module on scan so the screen can still render in Web preview. Use the manager's NFC reader session to obtain the serial and always close the session. Put config parsing, normalization and routing rules in `lib/nfc/tag-routing.ts`; serve the JSON file through the backend and execute configured `open_url` / `open_application` actions in the existing router screen. Keep the API listener on port 3000 and Expo Metro/Web Preview on the fixed 8081 port.

The Web Preview and Expo Go can preview the interface, but NFC scanning requires an NFC-capable physical device and a native development build containing the module. The Expo plugin supplies native NFC setup; iOS distribution also depends on an App ID/provisioning profile with NFC Tag Reading capability. Physical tag reads cannot be proven by a Web Preview alone.

## Project structure

- `app/(tabs)/index.tsx` — one-handed scan screen, scan status, destination list, and automatic external-link handoff.
- `app.config.ts` — Expo identity and existing identifiers, NFC plugin/permission, native icon/splash references.
- `lib/nfc/tag-routing.ts` — configuration parsing, canonical serial normalization, dynamic task lookup, and readable unknown-serial formatting.
- `server/nfc-config.json` and `/api/nfc-config` — editable, file-backed NFC action configuration without SQL.
- `tests/tag-routing.test.ts` — focused coverage of action parsing, normalization, and unmapped tags.
- `assets/images/` — square launcher, splash, favicon, and Android adaptive icon assets.
- `README.md` — install/build constraints and authoritative NFC/Expo references.
- `TODO.md` — acceptance outcomes and remaining physical-device work.

## Design exploration

- **Field Manual Minimalism** (P = 0.09): Swiss wayfinding structure with confident field-instrument labeling and one vivid signal accent.
- **Quiet Glass Gallery** (P = 0.06): translucent layered cards, soft neutral gradients, and gallery-like spacing.
- **Terminal Mono Utility** (P = 0.04): monochrome control-panel typography, hard dividers, and numeric-first emphasis.

### Chosen: Field Manual Minimalism

**Design Movement:** Swiss information design and technical field-equipment wayfinding, translated into a warm mobile utility rather than a cold dashboard.

**Core Principles:** Make the physical action obvious; keep each destination auditable; reserve strong color for the scan action; treat errors as clear guidance, not alarms.

**Color Philosophy:** Deep evergreen makes the scanner feel dependable and gives the luminous chartreuse a signal-like role. Warm paper keeps the destination list approachable and readable in daylight. Muted sage carries secondary serial and URL details without competing with the scan control.

**Layout Paradigm:** A narrow vertical sequence: identity and scan readiness, one large scanning surface, contextual feedback, then a compact two-row destination ledger. The user can scan one-handed before reading the supporting mapping.

**Signature Elements:** A contactless-wave mark; a chartreuse scan button on an evergreen card; small, spaced serial labels that make the two mappings easy to distinguish.

**Interaction Philosophy:** One explicit tap starts a single NFC session. The interface explains where to hold the phone, opens only an allow-listed matching URL, and leaves unknown or unsupported cases visible with a practical retry path.

**Animation:** Keep motion restrained. Use the native activity indicator only during the active reader session; let platform NFC prompts provide the physical handoff. Avoid continuous decorative motion and clear the session when reading ends.

**Typography System:** Use the platform's native sans-serif stack (SF system sans on iOS, Roboto on Android) so UI text renders crisply without added font assets. Use a tight, bold display headline, medium-weight section titles, and compact uppercase labels with wider tracking for serials and status.

**Brand Essence:** A direct, pocket-sized bridge from a physical portfolio tag to the right online body of work. Personality: precise, calm, immediate.

**Brand Voice:** Short, confident, and action-led. Example lines: “Tap in. Go anywhere.” and “Your work, one tap away.”

**Wordmark & Logo:** A standalone contactless-wave symbol that resolves into an outbound-link arrow, set as a clean square app mark with no baked-in rounded corners or lettering.

**Signature Brand Color:** Contact-chartreuse `#C9F27A` — a distinctive signal color used sparingly to identify scan intent.

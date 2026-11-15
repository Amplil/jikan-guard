# ドパガキガード iOS source prototype

Native SwiftUI source for iOS 16+. The internal target is JikanGuard. The user-confirmed display name is ドパガキガード (all katakana), configured with `GUARD_DISPLAY_NAME` in `project.yml`. Internal target names and placeholder bundle identifiers remain unchanged.

## Implemented source

- Individual Family Controls authorization and the system activity picker.
- One combined daily budget across selected apps, categories and web domains, default 30 minutes.
- Daily Device Activity registration and an embedded monitor extension that applies the system shield at the threshold.
- A private named Managed Settings store; stopping only clears this app's named store.
- App Group configuration written atomically before registration. Each registration has a fresh generation name so callbacks from older registrations are ignored.
- Empty selection cannot register an event (Apple otherwise interprets an empty event as all activity).
- Explicit stop confirmation, Japanese UI, and selection/limit edits disabled while registered.

This is NOT the Chrome extension ported verbatim: Screen Time activity is not per-video playback measurement. No Chrome sync, real-time remaining-time report, background audio/video guarantees, or anti-tampering claims. The person can stop the guard or revoke individual authorization.

## Build on a Mac (not performed here)

1. Use Xcode with an iOS 16+ SDK. This source was prepared on Linux without Swift or Xcode; it has NOT been compiled, signed, run, or tested on a device.
2. Review `project.yml`. Choose your development team and unique app/extension bundle identifiers. Set a real shared `GUARD_APP_GROUP` on BOTH targets. Keep the confirmed display name ドパガキガード.
3. With XcodeGen already installed on that Mac, run `xcodegen generate` from this directory. It generates the Xcode project, Info.plists and entitlement files specified in the YAML. No dependency installation is included in this prototype.
4. Open `JikanGuard.xcodeproj`. Verify the app embeds `GuardMonitor.appex`, both targets have Family Controls and the SAME App Group, and signing/provisioning actually includes these capabilities. Configure these through the owner's Apple account only with authorization; none was accessed or requested here.
5. Build the JikanGuard scheme and run on a physical iOS 16+ device. Allow Screen Time access, select a small test app, choose one minute, start, then use that app to exercise the threshold.
6. Distribution requires the appropriate Family Controls entitlement approval and signing for the app and relevant extension. App Store/TestFlight submission, account fees, provisioning and entitlement applications are outside this delivery.

Manual alternative: create an iOS SwiftUI app target `JikanGuard` and a Device Activity Monitor extension target `GuardMonitor`. Include `App/*.swift` only in the app, `Monitor/*.swift` only in the extension and `Shared/*.swift` in both. Copy the Info.plist keys, identifiers and capabilities from `project.yml`, including the extension principal class. Embed the extension in the app. Keep generated Swift template files out if they duplicate `@main` or the monitor class.

## Timing semantics and outstanding risks

The repeating interval is local 00:00:00 through 23:59:59. This is a daily schedule, NOT a guarantee of an immediate callback at midnight: OS/device use and scheduling control delivery. At interval start/end, the extension clears this app's shield. At threshold it applies the current matching configuration. Initial mid-day registration counts activity after registration, not prior usage. An explicit stop/restart resets the current monitoring event; this prototype cannot preserve today's remaining budget across reconfiguration.

Cross-process callbacks and stopping may race despite generation checks and atomic files. Rapid stop/start, device reboot, timezone/DST change, and app/extension termination MUST be tested on device before production. Storage/authorization failures must not be mistaken for active enforcement. UI says registration succeeded, not that enforcement was observed. Shared storage reads fail closed in the extension by skipping new changes; existing shields may remain until stopped from the app or authorization is revoked. No live usage telemetry or token logging is included.

## Required device acceptance tests (all currently NOT RUN)

- Build, sign, install, launch, authorize, deny, cancel and revoke authorization.
- App-only, category-only, domain-only, mixed selection; empty selection rejected.
- Combined threshold across two selected apps, not a separate cap per app; default system shield appears and unselected apps remain unaffected.
- Repeat over the next daily interval; verify release and reapplication while idle/locked and on next use.
- Start mid-day, stop after shield, restart, kill/relaunch app, reboot, rapid configuration changes; confirm old callbacks cannot reapply an obsolete configuration.
- App Group unavailable/corrupt data and startMonitoring failure: visible error, no false registered status.
- Timezone/DST changes, Screen Time changes, picker/category behavior, website coverage and OS callback timing.
- Individual authorization revoked while active; reauthorization and recovery without stale shields.

## Static check (not a compiler)

`python3 Tests/validate_source.py` checks the expected file layout and selected configuration/safety invariants. Passing does not validate Swift types, APIs, signing, entitlements, schedules, or device behavior.

## Primary Apple references

- [Family Controls](https://developer.apple.com/documentation/familycontrols)
- [Individual authorization](https://developer.apple.com/documentation/familycontrols/authorizationcenter/requestauthorization(for:))
- [FamilyActivitySelection](https://developer.apple.com/documentation/familycontrols/familyactivityselection)
- [DeviceActivityEvent initializer and combined threshold](https://developer.apple.com/documentation/deviceactivity/deviceactivityevent/init(applications:categories:webdomains:threshold:))
- [DeviceActivityCenter](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter)
- [DeviceActivityMonitor](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor)
- [Shield category policy](https://developer.apple.com/documentation/managedsettings/shieldsettings/activitycategorypolicy)
- [Family Controls entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.family-controls)

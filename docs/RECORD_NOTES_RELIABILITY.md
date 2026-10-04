# Record Notes reliability priority

Record Notes and Take Photo are Photo Notes' two core features. Repeated recording failure is a release-blocking product defect. The owner set a 99.9% reliability target. Simulated tests do not establish that target or physical-device acceptance.

## Current investigation

- Report: Ahsan and Abdullah both see the first iPhone recording work and a subsequent recording fail.
- Prior investigation: Codex thread `Fix intermittent voice recording`, ID `01a10354-d778-7aa1-aa0d-c9d47efe33e9`.
- Baseline: production commit `244a668f7283d8362be5f3950c8c2e41aff24d9f`. Work from current main in the isolated record-notes-priority worktree. Preserve concurrent shared-file changes.
- Demonstrated code gap: the Stop timeout reset the UI without aborting the previous recognition engine. A session retaining the microphone can prevent the next session from starting. This is not yet confirmed as the complete cause on the reporters' phones.
- Additional gaps: late start events could replace finishing status, completed sessions accepted duplicate callbacks, and interim results shortened the long-speech deadline.
- WebKit has a reported silent recognition hang after media activity: https://bugs.webkit.org/show_bug.cgi?id=321436. Its trigger must be checked against actual device evidence, not assumed.

## Physical phone test

1. Record the iPhone model, exact iOS version, Photo Notes edition, Safari or Home Screen app, Wi-Fi or cellular, and whether Bluetooth headphones are connected. Test Safari and Home Screen separately.
2. On Capture, take a photograph. Tap Record Notes, say "First recording, front entrance", tap Stop, and wait for Record Notes to return.
3. Without saving or leaving Capture, record "Second recording, damaged hinge". Confirm both phrases remain. Repeat ten times with a different number each time. Record the exact first failed cycle.
4. Repeat after saving a photo, taking a new photo, using Retake, and returning from another screen. Confirm words stay with their own photo.
5. Test rapid taps, one uninterrupted 60-second note, a quiet start, a background/foreground interruption, and a network interruption. Confirm the app does not leave a stuck recording control and previously received words remain.
6. At the first failure, use Report Issue immediately in that same browser/app. Do not reload first. Describe the steps, cycle number, button/status text, whether any words arrived, and whether the iPhone microphone indicator appeared. Recent recognition event metadata is attached automatically. It excludes note text and audio. A screen recording is useful, but unnecessary for the event log.
7. Repeat the normal ten-cycle case on Android Chrome. Report Android separately. Do not treat Android success as iPhone acceptance.

## Evidence and release requirements

- Lifecycle tests must model an engine that retains microphone ownership until abort or end. Cover repeated Stop/Start, delayed final results, missing end callbacks, stale callbacks, permissions, startup errors, and long speech.
- Browser checks cover every edition with Record Notes, including Property Manager and Issue Reporter, at phone and desktop widths. Road Issue Reporter's distinct capture workflow has no Record Notes control.
- Run Help coverage, standard tests, the complete Help checks, Property/global parity, and all-edition Help. Preserve Take Photo and specialist actions.
- Release through the normal reviewed GitHub/main path. Verify exact Railway deployment, startup/schema logs, health, source asset bytes, and release identity.
- Record deployed remediation separately from physical-device results. Keep this investigation open until Ahsan and Abdullah successfully repeat the original case on their phones. Do not report 99.9% reliability from a small test sample.

## If Web Speech remains unreliable

Evaluate a durable audio capture and retryable transcription path, rather than continuing to add blind recognition restarts. It requires explicit handling of audio retention, offline persistence, transcription provider cost/activation, ownership, cancellation, and user review. Do not activate a paid provider or upload users' audio as a diagnostic experiment. Compare it against real failure evidence before choosing an architecture.

## Direct microphone isolation

Open `/record-notes-check.html` on the failing phone after closing other microphone and camera sessions. This diagnostic page is separate from customer Capture. It uses direct microphone audio capture, never SpeechRecognition, and keeps audio only in page memory on that device. It makes no audio upload or provider calls.

Run ten recordings, say the cycle number, stop, play and mark voice heard or silent. Download the metadata and attach it to the existing issue report. Repeat in the mode that fails, Safari or Home Screen. A successful local playback is evidence of microphone capture only, not proof of working Record Notes. Closing or reloading discards the local audio. An unresolved permission request is canceled safely and a later permission grant is released. Backgrounding ends the check and releases the microphone.

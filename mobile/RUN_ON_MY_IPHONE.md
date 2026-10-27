# Run PhotoNotes AI on My iPhone

This puts the PhotoNotes AI app on your own iPhone using your free Apple account. No App Store or paid Apple Developer Program is needed.

The app shows photonotesapp.com. Take Photo, Record Notes and location use the iPhone itself, so recording keeps going with the screen locked. These iPhone features work once the matching photonotesapp.com update is live.

## One-time setup on the Mac

1. Install Xcode from the Mac App Store if it is not installed. Open it once and let it finish installing its components.
2. Install Node.js from nodejs.org (the LTS version) if Terminal says `npm: command not found`.
3. In Xcode, open Settings, Accounts, press +, choose Apple ID, and sign in with your Apple account.

## Build and run

1. Open Terminal and run:

   ```
   cd ~/photo-notes/mobile && npm install && npx cap sync ios && npx cap open ios
   ```

   Xcode opens the project. The first time, wait until the bar at the top stops saying it is resolving packages.
2. In Xcode, click App in the list on the left, then the App target, then Signing & Capabilities. Set Team to your name (Personal Team). Leave Bundle Identifier as `com.zukor.photonotes.ai`.
3. Plug the iPhone into the Mac with a cable. On the iPhone, tap Trust and enter the passcode.
4. On the iPhone, turn on Developer Mode: Settings, Privacy & Security, Developer Mode, turn it on, and restart the iPhone when asked. (It appears after the iPhone has been plugged in with Xcode open.)
5. At the top of Xcode, choose your iPhone as the place to run, then press the Run button (the triangle).
6. The first time, the iPhone blocks the app. On the iPhone open Settings, General, VPN & Device Management, tap your Apple account under Developer App, and tap Trust. Then press Run in Xcode again.
7. In the app, sign in. Allow Camera, Microphone and Location when asked. iPhone asks only once.

With a free Apple account the app stops opening after 7 days. Plug the iPhone in and press Run in Xcode again to renew it. Your saved photos and recordings are kept.

## Test script

1. Open Capture and tap Take Photo. Take a photo. Check that the address appears.
2. Tap Record Notes and speak for about 2 minutes.
3. About 1 minute in, lock the iPhone with the side button and keep talking for 30 seconds.
4. Unlock the iPhone. The button still says Stop Recording and the timer kept counting.
5. Tap Stop Recording. Wait for Turning Recording into Words to finish.
6. Check that the note has your words from the whole 2 minutes, including the part said while the screen was locked.
7. Tap Save (or Send/Share in Basic). Check that the PhotoNote shows up on photonotesapp.com with the photo, the location and the full note.

Optional checks:

- Phone call: start Record Notes, have someone call you, answer, hang up. Recording continues in the same note after the call.
- No connection: turn on Airplane Mode, record and tap Stop Recording. The note says the recording is saved on this iPhone. Turn Airplane Mode off and tap Transcribe Recording.
- Closing the app: record, then swipe the app away. Open it again; the account menu, Recordings On This iPhone, has the recording.

If something goes wrong, use Report Issue in the app and say which step.

# The native app

Squadroom's native shell loads the deployed web app and adds the three things
a browser cannot do on an iPhone: notifications that work without installing a
PWA, the system contact picker, and the camera.

Everything below this line needs tools that are not on this machine. The code
is written and the server side is done; what is left is a build.

## Why this exists

Web push on iOS only works after a parent adds the site to their home screen.
Most never will. Until the native build exists, "notifications are on" is
quietly untrue for half the families in an academy — and SMS was costed at
roughly $4k/week at 300 academies and cut, so push is not a nice-to-have, it
is the delivery mechanism.

## What you need

| Thing | Cost | Needed for |
|---|---|---|
| Xcode (Mac App Store, ~7 GB) | free | building at all |
| CocoaPods (`brew install cocoapods`) | free | iOS dependencies |
| Apple Developer Program | **US$99/year** | APNs key, TestFlight, App Store |
| Android Studio + JDK 21 | free | the Android build |
| Firebase project | free tier | Android push only — iOS does not need one |

iOS alone is enough for the NRIFA pilot, and iOS alone means no Google account
anywhere in the stack.

## First build

```bash
npm install
npx cap add ios          # needs Xcode + CocoaPods
npx cap sync
npx cap open ios         # opens Xcode
```

In Xcode: select your team under Signing & Capabilities, then add the **Push
Notifications** capability and **Background Modes → Remote notifications**.
Without the capability the app builds fine and simply never receives anything,
which is a miserable afternoon to debug.

## APNs credentials

Apple Developer → Certificates, Identifiers & Profiles → Keys → **+**, tick
Apple Push Notifications service, download the `.p8`. **You can only download
it once.**

Then set four variables on Netlify. The `.p8` has real newlines, which Netlify
env vars cannot hold, so they are escaped:

```bash
npx netlify env:set APNS_KEY_ID "ABC123DEFG" --secret --context production
npx netlify env:set APNS_TEAM_ID "YOURTEAMID" --secret --context production
npx netlify env:set APNS_BUNDLE_ID "app.squadroom.mobile" --context production
npx netlify env:set APNS_PRIVATE_KEY "$(awk '{printf "%s\\n", $0}' AuthKey_ABC123DEFG.p8)" --secret --context production
```

`APNS_ENVIRONMENT=sandbox` while running a debug build straight from Xcode.
TestFlight and the App Store are production, which is the default. Sandbox and
production have **different device tokens as well as different hosts**, so a
token registered in one will never work against the other — the usual symptom
is `BadDeviceToken` on a build that worked yesterday.

Until these are set, `drainNotificationQueue` skips iOS rows rather than
failing them. A missing credential must not retire a parent's subscription.

## Android

```bash
npx cap add android
npx cap sync
npx cap open android
```

Android push has to go through Firebase — Google owns the transport. Create a
project, add an Android app with the same package id, put
`google-services.json` in `android/app/`, then set the service account JSON:

```bash
npx netlify env:set FCM_SERVICE_ACCOUNT "$(cat service-account.json)" --secret --context production
```

## Pointing the app at a different server

`capacitor.config.ts` reads `CAP_SERVER_URL`, defaulting to the production
site. For development against a machine on the same wifi:

```bash
CAP_SERVER_URL=http://192.168.1.20:3000 npx cap sync ios
```

That needs `cleartext: true` in the config for plain http, which is why it is
off by default — a misconfigured URL should fail loudly, not silently
downgrade a product full of children's data to http.

## The App Store risk, stated plainly

The app loads a remote URL rather than bundling the web assets, because the
product is Next.js server components reading cookies and cannot be statically
exported without rewriting every page. Apple's guideline 4.2 is used to reject
apps that are only a webview.

The defence is real and it is the native layer: APNs push, the system contact
picker, and the camera — none of which the website can do on an iPhone. If
review pushes back anyway, the answer is to bundle the shell and move the
pages to client-side data fetching, which the codebase is already shaped for
(see "pages stay THIN" in CLAUDE.md). TestFlight, which is enough for the
NRIFA pilot, has a lighter review than the App Store.

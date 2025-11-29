# Capacitor wrapper

This folder is a starting point for shipping the Hiremote portal to the iOS App Store and Google Play.

## Prerequisites

1. Deploy the Next.js web app and update `server.url` in `capacitor.config.ts` with the production HTTPS domain.
2. Install Capacitor CLI dependencies:
   ```bash
   cd mobile
   npm install
   ```
3. Make sure the root project has been built at least once (`npm run build`) so Capacitor can bundle web assets when using an embedded build.

## Common commands

```bash
# sync native projects with the latest config/web assets
npm run sync

# open native workspaces
npm run open:ios
npm run open:android
```

After running `npm run sync`, you can build and submit from Xcode/Android Studio just like any native app. Remember to provide valid icons, splash screens, and App Store metadata before submitting.

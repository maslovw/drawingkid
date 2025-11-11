# Quick Start Guide

Get your Drawing Kid app up and running in 5 minutes!

## Prerequisites
- Mac with Xcode 15+
- iPad (physical device or simulator)

## Step 1: Create Xcode Project (2 minutes)

1. Open **Xcode**
2. File → New → Project
3. Select **iOS** → **App**
4. Configure:
   - Product Name: `DrawingKid`
   - Interface: `SwiftUI`
   - Language: `Swift`
5. Click **Next** and save

## Step 2: Add Source Files (1 minute)

1. In Finder, locate the `DrawingKid` folder from this repo
2. **Drag** the entire `DrawingKid` folder into your Xcode project navigator
3. Check:
   - ✅ "Copy items if needed"
   - ✅ "Create groups"
   - ✅ Add to target: DrawingKid
4. Click **Finish**

## Step 3: Configure Project (1 minute)

1. Select your project in the navigator
2. Under **General** tab:
   - Set **Minimum Deployments** to `iOS 17.0`
   - Under **Supported Destinations**, keep only `iPad`

3. Under **Info** tab, add these privacy descriptions:
   - `Privacy - Photo Library Usage Description`: "Drawing Kid needs access to import images"
   - `Privacy - Photo Library Additions Usage Description`: "Drawing Kid needs access to save drawings"

## Step 4: Build & Run (1 minute)

1. Select an iPad simulator (iPad Pro recommended)
2. Press **⌘ + R** (or click the Play button)
3. Wait for build to complete
4. App launches on iPad!

## First Use

1. **Draw Something**: Tap screen with mouse or finger
2. **Change Colors**: Tap palette icon in top left
3. **Try Tools**: Tap different tools in bottom toolbar
4. **Undo/Redo**: Use arrow buttons
5. **Settings**: Tap gear icon to customize

## Troubleshooting

### "No such module 'PencilKit'"
- **Solution**: Xcode should auto-link frameworks. Clean build folder (⌘+Shift+K) and rebuild

### "Cannot find type 'PKDrawing'"
- **Solution**: Ensure all `.swift` files are added to your target

### Build errors
- **Solution**: Make sure minimum deployment is iOS 17.0

### App crashes on launch
- **Solution**: Check that `DrawingKidApp.swift` is set as the app entry point (@main)

## Next Steps

- Read [README.md](README.md) for full feature documentation
- See [SETUP.md](SETUP.md) for advanced configuration
- Customize colors, tools, and AI settings
- Test on real iPad with Apple Pencil for best experience

## Need Help?

Check the full [SETUP.md](SETUP.md) guide or open an issue on GitHub.

---

**Enjoy drawing!** 🎨

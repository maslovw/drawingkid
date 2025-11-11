# Drawing Kid - Setup Guide

## Overview
Drawing Kid is an iPad drawing app designed for children, featuring PencilKit integration, customizable tools and colors, and AI-powered object detection using Apple's Vision framework.

## Architecture
The app follows MVVM (Model-View-ViewModel) architecture with a clean separation of concerns:

```
DrawingKid/
├── App/                    # App entry point
├── Models/                 # Data models
├── ViewModels/            # Business logic
├── Views/                 # SwiftUI views
├── Services/              # Services (AI, Persistence, Undo/Redo)
└── Resources/             # Assets and configuration
```

## Requirements
- **Xcode 15.0+**
- **iOS 17.0+**
- **iPad device or simulator**
- **Apple Pencil support** (optional, app also works with finger input)

## Setting Up the Xcode Project

### Step 1: Create New Xcode Project

1. Open Xcode
2. Select **File → New → Project**
3. Choose **iOS → App**
4. Configure the project:
   - **Product Name**: DrawingKid
   - **Team**: Your development team
   - **Organization Identifier**: com.yourcompany
   - **Interface**: SwiftUI
   - **Language**: Swift
   - **Storage**: None
5. Click **Next** and save in a location of your choice

### Step 2: Add Source Files to Project

1. In Finder, locate the `DrawingKid` folder in this repository
2. Drag the following folders into your Xcode project:
   - `App/`
   - `Models/`
   - `ViewModels/`
   - `Views/`
   - `Services/`
3. When prompted:
   - ✅ Check "Copy items if needed"
   - ✅ Select "Create groups"
   - ✅ Add to targets: DrawingKid

### Step 3: Configure Project Settings

1. Select your project in the Project Navigator
2. Under **Targets → DrawingKid → General**:
   - Set **Minimum Deployments** to iOS 17.0
   - Under **Supported Destinations**, keep only **iPad**

3. Under **Signing & Capabilities**:
   - Select your development team
   - Enable **iCloud** (optional, for cloud storage)
   - Add **Background Modes** if needed

4. Under **Info**:
   - Replace the Info.plist with the one from `Resources/Info.plist`
   - Or manually add these privacy descriptions:
     - **Privacy - Photo Library Additions Usage Description**: "Drawing Kid needs access to save your drawings to the photo library."
     - **Privacy - Photo Library Usage Description**: "Drawing Kid needs access to import images as backgrounds for your drawings."

### Step 4: Configure Build Settings

1. Select **Build Settings** tab
2. Search for "Swift Language Version" and ensure it's set to **Swift 5**
3. Search for "Code Signing" and configure appropriately

### Step 5: Add Required Frameworks

The app uses the following frameworks (they should be automatically included):
- **SwiftUI** - UI framework
- **PencilKit** - Drawing canvas
- **Vision** - AI object detection
- **CoreML** - Machine learning
- **PhotosUI** - Photo picker
- **UIKit** - Some UIKit bridges

### Step 6: Build and Run

1. Select an iPad simulator or connect an iPad device
2. Press **⌘ + R** to build and run
3. The app should launch on your iPad

## Features

### 1. Drawing Tools
- **Pen**: Smooth ink pen
- **Pencil**: Natural pencil texture
- **Marker**: Thick marker with transparency
- **Eraser**: Vector eraser
- **Lasso**: Selection tool

### 2. Color Palette
- 10 predefined colors
- Quick color switcher
- Configurable visible colors

### 3. Undo/Redo
- Fast snapshot-based undo/redo
- Up to 50 levels of undo
- Visual feedback on availability

### 4. Image Import
- Import photos as drawing backgrounds
- PhotosPicker integration
- Automatic scaling

### 5. AI Object Detection
- Powered by Apple Vision framework
- Detects animals and objects in drawings
- Visual bounding boxes with confidence scores
- Toggle on/off in settings

### 6. Export Options
- Save to Photo Library
- Share via system share sheet
- High-resolution export (2048x1536)

### 7. Configuration
- Customize visible tools
- Customize color palette
- Adjust default tool width
- Enable/disable AI features

### 8. Persistence
- Auto-save drawings
- Metadata tracking (title, dates)
- Local storage in Documents directory
- Ready for iCloud integration

## Usage

### Basic Drawing
1. Launch the app
2. Select a tool from the toolbar
3. Tap the palette icon to choose a color
4. Draw with your finger or Apple Pencil
5. Use undo/redo buttons to correct mistakes

### Importing Background Images
1. Tap the image import button (photo with plus icon)
2. Select a photo from your library
3. The image appears as a semi-transparent background
4. Draw over the image

### AI Object Detection
1. Complete your drawing
2. Tap the magic wand icon (AI button)
3. Wait for analysis to complete
4. Green bounding boxes appear around detected objects
5. Tap the X to close detection overlay

### Customizing Tools and Colors
1. Tap the gear icon (settings)
2. Toggle tools on/off under "Visible Tools"
3. Toggle colors on/off under "Visible Colors"
4. Adjust default tool width slider
5. Enable/disable AI detection
6. Tap "Done" to save settings

### Exporting Your Drawing
1. Tap the share button (arrow up from box)
2. Choose "Save to Photos" or "Share"
3. If sharing, select destination (Messages, Mail, etc.)

## Customization

### Adding New Colors
Edit `DrawingKid/Models/AppConfig.swift`:

```swift
enum ColorOption: String, Codable, CaseIterable {
    // ... existing colors
    case cyan
    case magenta

    var color: Color {
        switch self {
        // ... existing cases
        case .cyan: return .cyan
        case .magenta: return Color(red: 1, green: 0, blue: 1)
        }
    }
}
```

### Adjusting Canvas Size
Edit `DrawingKid/ViewModels/CanvasViewModel.swift`:

```swift
// In analyzeDrawing() and exportImage() methods
let canvasSize = CGSize(width: 1024, height: 768) // Change these values
```

### Custom AI Models
To use custom CoreML models, edit `DrawingKid/Services/AIAnalyzer.swift`:

```swift
// Replace VNRecognizeAnimalsRequest with your custom model request
let model = try YourCustomModel(configuration: MLModelConfiguration())
let request = VNCoreMLRequest(model: model.model) { request, error in
    // Handle results
}
```

## Troubleshooting

### Build Errors
- **"Cannot find type in scope"**: Ensure all files are added to the target
- **"Module not found"**: Check that required frameworks are linked
- **Signing issues**: Configure your development team in project settings

### Runtime Issues
- **Canvas not responding**: Check device orientation support
- **AI detection not working**: Ensure device runs iOS 17+ with Vision support
- **Photos not importing**: Verify privacy permissions in Info.plist
- **App crashes on export**: Check photo library permissions

### Performance
- **Slow drawing**: Test on physical device (simulators can be slow)
- **Memory warnings**: Reduce undo stack size in UndoRedoManager.swift
- **AI analysis slow**: This is normal; Vision framework takes time

## Advanced Features

### iCloud Integration
To enable iCloud storage:

1. Add iCloud capability in Xcode
2. Enable iCloud Documents
3. Update PersistenceService to use ubiquity container:

```swift
let documentsPath = FileManager.default.url(
    forUbiquityContainerIdentifier: nil
)?.appendingPathComponent("Documents")
```

### Custom Tool Widths
Modify tool width range in ConfigView.swift:

```swift
Slider(value: $width, in: 1...50, step: 1) // Increase max to 50
```

### Additional Export Formats
Add PDF export in CanvasViewModel.swift:

```swift
func exportPDF(size: CGSize) -> Data {
    let pdfRenderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size))
    return pdfRenderer.pdfData { context in
        context.beginPage()
        // Draw content
    }
}
```

## Testing

### Unit Testing
Create tests in DrawingKidTests target:

```swift
import XCTest
@testable import DrawingKid

class AppConfigTests: XCTestCase {
    func testConfigSaveLoad() {
        let config = AppConfig.default
        config.save()
        let loaded = AppConfig.load()
        XCTAssertEqual(loaded.visibleTools.count, config.visibleTools.count)
    }
}
```

### UI Testing
Test in DrawingKidUITests target:

```swift
func testDrawingBasicFlow() {
    let app = XCUIApplication()
    app.launch()

    // Test tool selection
    app.buttons["Pen"].tap()
    XCTAssertTrue(app.buttons["Pen"].isSelected)
}
```

## Contributing
This is a personal project for educational purposes. Feel free to fork and modify for your needs.

## License
See LICENSE file for details.

## Support
For issues or questions, please refer to the main README.md file.

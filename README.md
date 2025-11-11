# Drawing Kid - iPad Drawing App for Children

A delightful iPad drawing app designed for kids, featuring Apple Pencil support, customizable tools, and AI-powered object detection.

![Swift](https://img.shields.io/badge/Swift-5.9-orange.svg)
![Platform](https://img.shields.io/badge/Platform-iPadOS%2017+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## ✨ Features

- 🎨 **Drawing Tools**: Pen, pencil, marker, eraser, and lasso tools
- 🌈 **Color Palette**: 10 vibrant colors with customizable visibility
- ✏️ **Apple Pencil**: Full support for precise drawing with Apple Pencil
- ↩️ **Undo/Redo**: Quick snapshot-based undo/redo (up to 50 levels)
- 🖼️ **Image Import**: Add photos as drawing backgrounds
- 🤖 **AI Detection**: Apple Vision-powered object detection in drawings
- 💾 **Auto-Save**: Automatic saving with metadata tracking
- 📤 **Export**: Save to Photos or share via system share sheet
- ⚙️ **Customizable**: Configure which tools and colors are visible
- 👶 **Kid-Friendly**: Simple, intuitive interface designed for children

## 🏗️ Architecture

The app follows **MVVM (Model-View-ViewModel)** architecture with clear separation of concerns:

```
DrawingKid/
├── App/                    # App entry point
│   └── DrawingKidApp.swift
├── Models/                 # Data models
│   ├── ToolType.swift
│   ├── AppConfig.swift
│   ├── DrawingDocument.swift
│   └── DetectedObject.swift
├── ViewModels/            # Business logic layer
│   ├── CanvasViewModel.swift
│   └── ConfigViewModel.swift
├── Views/                 # SwiftUI views
│   ├── MainDrawingView.swift
│   ├── DrawingCanvasView.swift
│   ├── ConfigView.swift
│   ├── ColorPaletteView.swift
│   ├── ToolbarView.swift
│   └── DetectionOverlayView.swift
├── Services/              # Business services
│   ├── UndoRedoManager.swift
│   ├── AIAnalyzer.swift
│   └── PersistenceService.swift
└── Resources/             # Assets and configuration
    ├── Info.plist
    └── Assets.xcassets/
```

### Key Technologies

- **SwiftUI**: Modern declarative UI framework
- **PencilKit**: Native drawing canvas with Apple Pencil support
- **Vision Framework**: AI-powered object detection
- **Combine**: Reactive programming for state management
- **PhotosUI**: Modern photo picker integration
- **UIDocument**: Document-based persistence with iCloud support

## 🚀 Getting Started

### Prerequisites

- macOS with Xcode 15.0 or later
- iOS 17.0+ (iPad)
- Apple Developer account (for device testing)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/drawingkid.git
   cd drawingkid
   ```

2. **Create Xcode Project**
   - Open Xcode
   - Create a new iOS App project named "DrawingKid"
   - Select SwiftUI as the interface
   - Choose a location for your project

3. **Add Source Files**
   - Drag the `DrawingKid` folder into your Xcode project
   - Ensure "Copy items if needed" is checked
   - Select "Create groups"

4. **Configure Project**
   - Set minimum deployment target to iOS 17.0
   - Target iPad only
   - Add required privacy descriptions to Info.plist:
     - Photo Library Usage
     - Photo Library Additions Usage

5. **Build and Run**
   - Select an iPad simulator or device
   - Press ⌘+R to build and run

For detailed setup instructions, see [SETUP.md](SETUP.md).

## 📖 Usage

### Drawing
1. Launch the app
2. Select a tool from the bottom toolbar
3. Tap the palette icon to choose a color
4. Start drawing with your finger or Apple Pencil

### Import Background Image
1. Tap the photo+ icon in the toolbar
2. Select an image from your photo library
3. The image appears as a semi-transparent background
4. Draw over the image

### AI Object Detection
1. Complete your drawing
2. Tap the magic wand icon ✨
3. Wait for AI analysis (2-5 seconds)
4. View detected objects with bounding boxes
5. Tap X to close the detection overlay

### Customize Settings
1. Tap the gear icon ⚙️ in the top right
2. Toggle tools and colors on/off
3. Adjust default tool width
4. Enable/disable AI detection
5. Tap "Done" to save

### Export Your Drawing
1. Tap the share icon ↗️
2. Choose "Save to Photos" or "Share"
3. Select destination (Messages, Mail, AirDrop, etc.)

## 🎯 Key Components

### Models
- **ToolType**: Enum defining available drawing tools
- **AppConfig**: User preferences (visible tools/colors)
- **DrawingDocument**: Drawing data + metadata
- **DetectedObject**: AI detection results

### ViewModels
- **CanvasViewModel**: Manages drawing state, undo/redo, AI analysis
- **ConfigViewModel**: Manages app configuration and settings

### Services
- **UndoRedoManager**: Snapshot-based undo/redo with 50-level stack
- **AIAnalyzer**: Vision framework wrapper for object detection
- **PersistenceService**: Document storage and export

### Views
- **MainDrawingView**: Main screen with canvas and controls
- **DrawingCanvasView**: PencilKit canvas (UIViewRepresentable)
- **ConfigView**: Settings screen
- **ColorPaletteView**: Color selector grid
- **ToolbarView**: Tool and action buttons
- **DetectionOverlayView**: AI detection visualization

## 🔧 Customization

### Adding New Colors

Edit `Models/AppConfig.swift`:

```swift
enum ColorOption: String, Codable, CaseIterable {
    case customColor

    var color: Color {
        switch self {
        case .customColor: return Color(red: 0.5, green: 0.5, blue: 1.0)
        }
    }
}
```

### Adjusting AI Detection

Edit `Services/AIAnalyzer.swift` to use custom CoreML models:

```swift
let model = try YourCustomModel(configuration: MLModelConfiguration())
let request = VNCoreMLRequest(model: model.model)
```

### Changing Canvas Size

Modify `ViewModels/CanvasViewModel.swift`:

```swift
let canvasSize = CGSize(width: 2048, height: 1536) // Adjust as needed
```

## 🧪 Testing

Run unit tests:
```bash
⌘+U in Xcode
```

Test coverage includes:
- Model serialization/deserialization
- ViewModel business logic
- Undo/redo functionality
- Configuration persistence

## 🤝 Contributing

This is an educational project. Feel free to fork and modify for your own use!

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Apple PencilKit team for excellent drawing APIs
- Apple Vision team for powerful object detection
- SwiftUI community for inspiration and examples

## 📞 Support

For detailed setup instructions, see [SETUP.md](SETUP.md).

For questions or issues, please open an issue on GitHub.

---

Made with ❤️ for kids who love to draw
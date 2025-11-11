//
//  DrawingCanvasView.swift
//  DrawingKid
//
//  PencilKit canvas wrapper using UIViewRepresentable
//

import SwiftUI
import PencilKit

struct DrawingCanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    @Binding var tool: PKTool
    var backgroundImage: UIImage?
    var onDrawingChanged: ((PKDrawing) -> Void)?

    func makeUIView(context: Context) -> PKCanvasView {
        let canvasView = PKCanvasView()

        // Configure canvas
        canvasView.drawingPolicy = .anyInput // Support finger and Apple Pencil
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false

        // Set initial drawing and tool
        canvasView.drawing = drawing
        canvasView.tool = tool

        // Set delegate
        canvasView.delegate = context.coordinator

        // Show ruler if needed
        // canvasView.isRulerActive = false

        return canvasView
    }

    func updateUIView(_ canvasView: PKCanvasView, context: Context) {
        // Update tool when it changes
        if canvasView.tool != tool {
            canvasView.tool = tool
        }

        // Update drawing if changed externally (e.g., undo/redo)
        if canvasView.drawing.dataRepresentation() != drawing.dataRepresentation() {
            canvasView.drawing = drawing
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: DrawingCanvasView

        init(_ parent: DrawingCanvasView) {
            self.parent = parent
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            // Update binding when drawing changes
            parent.drawing = canvasView.drawing
            parent.onDrawingChanged?(canvasView.drawing)
        }
    }
}

/// Background image view for the canvas
struct CanvasBackgroundView: View {
    let image: UIImage?

    var body: some View {
        if let image = image {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .opacity(0.5) // Make it slightly transparent so drawing is more visible
        } else {
            Color.white
        }
    }
}

//
//  CanvasViewModel.swift
//  DrawingKid
//
//  ViewModel managing the drawing canvas state
//

import PencilKit
import SwiftUI
import Combine

@MainActor
class CanvasViewModel: ObservableObject {
    // MARK: - Published Properties
    @Published var document: DrawingDocument
    @Published var selectedTool: ToolType = .pen
    @Published var selectedColor: Color = .black
    @Published var toolWidth: CGFloat = 5.0
    @Published var detectedObjects: [DetectedObject] = []
    @Published var isAnalyzing = false
    @Published var showingDetections = false

    // MARK: - Services
    private let undoRedoManager = UndoRedoManager()
    private let aiAnalyzer = AIAnalyzer()
    private let persistenceService = PersistenceService.shared

    var canUndo: Bool { undoRedoManager.canUndo }
    var canRedo: Bool { undoRedoManager.canRedo }

    // MARK: - Initialization
    init(document: DrawingDocument = DrawingDocument()) {
        self.document = document
    }

    // MARK: - Drawing Actions
    func updateDrawing(_ newDrawing: PKDrawing) {
        undoRedoManager.saveState(document.drawing)
        document.drawing = newDrawing
        document.touch()
    }

    func undo() {
        if let previousDrawing = undoRedoManager.undo(current: document.drawing) {
            document.drawing = previousDrawing
            document.touch()
        }
    }

    func redo() {
        if let nextDrawing = undoRedoManager.redo() {
            document.drawing = nextDrawing
            document.touch()
        }
    }

    func clearDrawing() {
        undoRedoManager.saveState(document.drawing)
        document.drawing = PKDrawing()
        detectedObjects.removeAll()
        showingDetections = false
        document.touch()
    }

    // MARK: - Tool Management
    func selectTool(_ tool: ToolType) {
        selectedTool = tool
    }

    func selectColor(_ color: Color) {
        selectedColor = color
    }

    func getCurrentPKTool() -> PKTool {
        selectedTool.makePKTool(color: selectedColor, width: toolWidth)
    }

    // MARK: - Image Import
    func setBackgroundImage(_ image: UIImage) {
        document.backgroundImage = image
        document.touch()
    }

    // MARK: - AI Analysis
    func analyzeDrawing() async {
        isAnalyzing = true
        defer { isAnalyzing = false }

        // Create an image from the current drawing
        let canvasSize = CGSize(width: 800, height: 600)
        let image = persistenceService.exportImage(
            from: document.drawing,
            backgroundImage: document.backgroundImage,
            size: canvasSize
        )

        do {
            let objects = try await aiAnalyzer.detectObjects(in: image)
            detectedObjects = objects.filter { $0.isConfident }
            showingDetections = !detectedObjects.isEmpty
        } catch {
            print("AI Analysis error: \(error)")
            detectedObjects = []
        }
    }

    // MARK: - Persistence
    func saveDocument() {
        do {
            try persistenceService.save(document: document)
        } catch {
            print("Save error: \(error)")
        }
    }

    func loadDocument(id: UUID) {
        do {
            document = try persistenceService.load(id: id)
            undoRedoManager.clear()
        } catch {
            print("Load error: \(error)")
        }
    }

    // MARK: - Export
    func exportImage(size: CGSize) -> UIImage {
        persistenceService.exportImage(
            from: document.drawing,
            backgroundImage: document.backgroundImage,
            size: size
        )
    }
}

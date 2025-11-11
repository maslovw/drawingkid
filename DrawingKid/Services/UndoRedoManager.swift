//
//  UndoRedoManager.swift
//  DrawingKid
//
//  Manages undo/redo stack for PKDrawing snapshots
//

import PencilKit
import Foundation

/// Command pattern for undo/redo operations
protocol DrawingCommand {
    func execute(on drawing: inout PKDrawing)
    func undo(on drawing: inout PKDrawing)
}

/// Manages undo/redo stack with PKDrawing snapshots
class UndoRedoManager: ObservableObject {
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false

    private var undoStack: [PKDrawing] = []
    private var redoStack: [PKDrawing] = []
    private let maxStackSize = 50

    /// Save current drawing state before making changes
    func saveState(_ drawing: PKDrawing) {
        undoStack.append(drawing)
        redoStack.removeAll()

        // Limit stack size to prevent memory issues
        if undoStack.count > maxStackSize {
            undoStack.removeFirst()
        }

        updateCanUndoRedo()
    }

    /// Undo the last change
    func undo(current: PKDrawing) -> PKDrawing? {
        guard !undoStack.isEmpty else { return nil }

        redoStack.append(current)
        let previous = undoStack.removeLast()

        updateCanUndoRedo()
        return previous
    }

    /// Redo the last undone change
    func redo() -> PKDrawing? {
        guard !redoStack.isEmpty else { return nil }

        let next = redoStack.removeLast()
        undoStack.append(next)

        updateCanUndoRedo()
        return next
    }

    /// Clear all undo/redo history
    func clear() {
        undoStack.removeAll()
        redoStack.removeAll()
        updateCanUndoRedo()
    }

    private func updateCanUndoRedo() {
        canUndo = !undoStack.isEmpty
        canRedo = !redoStack.isEmpty
    }
}

//
//  PersistenceService.swift
//  DrawingKid
//
//  Service for persisting and loading drawing documents
//

import PencilKit
import UIKit
import Foundation

/// Service for saving and loading drawing documents
class PersistenceService {
    static let shared = PersistenceService()

    private let fileManager = FileManager.default
    private let drawingsDirectory: URL

    private init() {
        // Use Documents directory for storing drawings
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        drawingsDirectory = documentsPath.appendingPathComponent("Drawings", isDirectory: true)

        // Create drawings directory if it doesn't exist
        try? fileManager.createDirectory(at: drawingsDirectory, withIntermediateDirectories: true)
    }

    /// Save a drawing document
    func save(document: DrawingDocument) throws {
        let documentDirectory = drawingsDirectory.appendingPathComponent(document.metadata.id.uuidString, isDirectory: true)
        try fileManager.createDirectory(at: documentDirectory, withIntermediateDirectories: true)

        // Save metadata as JSON
        let metadataURL = documentDirectory.appendingPathComponent("metadata.json")
        let metadataData = try JSONEncoder().encode(document.metadata)
        try metadataData.write(to: metadataURL)

        // Save PKDrawing data
        let drawingURL = documentDirectory.appendingPathComponent("drawing.data")
        let drawingData = document.drawing.dataRepresentation()
        try drawingData.write(to: drawingURL)

        // Save background image if present
        if let backgroundImage = document.backgroundImage {
            let imageURL = documentDirectory.appendingPathComponent("background.png")
            if let imageData = backgroundImage.pngData() {
                try imageData.write(to: imageURL)
            }
        }
    }

    /// Load a drawing document by ID
    func load(id: UUID) throws -> DrawingDocument {
        let documentDirectory = drawingsDirectory.appendingPathComponent(id.uuidString, isDirectory: true)

        // Load metadata
        let metadataURL = documentDirectory.appendingPathComponent("metadata.json")
        let metadataData = try Data(contentsOf: metadataURL)
        let metadata = try JSONDecoder().decode(DrawingMetadata.self, from: metadataData)

        // Load PKDrawing
        let drawingURL = documentDirectory.appendingPathComponent("drawing.data")
        let drawingData = try Data(contentsOf: drawingURL)
        let drawing = try PKDrawing(data: drawingData)

        // Load background image if present
        let imageURL = documentDirectory.appendingPathComponent("background.png")
        var backgroundImage: UIImage?
        if fileManager.fileExists(atPath: imageURL.path) {
            backgroundImage = UIImage(contentsOfFile: imageURL.path)
        }

        return DrawingDocument(metadata: metadata, drawing: drawing, backgroundImage: backgroundImage)
    }

    /// List all saved drawing IDs
    func listDrawings() throws -> [UUID] {
        let contents = try fileManager.contentsOfDirectory(at: drawingsDirectory, includingPropertiesForKeys: nil)
        return contents.compactMap { UUID(uuidString: $0.lastPathComponent) }
    }

    /// Delete a drawing document
    func delete(id: UUID) throws {
        let documentDirectory = drawingsDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
        try fileManager.removeItem(at: documentDirectory)
    }

    /// Export drawing as image
    func exportImage(from drawing: PKDrawing, backgroundImage: UIImage? = nil, size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale

        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { context in
            // Draw background color
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))

            // Draw background image if present
            if let backgroundImage = backgroundImage {
                backgroundImage.draw(in: CGRect(origin: .zero, size: size))
            }

            // Draw the PKDrawing
            let image = drawing.image(from: CGRect(origin: .zero, size: size), scale: format.scale)
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

//
//  DrawingDocument.swift
//  DrawingKid
//
//  Model representing a drawing with metadata
//

import PencilKit
import UIKit

/// Metadata for a drawing document
struct DrawingMetadata: Codable {
    var id: UUID
    var title: String
    var createdDate: Date
    var modifiedDate: Date
    var backgroundImageName: String?

    init(id: UUID = UUID(), title: String = "Untitled", backgroundImageName: String? = nil) {
        self.id = id
        self.title = title
        self.createdDate = Date()
        self.modifiedDate = Date()
        self.backgroundImageName = backgroundImageName
    }
}

/// A drawing document combining PencilKit drawing with metadata
class DrawingDocument {
    var metadata: DrawingMetadata
    var drawing: PKDrawing
    var backgroundImage: UIImage?

    init(metadata: DrawingMetadata = DrawingMetadata(),
         drawing: PKDrawing = PKDrawing(),
         backgroundImage: UIImage? = nil) {
        self.metadata = metadata
        self.drawing = drawing
        self.backgroundImage = backgroundImage
    }

    /// Update the modified date
    func touch() {
        metadata.modifiedDate = Date()
    }
}

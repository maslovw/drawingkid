//
//  DetectedObject.swift
//  DrawingKid
//
//  Model for AI-detected objects in drawings
//

import CoreGraphics
import Foundation

/// An object detected by the AI analyzer
struct DetectedObject: Identifiable {
    let id = UUID()
    let label: String
    let confidence: Float
    let boundingBox: CGRect

    /// Whether this detection is confident enough to show
    var isConfident: Bool {
        confidence > 0.5
    }
}

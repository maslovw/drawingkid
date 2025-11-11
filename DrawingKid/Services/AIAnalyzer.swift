//
//  AIAnalyzer.swift
//  DrawingKid
//
//  AI-powered object detection using Vision framework
//

import Vision
import CoreML
import UIKit
import CoreGraphics

/// Service for analyzing drawings with AI object detection
class AIAnalyzer {

    /// Detect objects in an image using Vision framework
    /// - Parameter image: The image to analyze
    /// - Returns: Array of detected objects with bounding boxes
    func detectObjects(in image: UIImage) async throws -> [DetectedObject] {
        guard let cgImage = image.cgImage else {
            throw AIAnalyzerError.invalidImage
        }

        return try await withCheckedThrowingContinuation { continuation in
            // Create a Vision request for object recognition
            let request = VNRecognizeAnimalsRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNRecognizedObjectObservation] else {
                    continuation.resume(returning: [])
                    return
                }

                let detectedObjects = observations.compactMap { observation -> DetectedObject? in
                    guard let label = observation.labels.first else { return nil }

                    // Convert normalized bounding box to image coordinates
                    let boundingBox = observation.boundingBox
                    let imageRect = CGRect(
                        x: boundingBox.origin.x * image.size.width,
                        y: (1 - boundingBox.origin.y - boundingBox.height) * image.size.height,
                        width: boundingBox.width * image.size.width,
                        height: boundingBox.height * image.size.height
                    )

                    return DetectedObject(
                        label: label.identifier,
                        confidence: label.confidence,
                        boundingBox: imageRect
                    )
                }

                continuation.resume(returning: detectedObjects)
            }

            // Also try generic object classification
            let classificationRequest = VNClassifyImageRequest { request, error in
                // This provides additional context about the image
            }

            // Perform the requests
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request, classificationRequest])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    /// Detect text in an image
    func detectText(in image: UIImage) async throws -> [VNRecognizedTextObservation] {
        guard let cgImage = image.cgImage else {
            throw AIAnalyzerError.invalidImage
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: [])
                    return
                }

                continuation.resume(returning: observations)
            }

            request.recognitionLevel = .accurate

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}

enum AIAnalyzerError: LocalizedError {
    case invalidImage
    case analysisError(String)

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            return "Invalid image format"
        case .analysisError(let message):
            return "Analysis error: \(message)"
        }
    }
}

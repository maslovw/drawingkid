//
//  DetectionOverlayView.swift
//  DrawingKid
//
//  Overlay showing AI-detected objects
//

import SwiftUI

struct DetectionOverlayView: View {
    let detections: [DetectedObject]
    let canvasSize: CGSize
    @Binding var isVisible: Bool

    var body: some View {
        ZStack {
            if isVisible {
                ForEach(detections) { detection in
                    DetectionBox(
                        detection: detection,
                        canvasSize: canvasSize
                    )
                }

                // Close button
                VStack {
                    HStack {
                        Spacer()
                        Button(action: { isVisible = false }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 30))
                                .foregroundColor(.white)
                                .background(Circle().fill(Color.black.opacity(0.5)))
                        }
                        .padding()
                    }
                    Spacer()
                }
            }
        }
    }
}

struct DetectionBox: View {
    let detection: DetectedObject
    let canvasSize: CGSize

    var body: some View {
        GeometryReader { geometry in
            let box = scaledBoundingBox(for: geometry.size)

            ZStack(alignment: .topLeading) {
                Rectangle()
                    .strokeBorder(Color.green, lineWidth: 3)
                    .background(Color.green.opacity(0.1))
                    .frame(width: box.width, height: box.height)
                    .position(x: box.midX, y: box.midY)

                Text("\(detection.label) \(Int(detection.confidence * 100))%")
                    .font(.caption)
                    .padding(4)
                    .background(Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(4)
                    .position(x: box.minX + box.width / 2, y: box.minY - 10)
            }
        }
    }

    private func scaledBoundingBox(for size: CGSize) -> CGRect {
        let scaleX = size.width / canvasSize.width
        let scaleY = size.height / canvasSize.height

        return CGRect(
            x: detection.boundingBox.minX * scaleX,
            y: detection.boundingBox.minY * scaleY,
            width: detection.boundingBox.width * scaleX,
            height: detection.boundingBox.height * scaleY
        )
    }
}

#Preview {
    DetectionOverlayView(
        detections: [
            DetectedObject(
                label: "Dog",
                confidence: 0.95,
                boundingBox: CGRect(x: 100, y: 100, width: 200, height: 200)
            )
        ],
        canvasSize: CGSize(width: 800, height: 600),
        isVisible: .constant(true)
    )
    .frame(width: 400, height: 300)
    .background(Color.gray.opacity(0.2))
}

//
//  ToolType.swift
//  DrawingKid
//
//  Drawing tools available in the app
//

import PencilKit
import SwiftUI

/// Drawing tools available to the user
enum ToolType: String, Codable, CaseIterable, Identifiable {
    case pen
    case pencil
    case marker
    case eraser
    case lasso

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pen: return "Pen"
        case .pencil: return "Pencil"
        case .marker: return "Marker"
        case .eraser: return "Eraser"
        case .lasso: return "Lasso"
        }
    }

    var iconName: String {
        switch self {
        case .pen: return "pencil.tip"
        case .pencil: return "pencil"
        case .marker: return "highlighter"
        case .eraser: return "eraser"
        case .lasso: return "lasso"
        }
    }

    /// Convert to PencilKit tool
    func makePKTool(color: Color, width: CGFloat = 5) -> PKTool {
        let uiColor = UIColor(color)

        switch self {
        case .pen:
            return PKInkingTool(.pen, color: uiColor, width: width)
        case .pencil:
            return PKInkingTool(.pencil, color: uiColor, width: width)
        case .marker:
            return PKInkingTool(.marker, color: uiColor, width: width)
        case .eraser:
            return PKEraserTool(.vector)
        case .lasso:
            return PKLassoTool()
        }
    }
}

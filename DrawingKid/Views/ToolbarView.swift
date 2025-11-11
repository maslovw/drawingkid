//
//  ToolbarView.swift
//  DrawingKid
//
//  Toolbar with drawing tools and action buttons
//

import SwiftUI

struct ToolbarView: View {
    let availableTools: [ToolType]
    @Binding var selectedTool: ToolType
    let canUndo: Bool
    let canRedo: Bool

    let onUndo: () -> Void
    let onRedo: () -> Void
    let onClear: () -> Void
    let onAnalyze: () -> Void
    let onImportImage: () -> Void
    let onExport: () -> Void

    var body: some View {
        HStack(spacing: 15) {
            // Tool buttons
            ForEach(availableTools) { tool in
                ToolButton(
                    tool: tool,
                    isSelected: selectedTool == tool,
                    onTap: { selectedTool = tool }
                )
            }

            Divider()
                .frame(height: 30)

            // Action buttons
            ActionButton(
                iconName: "arrow.uturn.backward",
                isEnabled: canUndo,
                onTap: onUndo
            )

            ActionButton(
                iconName: "arrow.uturn.forward",
                isEnabled: canRedo,
                onTap: onRedo
            )

            Divider()
                .frame(height: 30)

            ActionButton(
                iconName: "photo.badge.plus",
                isEnabled: true,
                onTap: onImportImage
            )

            ActionButton(
                iconName: "wand.and.stars",
                isEnabled: true,
                onTap: onAnalyze
            )

            ActionButton(
                iconName: "square.and.arrow.up",
                isEnabled: true,
                onTap: onExport
            )

            ActionButton(
                iconName: "trash",
                isEnabled: true,
                color: .red,
                onTap: onClear
            )
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(Color(.systemBackground))
        .cornerRadius(15)
        .shadow(radius: 5)
    }
}

struct ToolButton: View {
    let tool: ToolType
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 4) {
                Image(systemName: tool.iconName)
                    .font(.system(size: 24))
                    .foregroundColor(isSelected ? .white : .primary)
                    .frame(width: 50, height: 50)
                    .background(isSelected ? Color.blue : Color.clear)
                    .cornerRadius(10)

                Text(tool.displayName)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ActionButton: View {
    let iconName: String
    let isEnabled: Bool
    var color: Color = .primary
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Image(systemName: iconName)
                .font(.system(size: 24))
                .foregroundColor(isEnabled ? color : .gray)
                .frame(width: 44, height: 44)
        }
        .disabled(!isEnabled)
        .buttonStyle(.plain)
    }
}

#Preview {
    ToolbarView(
        availableTools: [.pen, .pencil, .marker, .eraser],
        selectedTool: .constant(.pen),
        canUndo: true,
        canRedo: false,
        onUndo: {},
        onRedo: {},
        onClear: {},
        onAnalyze: {},
        onImportImage: {},
        onExport: {}
    )
}

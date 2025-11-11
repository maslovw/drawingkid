//
//  ColorPaletteView.swift
//  DrawingKid
//
//  Color palette selector component
//

import SwiftUI

struct ColorPaletteView: View {
    let colors: [ColorOption]
    @Binding var selectedColor: Color
    let onColorSelected: (Color) -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 50), spacing: 10)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(colors) { colorOption in
                ColorButton(
                    color: colorOption.color,
                    isSelected: selectedColor == colorOption.color,
                    onTap: {
                        selectedColor = colorOption.color
                        onColorSelected(colorOption.color)
                    }
                )
            }
        }
        .padding()
    }
}

struct ColorButton: View {
    let color: Color
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Circle()
                    .fill(color)
                    .frame(width: 50, height: 50)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)
                    )

                if isSelected {
                    Circle()
                        .strokeBorder(Color.blue, lineWidth: 4)
                        .frame(width: 60, height: 60)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ColorPaletteView(
        colors: ColorOption.allCases,
        selectedColor: .constant(.red),
        onColorSelected: { _ in }
    )
}

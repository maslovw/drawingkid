//
//  ConfigView.swift
//  DrawingKid
//
//  Configuration screen for customizing visible tools and colors
//

import SwiftUI

struct ConfigView: View {
    @ObservedObject var viewModel: ConfigViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            Form {
                // Tools Section
                Section {
                    ForEach(ToolType.allCases) { tool in
                        Toggle(isOn: Binding(
                            get: { viewModel.isToolVisible(tool) },
                            set: { _ in viewModel.toggleTool(tool) }
                        )) {
                            HStack {
                                Image(systemName: tool.iconName)
                                    .frame(width: 30)
                                Text(tool.displayName)
                            }
                        }
                    }
                } header: {
                    Text("Visible Tools")
                } footer: {
                    Text("Select which drawing tools appear in the toolbar")
                }

                // Colors Section
                Section {
                    ForEach(ColorOption.allCases) { colorOption in
                        Toggle(isOn: Binding(
                            get: { viewModel.isColorVisible(colorOption) },
                            set: { _ in viewModel.toggleColor(colorOption) }
                        )) {
                            HStack {
                                Circle()
                                    .fill(colorOption.color)
                                    .frame(width: 24, height: 24)
                                    .overlay(
                                        Circle()
                                            .strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)
                                    )
                                Text(colorOption.displayName)
                            }
                        }
                    }
                } header: {
                    Text("Visible Colors")
                } footer: {
                    Text("Select which colors appear in the palette")
                }

                // Drawing Settings
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Default Tool Width: \(Int(viewModel.config.defaultToolWidth))")
                        Slider(
                            value: Binding(
                                get: { viewModel.config.defaultToolWidth },
                                set: { viewModel.updateToolWidth($0) }
                            ),
                            in: 1...20,
                            step: 1
                        )
                    }
                } header: {
                    Text("Drawing Settings")
                }

                // AI Features
                Section {
                    Toggle(isOn: Binding(
                        get: { viewModel.config.enableAIDetection },
                        set: { _ in viewModel.toggleAIDetection() }
                    )) {
                        VStack(alignment: .leading) {
                            Text("AI Object Detection")
                            Text("Detect drawn objects using Apple Vision")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("AI Features")
                } footer: {
                    Text("When enabled, you can analyze your drawing to detect objects")
                }

                // Reset Section
                Section {
                    Button(role: .destructive) {
                        viewModel.resetToDefaults()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Reset to Defaults")
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    ConfigView(viewModel: ConfigViewModel())
}

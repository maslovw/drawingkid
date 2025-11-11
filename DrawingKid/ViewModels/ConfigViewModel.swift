//
//  ConfigViewModel.swift
//  DrawingKid
//
//  ViewModel for managing app configuration
//

import SwiftUI
import Combine

@MainActor
class ConfigViewModel: ObservableObject {
    @Published var config: AppConfig

    init() {
        self.config = AppConfig.load()
    }

    // MARK: - Tool Management
    func toggleTool(_ tool: ToolType) {
        if config.visibleTools.contains(tool) {
            config.visibleTools.removeAll { $0 == tool }
        } else {
            config.visibleTools.append(tool)
        }
        saveConfig()
    }

    func isToolVisible(_ tool: ToolType) -> Bool {
        config.visibleTools.contains(tool)
    }

    // MARK: - Color Management
    func toggleColor(_ colorOption: ColorOption) {
        if config.visibleColors.contains(colorOption) {
            config.visibleColors.removeAll { $0 == colorOption }
        } else {
            config.visibleColors.append(colorOption)
        }
        saveConfig()
    }

    func isColorVisible(_ colorOption: ColorOption) -> Bool {
        config.visibleColors.contains(colorOption)
    }

    // MARK: - Settings
    func updateToolWidth(_ width: CGFloat) {
        config.defaultToolWidth = width
        saveConfig()
    }

    func toggleAIDetection() {
        config.enableAIDetection.toggle()
        saveConfig()
    }

    // MARK: - Persistence
    func saveConfig() {
        config.save()
    }

    func resetToDefaults() {
        config = .default
        saveConfig()
    }
}

//
//  AppConfig.swift
//  DrawingKid
//
//  App configuration for visible tools and colors
//

import SwiftUI

/// Configuration for which tools and colors are visible
struct AppConfig: Codable {
    var visibleTools: [ToolType]
    var visibleColors: [ColorOption]
    var defaultToolWidth: CGFloat
    var enableAIDetection: Bool

    static let `default` = AppConfig(
        visibleTools: [.pen, .pencil, .marker, .eraser],
        visibleColors: ColorOption.allCases,
        defaultToolWidth: 5.0,
        enableAIDetection: true
    )

    // UserDefaults key
    private static let configKey = "app_config"

    /// Load configuration from UserDefaults
    static func load() -> AppConfig {
        guard let data = UserDefaults.standard.data(forKey: configKey),
              let config = try? JSONDecoder().decode(AppConfig.self, from: data) else {
            return .default
        }
        return config
    }

    /// Save configuration to UserDefaults
    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: AppConfig.configKey)
        }
    }
}

/// Predefined color options for the palette
enum ColorOption: String, Codable, CaseIterable, Identifiable {
    case black
    case red
    case orange
    case yellow
    case green
    case blue
    case purple
    case pink
    case brown
    case white

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }

    var color: Color {
        switch self {
        case .black: return .black
        case .red: return .red
        case .orange: return .orange
        case .yellow: return .yellow
        case .green: return .green
        case .blue: return .blue
        case .purple: return .purple
        case .pink: return .pink
        case .brown: return .brown
        case .white: return .white
        }
    }
}

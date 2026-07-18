import SwiftUI

enum SYGMATheme {
    // Web palette from styles.css, kept as readable SwiftUI design tokens.
    static let background = color(0xF7F8FB)
    static let ink = color(0x17202F)
    static let muted = color(0x697386)
    static let soft = color(0x98A2B3)

    static let panel = Color.white.opacity(0.78)
    static let panelStrong = Color.white
    static let line = ink.opacity(0.12)
    static let lineSoft = ink.opacity(0.07)
    static let lineStrong = ink.opacity(0.22)

    static let blue = color(0x2563EB)
    static let blueSoft = color(0xDBEAFE)
    static let teal = color(0x0F766E)
    static let tealSoft = color(0xCCFBF1)
    static let amber = color(0xB45309)
    static let amberSoft = color(0xFEF3C7)
    static let rose = color(0xBE123C)
    static let roseSoft = color(0xFFE4E6)
    static let violet = color(0x6D28D9)
    static let violetSoft = color(0xEDE9FE)

    static let minimumTapTarget: CGFloat = 44
    static let cornerRadius: CGFloat = 8
    static let screenHorizontalPadding: CGFloat = 22
    static let screenCompactHorizontalPadding: CGFloat = 18
    static let screenCompactTopPadding: CGFloat = 16
    static let screenCompactSectionSpacing: CGFloat = 20
    static let screenCompactBottomPadding: CGFloat = 112
    static let panelHorizontalPadding: CGFloat = 44
    static let panelCompactHorizontalPadding: CGFloat = 10
    static let panelTopPadding: CGFloat = 48
    static let panelBottomPadding: CGFloat = 54
    static let panelCompactTopPadding: CGFloat = 22
    static let panelCompactBottomPadding: CGFloat = 24
    static let cardHorizontalPadding: CGFloat = 8
    static let cardTopPadding: CGFloat = 24
    static let cardBottomPadding: CGFloat = 28
    static let cardCompactTopPadding: CGFloat = 12
    static let cardCompactBottomPadding: CGFloat = 12
    static let emptyStateMinimumHeight: CGFloat = 56

    static let backgroundGradient = LinearGradient(
        stops: [
            .init(color: color(0xFAFBFC), location: 0),
            .init(color: color(0xF3F6F9), location: 0.48),
            .init(color: color(0xEEF3F8), location: 1),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static func horizontalDivider(_ accent: Color = ink) -> LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: accent.opacity(0.10), location: 0.08),
                .init(color: accent.opacity(0.30), location: 0.50),
                .init(color: accent.opacity(0.10), location: 0.90),
                .init(color: .clear, location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    static func verticalDivider(_ accent: Color = ink) -> LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: accent.opacity(0.10), location: 0.10),
                .init(color: accent.opacity(0.30), location: 0.50),
                .init(color: accent.opacity(0.10), location: 0.90),
                .init(color: .clear, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static let standardAnimation = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.24)

    private static func color(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

import SwiftUI

struct SYGMAUnderlineButtonStyle: ButtonStyle {
    var tint: Color = SYGMATheme.ink
    var isActive = false
    var compact = false

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .caption.weight(.semibold) : .callout.weight(.semibold))
            .foregroundStyle(isEnabled ? tint : SYGMATheme.soft)
            .frame(minHeight: SYGMATheme.minimumTapTarget)
            .padding(.horizontal, compact ? 8 : 14)
            .contentShape(Rectangle())
            .background(alignment: .bottom) {
                ZStack(alignment: .leading) {
                    SYGMATheme.horizontalDivider()
                        .frame(height: 1)

                    Rectangle()
                        .fill(tint)
                        .frame(height: 1)
                        .scaleEffect(x: isActive || configuration.isPressed ? 1 : 0, anchor: .leading)
                }
            }
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(reduceMotion ? nil : SYGMATheme.standardAnimation, value: configuration.isPressed)
    }
}

struct SYGMAPanel<Content: View>: View {
    private let content: Content

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, horizontalPadding)
            .padding(.top, topPadding)
            .padding(.bottom, bottomPadding)
            .background(Color.white.opacity(0.18))
            .overlay { SYGMAPartialEdgeLines() }
            .shadow(color: SYGMATheme.ink.opacity(0.08), radius: 24, y: 10)
            .accessibilityElement(children: .contain)
    }

    private var horizontalPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.panelCompactHorizontalPadding
            : SYGMATheme.panelHorizontalPadding
    }

    private var topPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.panelCompactTopPadding
            : SYGMATheme.panelTopPadding
    }

    private var bottomPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.panelCompactBottomPadding
            : SYGMATheme.panelBottomPadding
    }
}

struct SYGMACard<Content: View>: View {
    var accent: Color = SYGMATheme.ink
    private let content: Content

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(accent: Color = SYGMATheme.ink, @ViewBuilder content: () -> Content) {
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, SYGMATheme.cardHorizontalPadding)
            .padding(.top, topPadding)
            .padding(.bottom, bottomPadding)
            .background(Color.clear)
            .contentShape(Rectangle())
            .overlay {
                GeometryReader { proxy in
                    SYGMATheme.horizontalDivider(accent)
                        .frame(width: proxy.size.width * 0.54, height: 1)
                        .position(x: proxy.size.width / 2, y: proxy.size.height - 0.5)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .accessibilityElement(children: .contain)
    }

    private var topPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.cardCompactTopPadding
            : SYGMATheme.cardTopPadding
    }

    private var bottomPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.cardCompactBottomPadding
            : SYGMATheme.cardBottomPadding
    }
}

struct SYGMAMetricCell: View {
    let label: String
    let value: String
    var detail: String?
    var showsLeadingDivider = false

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(
        label: String,
        value: String,
        detail: String? = nil,
        showsLeadingDivider: Bool = false
    ) {
        self.label = label
        self.value = value
        self.detail = detail
        self.showsLeadingDivider = showsLeadingDivider
    }

    var body: some View {
        VStack(alignment: .leading, spacing: horizontalSizeClass == .compact ? 8 : 14) {
            Text(label)
                .font(horizontalSizeClass == .compact ? .subheadline : .headline)
                .fontWeight(.semibold)
                .foregroundStyle(SYGMATheme.muted)

            Text(value)
                .font(horizontalSizeClass == .compact ? .title2 : .largeTitle)
                .fontWeight(.heavy)
                .foregroundStyle(SYGMATheme.ink)
                .monospacedDigit()

            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(SYGMATheme.soft)
            }
        }
        .frame(maxWidth: .infinity, minHeight: minimumHeight, alignment: .leading)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .overlay(alignment: .leading) {
            if showsLeadingDivider {
                SYGMATheme.verticalDivider()
                    .frame(width: 1)
                    .padding(.vertical, verticalPadding * 0.2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var horizontalPadding: CGFloat { horizontalSizeClass == .compact ? 16 : 30 }
    private var verticalPadding: CGFloat { horizontalSizeClass == .compact ? 12 : 28 }
    private var minimumHeight: CGFloat { horizontalSizeClass == .compact ? 76 : 154 }
}

struct SYGMATaskCheck: View {
    let isCompleted: Bool
    var label = "할 일"
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var visualSize: CGFloat = 28

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        isCompleted
                            ? LinearGradient(
                                colors: [Color.white.opacity(0.12), .clear, SYGMATheme.ink],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                            : LinearGradient(
                                colors: [Color.white.opacity(0.78), Color.white.opacity(0.58)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isCompleted ? SYGMATheme.ink : SYGMATheme.ink.opacity(0.28), lineWidth: 1.3)
                    }
                    .shadow(color: SYGMATheme.ink.opacity(isCompleted ? 0.16 : 0.06), radius: isCompleted ? 11 : 8, y: isCompleted ? 6 : 4)

                if isCompleted {
                    Image(systemName: "checkmark")
                        .font(.system(size: min(14, visualSize * 0.5), weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: min(36, visualSize), height: min(36, visualSize))
            .frame(minWidth: SYGMATheme.minimumTapTarget, minHeight: SYGMATheme.minimumTapTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : SYGMATheme.standardAnimation, value: isCompleted)
        .accessibilityLabel(label)
        .accessibilityValue(isCompleted ? "완료" : "미완료")
        .accessibilityHint(isCompleted ? "두 번 탭하여 완료를 취소합니다." : "두 번 탭하여 완료합니다.")
    }
}

struct SYGMAViewHeader<Trailing: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String?
    private let trailing: Trailing

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(
        eyebrow: String,
        title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: horizontalSizeClass == .compact ? 12 : 18) {
            VStack(alignment: .leading, spacing: 3) {
                Text(eyebrow)
                    .font(.caption)
                    .fontWeight(.heavy)
                    .textCase(.uppercase)
                    .foregroundStyle(SYGMATheme.blue)

                Text(title)
                    .font(horizontalSizeClass == .compact ? .title2 : .largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(SYGMATheme.ink)
                    .accessibilityAddTraits(.isHeader)

                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(SYGMATheme.muted)
                        .padding(.top, horizontalSizeClass == .compact ? 2 : 4)
                }
            }

            trailing
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

extension SYGMAViewHeader where Trailing == EmptyView {
    init(eyebrow: String, title: String, subtitle: String? = nil) {
        self.init(eyebrow: eyebrow, title: title, subtitle: subtitle) { EmptyView() }
    }
}

struct SYGMASectionHeader: View {
    let title: String
    var detail: String?
    var compactBottomPadding: CGFloat

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(_ title: String, detail: String? = nil, compactBottomPadding: CGFloat = 14) {
        self.title = title
        self.detail = detail
        self.compactBottomPadding = compactBottomPadding
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                titleText
                Spacer(minLength: 12)
                detailText
            }

            VStack(alignment: .leading, spacing: 6) {
                titleText
                detailText
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, horizontalSizeClass == .compact ? compactBottomPadding : 28)
        .accessibilityElement(children: .combine)
    }

    private var titleText: some View {
        Text(title)
            .font(horizontalSizeClass == .compact ? .headline : .title2)
            .fontWeight(.bold)
            .foregroundStyle(SYGMATheme.ink)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var detailText: some View {
        if let detail, !detail.isEmpty {
            Text(detail)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(SYGMATheme.muted)
        }
    }
}

private struct SYGMAPartialEdgeLines: View {
    var accent: Color = SYGMATheme.ink

    var body: some View {
        GeometryReader { proxy in
            let horizontalLength = proxy.size.width * 0.58
            let verticalLength = proxy.size.height * 0.58
            let horizontalOffset = proxy.size.width * 0.10
            let verticalOffset = proxy.size.height * 0.10

            ZStack {
                SYGMATheme.horizontalDivider(accent)
                    .frame(width: horizontalLength, height: 1)
                    .position(x: horizontalOffset + horizontalLength / 2, y: 0.5)

                SYGMATheme.verticalDivider(accent)
                    .frame(width: 1, height: verticalLength)
                    .position(x: proxy.size.width - 0.5, y: proxy.size.height - verticalOffset - verticalLength / 2)

                SYGMATheme.horizontalDivider(accent)
                    .frame(width: horizontalLength, height: 1)
                    .position(x: proxy.size.width - horizontalOffset - horizontalLength / 2, y: proxy.size.height - 0.5)

                SYGMATheme.verticalDivider(accent)
                    .frame(width: 1, height: verticalLength)
                    .position(x: 0.5, y: verticalOffset + verticalLength / 2)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

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

    var body: some View {
        Button(action: action) {
            SYGMACheckShape(progress: isCompleted ? 1 : 0)
                .stroke(
                    isCompleted ? SYGMATheme.ink : SYGMATheme.muted,
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .square, lineJoin: .miter)
                )
                .frame(width: 16, height: 16)
                .frame(minWidth: SYGMATheme.minimumTapTarget, minHeight: SYGMATheme.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.78, blendDuration: 0.08), value: isCompleted)
        .accessibilityLabel(label)
        .accessibilityValue(isCompleted ? "완료" : "미완료")
        .accessibilityHint(isCompleted ? "두 번 탭하여 완료를 취소합니다." : "두 번 탭하여 완료합니다.")
    }
}

private struct SYGMACheckShape: Shape {
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let scale = CGSize(width: rect.width / 16, height: rect.height / 16)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * scale.width, y: y * scale.height) }
        func blend(_ from: CGPoint, _ to: CGPoint) -> CGPoint {
            CGPoint(x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
        }
        var path = Path()
        path.move(to: blend(point(1, 8), point(1.5, 7)))
        path.addLine(to: blend(point(8, 8), point(6, 11.5)))
        path.addLine(to: blend(point(15, 8), point(15, 2.5)))
        return path
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

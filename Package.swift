// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SYGMAMac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "SYGMAMac", targets: ["SYGMAMac"]),
    ],
    targets: [
        .executableTarget(
            name: "SYGMAMac",
            path: ".",
            exclude: [
                ".data", ".git", ".openai", ".playwright-cli", "assets", "dist", "docs", "icons",
                "budget", "node_modules", "output", "scripts", "server", "tests", "worker",
                "ios/SYGMA/SYGMA.xcodeproj", "ios/SYGMA/SYGMAWidget",
                "ios/SYGMA/README.md", "ios/SYGMA/SYGMA/Assets.xcassets",
                "ios/SYGMA/SYGMAWidget-Info.plist",
                "ios/SYGMA/SYGMA/PrivacyInfo.xcprivacy", "ios/SYGMA/SYGMA/SYGMAApp.swift",
                "macos/SYGMA/Info.plist", "macos/SYGMA/README.md",
                "macos/SYGMA/SYGMAMac.entitlements", "macos/SYGMA/SYGMAWidget.entitlements",
                "macos/SYGMA/build-app.sh", "macos/SYGMA/Tests",
                ".DS_Store", ".env", ".env.example", ".gitignore", "README.md", "app.js", "finance-model.js",
                "error.log", "hci87_security_forensics_report_2026-05-27.md", "index.html",
                "manifest.json", "package-lock.json", "package.json", "playwright.config.js",
                "railway.json", "server.js", "service-worker.js", "styles.css",
            ],
            sources: [
                "ios/SYGMA/SYGMA/WebAppShell.swift",
                "macos/SYGMA/Sources/SYGMAMac/SYGMAMacApp.swift",
                "macos/SYGMA/Sources/SYGMAMac/QuickNotes.swift",
            ],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "SYGMAMacTests",
            dependencies: ["SYGMAMac"],
            path: "macos/SYGMA/Tests/SYGMAMacTests"
        ),
    ]
)

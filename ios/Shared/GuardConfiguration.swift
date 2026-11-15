import Foundation
import FamilyControls
import ManagedSettings

// Replace in BOTH Info.plists and entitlements using project.yml before signing.
enum GuardConstants {
    static let storeName = ManagedSettingsStore.Name("daily-guard")
    static let eventName = "shared-budget"
    static var appGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "GuardAppGroup") as? String ?? ""
    }
}

struct GuardConfiguration: Codable {
    var selection = FamilyActivitySelection()
    var minutes = 30
    var activityName: String? = nil
    var enabled = false
    var hasSelection: Bool {
        !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty
    }
}

enum ConfigurationError: LocalizedError {
    case sharedStorageUnavailable
    var errorDescription: String? { "共有設定を開けません。App Groupと署名設定を確認してください。" }
}

enum ConfigurationStore {
    private static let fileName = "guard-configuration.json"
    private static func url() throws -> URL {
        guard !GuardConstants.appGroup.isEmpty,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GuardConstants.appGroup) else {
            throw ConfigurationError.sharedStorageUnavailable
        }
        return container.appendingPathComponent(fileName)
    }
    static func load() throws -> GuardConfiguration {
        let path = try url()
        guard FileManager.default.fileExists(atPath: path.path) else { return GuardConfiguration() }
        return try JSONDecoder().decode(GuardConfiguration.self, from: Data(contentsOf: path))
    }
    static func save(_ configuration: GuardConfiguration) throws {
        try JSONEncoder().encode(configuration).write(to: url(), options: .atomic)
    }
}

import DeviceActivity
import ManagedSettings

final class ActivityMonitor: DeviceActivityMonitor {
    private let store = ManagedSettingsStore(named: GuardConstants.storeName)
    private func activeConfiguration(for activity: DeviceActivityName) -> GuardConfiguration? {
        guard let configuration = try? ConfigurationStore.load(),
              configuration.enabled,
              configuration.activityName == activity.rawValue else { return nil }
        return configuration
    }
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activeConfiguration(for: activity) != nil else { return }
        store.clearAllSettings()
    }
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        guard event.rawValue == GuardConstants.eventName,
              let configuration = activeConfiguration(for: activity) else { return }
        let selection = configuration.selection
        store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
        store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
        store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens, except: [])
        store.shield.webDomainCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens, except: [])
    }
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activeConfiguration(for: activity) != nil else { return }
        store.clearAllSettings()
    }
}

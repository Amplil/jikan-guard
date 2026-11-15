import Foundation
import Combine
import FamilyControls
import DeviceActivity
import ManagedSettings

@MainActor
final class GuardModel: ObservableObject {
    @Published var configuration = GuardConfiguration()
    @Published var authorized = false
    @Published var message = ""
    private let center = DeviceActivityCenter()
    private let store = ManagedSettingsStore(named: GuardConstants.storeName)

    init() {
        do { configuration = try ConfigurationStore.load() }
        catch { message = error.localizedDescription }
        refreshAuthorization()
    }
    func refreshAuthorization() {
        authorized = AuthorizationCenter.shared.authorizationStatus == .approved
    }
    func authorize() async {
        do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) }
        catch { message = "許可できませんでした：\(error.localizedDescription)" }
        refreshAuthorization()
    }
    func start() {
        refreshAuthorization()
        guard authorized, configuration.hasSelection, (1...1440).contains(configuration.minutes) else {
            message = "利用許可、対象、1〜1440分の上限を確認してください。"
            return
        }
        // An explicit stop is required before editing or restarting the daily budget.
        guard !configuration.enabled else { return }
        var next = configuration
        let activity = DeviceActivityName("daily-guard-\(UUID().uuidString)")
        next.activityName = activity.rawValue
        next.enabled = true
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
            repeats: true)
        let event = DeviceActivityEvent(applications: next.selection.applicationTokens,
                                        categories: next.selection.categoryTokens,
                                        webDomains: next.selection.webDomainTokens,
                                        threshold: DateComponents(minute: next.minutes))
        do {
            // Persist first so a callback can read the matching generation.
            try ConfigurationStore.save(next)
            try center.startMonitoring(activity, during: schedule,
                                       events: [DeviceActivityEvent.Name(GuardConstants.eventName): event])
            configuration = next
            message = "OSに監視を登録しました。選んだ対象の合計利用時間を制限します。"
        } catch {
            center.stopMonitoring([activity])
            next.enabled = false
            next.activityName = nil
            configuration = next
            do { try ConfigurationStore.save(next) }
            catch { message = "監視開始と設定の復旧に失敗しました：\(error.localizedDescription)"; return }
            message = "監視を開始できませんでした：\(error.localizedDescription)"
        }
    }
    func stop() {
        var next = configuration
        next.enabled = false
        do {
            // Invalidate callbacks before removing monitoring and this app's shield.
            try ConfigurationStore.save(next)
            if let name = configuration.activityName { center.stopMonitoring([DeviceActivityName(name)]) }
            store.clearAllSettings()
            configuration = next
            message = "監視とこのアプリの制限を解除しました。"
        } catch { message = "停止設定を保存できませんでした：\(error.localizedDescription)" }
    }
}

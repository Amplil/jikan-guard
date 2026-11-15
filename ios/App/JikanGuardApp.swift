import SwiftUI
import FamilyControls

@main
struct JikanGuardApp: App {
    var body: some Scene { WindowGroup { GuardView() } }
}

struct GuardView: View {
    @StateObject private var model = GuardModel()
    @State private var showPicker = false
    @State private var confirmStop = false
    @Environment(\.scenePhase) private var scenePhase
    private var displayName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "ドパガキガード"
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("ドパガキに待ったを")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("選んだアプリ・カテゴリ・Webサイトに、1日共通の利用上限を設定します。動画の再生時間だけを計測する機能ではありません。")
                    Text(model.authorized ? "スクリーンタイム：許可済み" : "スクリーンタイム：未許可")
                    if !model.authorized {
                        Button("利用を許可する") { Task { await model.authorize() } }
                    }
                }
                Section("共通の1日上限") {
                    Stepper("\(model.configuration.minutes) 分", value: $model.configuration.minutes, in: 1...1440)
                    Button("対象を選ぶ") { showPicker = true }
                    Text("アプリ \(model.configuration.selection.applicationTokens.count)・カテゴリ \(model.configuration.selection.categoryTokens.count)・Webサイト \(model.configuration.selection.webDomainTokens.count)")
                        .font(.footnote)
                }.disabled(model.configuration.enabled || !model.authorized)
                Section {
                    if model.configuration.enabled {
                        Text("監視登録済み（実際の制限はOSが適用）")
                        Button("停止して制限を解除", role: .destructive) { confirmStop = true }
                    } else {
                        Button("この設定で開始") { model.start() }
                            .disabled(!model.authorized || !model.configuration.hasSelection)
                    }
                    Text("端末の現地時刻の0時を起点とする毎日の枠を登録します。切り替えの実行時刻はOSに依存します。初回開始や再設定前の利用時間は含みません。停止・再開すると当日の計測も再開始します。")
                        .font(.footnote)
                }
                if !model.message.isEmpty { Section("状態") { Text(model.message) } }
                Section("試作版の制約") {
                    Text("本人の許可を使うため、停止や許可の取り消しを防ぐものではありません。残り時間のリアルタイム表示、Chromeとの同期、動画再生判定は未対応です。")
                }
            }
            .tint(Color(red: 0.365, green: 0.263, blue: 0.741))
            .navigationTitle(displayName)
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(isPresented: $showPicker, selection: $model.configuration.selection)
            .confirmationDialog("監視と制限を解除しますか？ 再開時は計測がやり直しになります。", isPresented: $confirmStop, titleVisibility: .visible) {
                Button("停止して解除", role: .destructive) { model.stop() }
            }
            .onChange(of: scenePhase) { phase in if phase == .active { model.refreshAuthorization() } }
        }
    }
}

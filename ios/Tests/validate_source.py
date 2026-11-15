"""Source-layout checks only. This does not compile or execute Swift."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]

class SourceChecks(unittest.TestCase):
    def test_files(self):
        for name in ['project.yml', 'README.md', 'App/JikanGuardApp.swift',
                     'App/GuardModel.swift', 'Shared/GuardConfiguration.swift',
                     'Monitor/ActivityMonitor.swift']:
            self.assertTrue((ROOT/name).is_file(), name)
    def test_scoped_store(self):
        for name in ['App/GuardModel.swift', 'Monitor/ActivityMonitor.swift']:
            text = (ROOT/name).read_text()
            self.assertIn('ManagedSettingsStore(named: GuardConstants.storeName)', text)
            self.assertNotIn('ManagedSettingsStore()', text)
    def test_no_empty_monitoring(self):
        text = (ROOT/'App/GuardModel.swift').read_text()
        self.assertLess(text.index('configuration.hasSelection'), text.index('center.startMonitoring'))
        self.assertLess(text.index('ConfigurationStore.save(next)'), text.index('center.startMonitoring'))
    def test_old_callback_guard(self):
        text = (ROOT/'Monitor/ActivityMonitor.swift').read_text()
        self.assertIn('configuration.activityName == activity.rawValue', text)
        self.assertIn('configuration.enabled', text)
    def test_matching_capabilities(self):
        text = (ROOT/'project.yml').read_text()
        self.assertEqual(text.count('com.apple.developer.family-controls: true'), 2)
        self.assertEqual(text.count("com.apple.security.application-groups: ['$(GUARD_APP_GROUP)']"), 2)
        self.assertIn('com.apple.deviceactivity.monitor-extension', text)
        self.assertIn("iOS: '16.0'", text)
    def test_default(self):
        self.assertIn('var minutes = 30', (ROOT/'Shared/GuardConfiguration.swift').read_text())

# Display branding must not rename internal targets or bundle identifiers.
    def test_confirmed_display_brand(self):
        project = (ROOT/'project.yml').read_text()
        view = (ROOT/'App/JikanGuardApp.swift').read_text()
        self.assertIn('GUARD_DISPLAY_NAME: ドパガキガード', project)
        self.assertIn('as? String ?? "ドパガキガード"', view)
        self.assertIn('name: JikanGuard', project)
        self.assertIn('PRODUCT_BUNDLE_IDENTIFIER: com.example.jikanguard', project)

if __name__ == '__main__':
    unittest.main()

import { useState } from 'react';
import { Moon, Sun, Monitor, Download, Trash2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Select } from '@/components/common/Select';
import { useTheme, useNotification } from '@/contexts';
import { SUPPORTED_CURRENCIES, DATE_FORMAT_OPTIONS } from '@/utils/constants';
import { cn } from '@/utils/helpers';

type ThemeOption = 'light' | 'dark' | 'system';

const themeOptions: { value: ThemeOption; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { success } = useNotification();

  const [preferences, setPreferences] = useState({
    currency: 'USD',
    dateFormat: 'MM/dd/yyyy',
    startOfWeek: 'monday',
    emailNotifications: true,
    pushNotifications: true,
    budgetAlerts: true,
    weeklyReport: false,
    monthlyReport: true,
  });

  const handlePreferenceChange = (key: string, value: string | boolean) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    success('Settings saved');
  };

  const handleExportData = () => {
    success('Data export started', 'You will receive an email when ready');
  };

  const handleClearData = () => {
    success('Data cleared successfully');
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Customize your experience</p>
        </div>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize how the app looks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Theme</label>
              <div className="grid grid-cols-3 gap-3">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
                        theme === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Set your default preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              label="Currency"
              options={SUPPORTED_CURRENCIES}
              value={preferences.currency}
              onChange={(e) => handlePreferenceChange('currency', e.target.value)}
            />

            <Select
              label="Date Format"
              options={DATE_FORMAT_OPTIONS}
              value={preferences.dateFormat}
              onChange={(e) => handlePreferenceChange('dateFormat', e.target.value)}
            />

            <Select
              label="Start of Week"
              options={[
                { value: 'sunday', label: 'Sunday' },
                { value: 'monday', label: 'Monday' },
              ]}
              value={preferences.startOfWeek}
              onChange={(e) => handlePreferenceChange('startOfWeek', e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Manage your notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NotificationToggle
              label="Email Notifications"
              description="Receive updates via email"
              checked={preferences.emailNotifications}
              onChange={(checked) => handlePreferenceChange('emailNotifications', checked)}
            />
            <NotificationToggle
              label="Push Notifications"
              description="Receive push notifications"
              checked={preferences.pushNotifications}
              onChange={(checked) => handlePreferenceChange('pushNotifications', checked)}
            />
            <NotificationToggle
              label="Budget Alerts"
              description="Get alerted when approaching budget limits"
              checked={preferences.budgetAlerts}
              onChange={(checked) => handlePreferenceChange('budgetAlerts', checked)}
            />
            <NotificationToggle
              label="Weekly Report"
              description="Receive weekly spending summary"
              checked={preferences.weeklyReport}
              onChange={(checked) => handlePreferenceChange('weeklyReport', checked)}
            />
            <NotificationToggle
              label="Monthly Report"
              description="Receive monthly financial report"
              checked={preferences.monthlyReport}
              onChange={(checked) => handlePreferenceChange('monthlyReport', checked)}
            />
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardHeader>
            <CardTitle>Data Management</CardTitle>
            <CardDescription>Export or clear your data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Export Data</p>
                <p className="text-sm text-muted-foreground">Download all your data as CSV</p>
              </div>
              <Button
                variant="outline"
                onClick={handleExportData}
                leftIcon={<Download className="h-4 w-4" />}
              >
                Export
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Clear All Data</p>
                <p className="text-sm text-muted-foreground">
                  Remove all transactions and settings
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={handleClearData}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Clear Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

interface NotificationToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function NotificationToggle({ label, description, checked, onChange }: NotificationToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-5'
          )}
        />
      </button>
    </div>
  );
}

export default Settings;

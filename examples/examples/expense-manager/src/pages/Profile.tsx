import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { User, Mail, Camera, Lock, Save } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Avatar } from '@/components/common/Avatar';
import { Modal } from '@/components/common/Modal';
import { useAuth, useNotification } from '@/contexts';
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileFormData,
  type ChangePasswordFormData,
} from '@/utils/validators';
import { SUPPORTED_CURRENCIES } from '@/utils/constants';

export function Profile() {
  const { user, updateProfile, changePassword } = useAuth();
  const { success, error: showError } = useNotification();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors, isSubmitting: isProfileSubmitting },
  } = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
      currency: user?.currency || 'USD',
    },
  });

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPassword,
    formState: { errors: passwordErrors, isSubmitting: isPasswordSubmitting },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onProfileSubmit = async (data: UpdateProfileFormData) => {
    try {
      await updateProfile(data);
      success('Profile updated successfully');
    } catch (err) {
      showError('Failed to update profile', err instanceof Error ? err.message : undefined);
    }
  };

  const onPasswordSubmit = async (data: ChangePasswordFormData) => {
    try {
      await changePassword(data);
      success('Password changed successfully');
      resetPassword();
      setIsPasswordModalOpen(false);
    } catch (err) {
      showError('Failed to change password', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Profile Settings</h1>
          <p className="text-muted-foreground">Manage your account settings and preferences</p>
        </div>

        {/* Avatar Section */}
        <Card>
          <CardContent className="flex items-center gap-6 p-6">
            <div className="relative">
              <Avatar src={user?.avatar} name={user?.name} size="xl" />
              <button
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
                aria-label="Change avatar"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <div>
              <h2 className="text-xl font-semibold">{user?.name}</h2>
              <p className="text-muted-foreground">{user?.email}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Member since {new Date(user?.createdAt || '').toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Profile Form */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Update your personal details</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit(onProfileSubmit)} className="space-y-4">
              <Input
                label="Full Name"
                leftIcon={<User className="h-4 w-4" />}
                error={profileErrors.name?.message}
                {...registerProfile('name')}
              />

              <Input
                label="Email"
                type="email"
                leftIcon={<Mail className="h-4 w-4" />}
                error={profileErrors.email?.message}
                {...registerProfile('email')}
              />

              <Select
                label="Currency"
                options={SUPPORTED_CURRENCIES}
                error={profileErrors.currency?.message}
                {...registerProfile('currency')}
              />

              <div className="flex justify-end">
                <Button type="submit" isLoading={isProfileSubmitting} leftIcon={<Save className="h-4 w-4" />}>
                  Save Changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Security Section */}
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>Manage your password and security settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Password</p>
                <p className="text-sm text-muted-foreground">Last changed 30 days ago</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsPasswordModalOpen(true)}
                leftIcon={<Lock className="h-4 w-4" />}
              >
                Change Password
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>Irreversible actions for your account</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete Account</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete your account and all data
                </p>
              </div>
              <Button variant="destructive">Delete Account</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Password Modal */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        title="Change Password"
        description="Enter your current password and choose a new one"
      >
        <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
          <Input
            label="Current Password"
            type="password"
            error={passwordErrors.currentPassword?.message}
            {...registerPassword('currentPassword')}
          />

          <Input
            label="New Password"
            type="password"
            error={passwordErrors.newPassword?.message}
            helperText="At least 8 characters with uppercase, lowercase, number, and special character"
            {...registerPassword('newPassword')}
          />

          <Input
            label="Confirm New Password"
            type="password"
            error={passwordErrors.confirmPassword?.message}
            {...registerPassword('confirmPassword')}
          />

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPasswordModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isPasswordSubmitting}>
              Change Password
            </Button>
          </div>
        </form>
      </Modal>
    </MainLayout>
  );
}

export default Profile;

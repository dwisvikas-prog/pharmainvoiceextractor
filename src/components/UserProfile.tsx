import { useState } from 'react';
import { X, User as UserIcon, LogOut, CheckCircle2 } from 'lucide-react';
import { supabase, getDaysUntilExpiry, type AuthSession } from '../utils/auth';

interface UserProfileProps {
  session: AuthSession;
  onClose: () => void;
  onLogout: () => void;
  onNameUpdated: (name: string) => void;
}

// Logged-in account page (TailAdmin "My Profile" style) - lets a user edit
// their display name and change their password without emailing support.
export default function UserProfile({ session, onClose, onLogout, onNameUpdated }: UserProfileProps) {
  const [name, setName] = useState(session.user.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session.user.name) return;
    setIsSavingName(true);
    setNameMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ data: { name: trimmed } });
      if (error) throw error;
      onNameUpdated(trimmed);
      setNameMessage('Name updated.');
    } catch (error: any) {
      setNameMessage(error?.message || 'Could not update name.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setPasswordMessage('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('Passwords do not match.');
      return;
    }
    setIsSavingPassword(true);
    setPasswordMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMessage('Password changed.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setPasswordMessage(error?.message || 'Could not change password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const daysLeft = getDaysUntilExpiry(session.expiresAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="relative h-20 rounded-t-3xl bg-gradient-to-r from-blue-500 to-indigo-600">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-black/20 p-1.5 text-white hover:bg-black/30" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 pb-6">
          <div className="-mt-10 flex items-end gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-white bg-blue-600 text-xl font-bold text-white shadow-lg">
              {session.user.name.trim().slice(0, 1).toUpperCase()}
            </div>
            <div className="pb-1">
              <h2 className="text-lg font-bold text-slate-900">{session.user.name}</h2>
              <p className="text-xs text-slate-500">{session.user.email}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase text-slate-400">Plan</p>
              <p className="text-sm font-semibold capitalize text-slate-900">{session.plan}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase text-slate-400">Billing</p>
              <p className="text-sm font-semibold capitalize text-slate-900">{session.billingCycle}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase text-slate-400">Days left</p>
              <p className="text-sm font-semibold text-slate-900">{daysLeft}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase text-slate-400">OCR used</p>
              <p className="text-sm font-semibold text-slate-900">{session.ocrUsed}</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><UserIcon className="h-4 w-4 text-blue-600" /> Display name</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={isSavingName || !name.trim() || name.trim() === session.user.name}
                className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingName ? 'Saving…' : 'Save'}
              </button>
            </div>
            {nameMessage && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-600"><CheckCircle2 className="h-3 w-3" />{nameMessage}</p>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-bold text-slate-900">Change password</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleChangePassword}
              disabled={isSavingPassword || !newPassword || !confirmPassword}
              className="mt-2 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSavingPassword ? 'Saving…' : 'Update password'}
            </button>
            {passwordMessage && <p className="mt-1.5 text-xs text-slate-600">{passwordMessage}</p>}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

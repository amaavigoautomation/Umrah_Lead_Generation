import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  KeyRound,
  Check,
  Trash2,
  Lock,
  Unlock,
  Database,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { AppUser, ActiveTab } from '../types';
import { PLATFORM_MODULES } from '../services/dataService';

interface UserManagementViewProps {
  users: AppUser[];
  onSaveUser: (user: AppUser) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  users,
  onSaveUser,
  onDeleteUser,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<AppUser>>({
    name: '',
    email: '',
    username: '',
    password: '',
    role: 'SPECIALIST',
    accessLevel: 'CUSTOM',
    allowedModules: ['knowledge', 'playground'],
    isActive: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleToggleModule = (moduleId: string) => {
    const current = editingUser.allowedModules || [];
    if (current.includes(moduleId)) {
      setEditingUser({
        ...editingUser,
        allowedModules: current.filter((m) => m !== moduleId),
      });
    } else {
      setEditingUser({
        ...editingUser,
        allowedModules: [...current, moduleId],
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser.name || !editingUser.email || !editingUser.password) return;

    setIsSaving(true);
    try {
      const userToSave: AppUser = {
        userId: editingUser.userId || `user-${Date.now()}`,
        name: editingUser.name.trim(),
        email: editingUser.email.trim().toLowerCase(),
        username: editingUser.username?.trim().toLowerCase() || editingUser.email.split('@')[0].toLowerCase(),
        password: editingUser.password.trim(),
        role: editingUser.role || 'SPECIALIST',
        accessLevel:
          editingUser.role === 'ADMIN' || editingUser.allowedModules?.length === PLATFORM_MODULES.length
            ? 'ALL'
            : 'CUSTOM',
        allowedModules:
          editingUser.role === 'ADMIN'
            ? PLATFORM_MODULES.map((m) => m.id)
            : editingUser.allowedModules && editingUser.allowedModules.length > 0
            ? editingUser.allowedModules
            : ['knowledge', 'playground'],
        isActive: editingUser.isActive !== false,
        createdAt: editingUser.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await onSaveUser(userToSave);
      setToast(`User "${userToSave.name}" saved to Firestore database.`);
      setIsModalOpen(false);
      setTimeout(() => setToast(null), 3500);
    } catch (err) {
      console.error('Error saving user to DB:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5 font-sans">
      {toast && (
        <div className="p-3 bg-orange-50 border border-orange-200 text-orange-900 rounded-xl text-xs flex items-center space-x-2 font-bold">
          <Check className="w-4 h-4 text-orange-600 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-orange-500" />
            <h3 className="font-extrabold text-slate-900 text-base">Platform Users & Module Access Control</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Manage user logins and module permissions stored directly in Firestore collection <code className="text-orange-600 font-mono font-bold">app_users</code>.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingUser({
              name: '',
              email: '',
              username: '',
              password: '',
              role: 'SPECIALIST',
              accessLevel: 'CUSTOM',
              allowedModules: ['knowledge', 'playground'],
              isActive: true,
            });
            setIsModalOpen(true);
          }}
          className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition shadow-md shadow-orange-500/20 cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add User to Database</span>
        </button>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs text-slate-800">
          <thead className="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
            <tr>
              <th className="p-3.5">User & Email</th>
              <th className="p-3.5">Password</th>
              <th className="p-3.5">Role</th>
              <th className="p-3.5">Module Permissions (RAG / CRM / All)</th>
              <th className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {users.map((u) => {
              const hasAllAccess = u.role === 'ADMIN' || u.accessLevel === 'ALL' || u.allowedModules.length >= 8;

              return (
                <tr key={u.userId} className="hover:bg-slate-50 transition">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{u.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                  </td>
                  <td className="p-3 font-mono text-slate-600">
                    <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200 text-[11px] font-mono text-slate-700">
                      {u.password}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        u.role === 'ADMIN'
                          ? 'bg-orange-500/10 text-orange-600 border-orange-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    {hasAllAccess ? (
                      <span className="px-2 py-0.5 rounded bg-black text-white border border-black text-[11px] font-medium flex items-center w-fit space-x-1">
                        <Unlock className="w-3 h-3 text-orange-400" />
                        <span>Entire Platform (All 8 Modules)</span>
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.allowedModules.map((mod) => (
                          <span
                            key={mod}
                            className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-medium"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => {
                          setEditingUser(u);
                          setIsModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-900 hover:bg-black text-white text-xs font-medium transition"
                      >
                        Edit
                      </button>
                      {users.length > 1 && (
                        <button
                          onClick={() => onDeleteUser(u.userId)}
                          className="p-1.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition"
                          title="Delete user from database"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-orange-500" />
                <span>{editingUser.userId ? 'Edit User Credentials & Access' : 'Add New User to Database'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-700 block mb-1 font-medium">Full Name *</label>
                <input
                  type="text"
                  value={editingUser.name || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  placeholder="e.g. Tariq Mansoor"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none focus:border-orange-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-700 block mb-1 font-medium">Email Address *</label>
                  <input
                    type="email"
                    value={editingUser.email || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    placeholder="operator@umrah360.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-slate-700 block mb-1 font-medium">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={editingUser.password || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                      placeholder="Password"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 pr-8 text-slate-800 focus:outline-none focus:border-orange-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-slate-700 block mb-1 font-medium">User Role</label>
                <select
                  value={editingUser.role || 'SPECIALIST'}
                  onChange={(e) => {
                    const newRole = e.target.value as any;
                    setEditingUser({
                      ...editingUser,
                      role: newRole,
                      allowedModules:
                        newRole === 'ADMIN'
                          ? PLATFORM_MODULES.map((m) => m.id)
                          : editingUser.allowedModules || ['knowledge', 'playground'],
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none focus:border-orange-500"
                >
                  <option value="ADMIN">ADMIN (Full Platform Access)</option>
                  <option value="SPECIALIST">SPECIALIST (Selected Modules)</option>
                  <option value="OPERATOR">OPERATOR (Selected Modules)</option>
                  <option value="CUSTOM">CUSTOM (Granular Permissions)</option>
                </select>
              </div>

              {/* Module Access Checkboxes */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-700 font-medium">Allowed Modules</label>
                  <span className="text-[10px] text-slate-400">Unselected modules will appear locked</span>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {PLATFORM_MODULES.map((mod) => {
                    const isChecked =
                      editingUser.role === 'ADMIN' ||
                      (editingUser.allowedModules || []).includes(mod.id);

                    return (
                      <label
                        key={mod.id}
                        className={`flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition ${
                          isChecked
                            ? 'bg-orange-50 border-orange-300 text-orange-950 font-semibold'
                            : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={editingUser.role === 'ADMIN'}
                          onChange={() => handleToggleModule(mod.id)}
                          className="rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                        />
                        <span className="text-[11px] font-medium">{mod.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-[10px] text-slate-500 flex items-center space-x-1">
                  <Database className="w-3.5 h-3.5 text-orange-500" />
                  <span>Saves to Firestore collection app_users</span>
                </span>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition disabled:opacity-50"
                  >
                    {isSaving ? 'Saving to DB...' : 'Save User'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

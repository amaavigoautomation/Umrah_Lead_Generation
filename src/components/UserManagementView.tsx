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
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-5">
      {toast && (
        <div className="p-3 bg-emerald-950 border border-emerald-700 text-emerald-100 rounded-xl text-xs flex items-center space-x-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">Platform Users & Module Access Control</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage user logins and module permissions stored directly in Firestore collection <code className="text-emerald-400 font-mono">app_users</code>.
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
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add User to Database</span>
        </button>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="p-3">User & Email</th>
              <th className="p-3">Password</th>
              <th className="p-3">Role</th>
              <th className="p-3">Module Permissions (RAG / CRM / All)</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
            {users.map((u) => {
              const hasAllAccess = u.role === 'ADMIN' || u.accessLevel === 'ALL' || u.allowedModules.length >= 8;

              return (
                <tr key={u.userId} className="hover:bg-slate-800/40 transition">
                  <td className="p-3">
                    <div className="font-semibold text-white">{u.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                  </td>
                  <td className="p-3 font-mono text-slate-400">
                    <span className="bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px]">
                      {u.password}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        u.role === 'ADMIN'
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    {hasAllAccess ? (
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800 text-[11px] font-medium flex items-center w-fit space-x-1">
                        <Unlock className="w-3 h-3 text-purple-400" />
                        <span>Entire Platform (All 8 Modules)</span>
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.allowedModules.map((mod) => (
                          <span
                            key={mod}
                            className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700 text-[10px] font-medium"
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
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition"
                      >
                        Edit
                      </button>
                      {users.length > 1 && (
                        <button
                          onClick={() => onDeleteUser(u.userId)}
                          className="p-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-800/60 transition"
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>{editingUser.userId ? 'Edit User Credentials & Access' : 'Add New User to Database'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Full Name *</label>
                <input
                  type="text"
                  value={editingUser.name || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  placeholder="e.g. Tariq Mansoor"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Email Address *</label>
                  <input
                    type="email"
                    value={editingUser.email || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    placeholder="operator@umrah360.com"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                    required
                  />
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={editingUser.password || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                      placeholder="Password"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 pr-8 text-slate-200"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">User Role</label>
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
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
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
                  <label className="text-slate-300 font-medium">Allowed Modules</label>
                  <span className="text-[10px] text-slate-500">Unselected modules will appear locked</span>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  {PLATFORM_MODULES.map((mod) => {
                    const isChecked =
                      editingUser.role === 'ADMIN' ||
                      (editingUser.allowedModules || []).includes(mod.id);

                    return (
                      <label
                        key={mod.id}
                        className={`flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition ${
                          isChecked
                            ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={editingUser.role === 'ADMIN'}
                          onChange={() => handleToggleModule(mod.id)}
                          className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-[11px] font-medium">{mod.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <span className="text-[10px] text-slate-400 flex items-center space-x-1">
                  <Database className="w-3.5 h-3.5 text-purple-400" />
                  <span>Saves to Firestore collection app_users</span>
                </span>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition disabled:opacity-50"
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

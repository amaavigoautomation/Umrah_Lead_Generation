import React, { useState } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  Database,
  KeyRound,
  AlertCircle,
  Shield,
  Sparkles,
} from 'lucide-react';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';

interface LoginViewProps {
  onLogin: (user: AppUser) => void;
  users: AppUser[];
  isFirebaseActive: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLogin,
  users,
  isFirebaseActive,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const cleanIdentifier = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanIdentifier || !cleanPassword) {
      setError('Please enter both email/username and password.');
      setIsLoading(false);
      return;
    }

    // Lookup user in the DB users list
    const foundUser = users.find(
      (u) =>
        (u.email.toLowerCase() === cleanIdentifier ||
          (u.username && u.username.toLowerCase() === cleanIdentifier)) &&
        u.password === cleanPassword
    );

    if (foundUser) {
      if (foundUser.isActive === false) {
        setError('This account has been deactivated in the database.');
        setIsLoading(false);
        return;
      }
      setTimeout(() => {
        setIsLoading(false);
        onLogin(foundUser);
      }, 300);
    } else {
      setTimeout(() => {
        setIsLoading(false);
        setError('Invalid credentials. Please check your email and password.');
      }, 300);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden selection:bg-orange-500/20 selection:text-orange-900">
      {/* Soft orange ambient ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            <Umrah360Logo size="lg" />
          </div>
          <p className="text-xs text-slate-600 max-w-sm mx-auto font-medium">
            Autonomous Inbound Pilgrimage Capture, Cold Outreach & Omnichannel Lead Engine
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <KeyRound className="w-4 h-4 text-orange-500" />
              <h2 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Account Sign In</h2>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 font-medium">
              <Database className="w-3.5 h-3.5 text-orange-500" />
              <span>{isFirebaseActive ? 'Firestore Live' : 'Database Ready'}</span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-700 block mb-1.5 font-bold">Email or Username</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@umrah360.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 font-medium transition"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-slate-700 block mb-1.5 font-bold">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 font-medium transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span>Verifying credentials...</span>
              ) : (
                <>
                  <span>Sign In to Umrah 360</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Preset User Quick Fill */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-500 mb-2">Quick Sign-in (Demo Accounts):</div>
            <div className="grid grid-cols-2 gap-2">
              {users.slice(0, 2).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setIdentifier(u.email);
                    setPassword(u.password || 'admin123');
                  }}
                  className="p-2 text-left bg-slate-50 hover:bg-orange-50 hover:border-orange-200 border border-slate-200 rounded-xl transition text-[11px]"
                >
                  <div className="font-bold text-slate-800">{u.name}</div>
                  <div className="text-[10px] text-slate-500">{u.role}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

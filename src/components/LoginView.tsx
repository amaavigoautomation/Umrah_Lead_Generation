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
} from 'lucide-react';
import { AppUser } from '../types';

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Subtle ambient lighting glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-400 text-white font-black text-2xl shadow-xl shadow-emerald-950/60 border border-emerald-400/30 mb-2">
            U
          </div>
          <div className="flex items-center justify-center space-x-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Umrah360</h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold text-xs border border-emerald-500/30">
              Enterprise
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Autonomous Inbound Pilgrimage Capture, Cold Outreach & Omnichannel AI Agent
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Account Sign In</h2>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
              <Database className="w-3.5 h-3.5 text-purple-400" />
              <span>{isFirebaseActive ? 'Firestore Connected' : 'DB Ready'}</span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-xl text-red-200 text-xs flex items-center space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-300 block mb-1.5 font-medium">Email or Username</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@umrah360.com"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-slate-300 block mb-1.5 font-medium">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-10 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/50 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span>Verifying credentials...</span>
              ) : (
                <>
                  <span>Sign In to Umrah360</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
